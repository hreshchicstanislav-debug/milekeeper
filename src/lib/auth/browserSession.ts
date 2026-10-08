import { localeFromPath, stripLocale, localizedPath } from '@/lib/i18n/routing';
import { createBrowserClient } from '@/lib/supabase/browserClient';
import { postSessionLogout, postSessionSync } from './sessionSync';
import type { SessionTokens } from './validateSession';
import { browserTabCoordination, type TabCoordination } from './sessionTabCoordination';
import { classifyAuthFailure } from './authFailure';

type Result = { error: unknown; data: { session: SessionTokens | null } };
type Auth = {
  getSession(): Promise<Result>;
  setSession(tokens: SessionTokens): Promise<Result>;
  signOut(): Promise<{ error: unknown }>;
};
export type BrowserAuthState = {
  phase: 'unknown' | 'syncing' | 'authed' | 'anon' | 'error' | 'logging-out';
  operation?: 'sync' | 'logout';
  message?: string;
  interactiveLogout?: boolean;
};

/** Serializes cookie writes, SDK adoption and logout. Shared by callback and gate.
 * No async SDK calls run inside onAuthStateChange's lock-held callback.
 */
export class BrowserSession {
  state: BrowserAuthState = { phase: 'unknown' };
  private listeners = new Set<(state: BrowserAuthState) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private syncFlight: Promise<boolean> | null = null;
  private logoutFlight: Promise<boolean> | null = null;
  private confirmed: SessionTokens | null = null;
  private pendingAdoption: SessionTokens | null = null;
  private pendingSource: SessionTokens | null = null;
  private failedTokens: SessionTokens | null = null;
  private logoutBlocked = false;
  private serverSignedOut = false;
  private initialized = false;
  private interactiveLogout = false;

  constructor(private auth: Auth, private sync = postSessionSync, private clear = postSessionLogout,
    private tabs?: TabCoordination) {}
  subscribe(listener: (state: BrowserAuthState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  private publish(state: BrowserAuthState) {
    if (this.logoutBlocked && state.phase !== 'logging-out' &&
        !(state.phase === 'error' && state.operation === 'logout')) return;
    this.state = state;
    this.listeners.forEach(listener => listener(state));
  }
  private enqueue(work: () => Promise<boolean>) {
    const task = this.queue.then(() => this.tabs ? this.tabs.exclusive(work) : work());
    this.queue = task.catch(() => {});
    return task;
  }
  private fail(operation: 'sync' | 'logout', message: string) {
    this.publish({ phase: 'error', operation, message,
      ...(operation === 'logout' ? { interactiveLogout: this.interactiveLogout } : {}) });
    return false;
  }
  synchronize(force = false): Promise<boolean> {
    if (this.logoutBlocked) return Promise.resolve(false);
    if (this.syncFlight) return this.syncFlight;
    const task = this.enqueue(async () => {
      if (this.logoutBlocked) return false;
      try {
        this.publish({ phase: 'syncing' });
        // If the server wrote cookies but SDK adoption failed, retry adoption
        // of that exact pair first, rather than rotating an old refresh token.
        if (this.pendingAdoption) return await this.adopt();
        const { data, error } = await this.auth.getSession();
        if (error) return this.fail('sync',
          classifyAuthFailure(error as Parameters<typeof classifyAuthFailure>[0]) === 'rate-limit'
            ? 'Превышен лимит запросов. Повторите попытку позже.' : 'Не удалось проверить сессию. Повторите попытку.');
        if (!data.session) {
          // Missing browser storage alone is not a reason to delete server cookies.
          this.confirmed = null;
          this.publish({ phase: 'anon' });
          return false;
        }
        const tokens = data.session;
        if (this.confirmed?.access_token === tokens.access_token && this.confirmed.refresh_token === tokens.refresh_token) {
          this.publish({ phase: 'authed' });
          return true;
        }
        if (!force && this.initialized && await this.tabs?.isConfirmed(tokens)) {
          this.confirmed = tokens;
          this.failedTokens = null;
          this.publish({ phase: 'authed' });
          return true;
        }
        if (!force && this.failedTokens?.access_token === tokens.access_token &&
            this.failedTokens.refresh_token === tokens.refresh_token) {
          return this.fail('sync', 'Сессия не синхронизирована. Повторите попытку.');
        }
        const result = await this.sync(tokens);
        if (!result.ok) {
          this.failedTokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
          return this.fail('sync', result.status === 429 ? 'Превышен лимит запросов. Повторите попытку позже.' :
            result.status === 401 ? 'Сессия отклонена сервером. Повторите вход через Google.' :
            'Не удалось синхронизировать сессию. Повторите попытку.');
        }
        this.pendingAdoption = result.session;
        this.pendingSource = tokens;
        return await this.adopt();
      } catch {
        return this.fail('sync', 'Не удалось синхронизировать сессию. Повторите попытку.');
      }
    });
    this.syncFlight = task;
    void task.finally(() => { if (this.syncFlight === task) this.syncFlight = null; });
    return task;
  }
  private async adopt() {
    const tokens = this.pendingAdoption!;
    const current = await this.auth.getSession();
    if (current.error) return this.fail('sync', 'Cookies записаны, но сессия браузера не проверена. Повторите попытку.');
    const matches = (other: SessionTokens | null) => !!other &&
      current.data.session?.access_token === other.access_token &&
      current.data.session.refresh_token === other.refresh_token;
    if (!matches(this.pendingSource) && !matches(tokens)) {
      // OAuth/signout or another SDK refresh happened while fetch was pending.
      // Do not overwrite the newer browser identity with the old response.
      this.pendingAdoption = null;
      this.pendingSource = null;
      this.confirmed = null;
      return this.fail('sync', 'Сессия изменилась во время синхронизации. Повторите попытку.');
    }
    await this.tabs?.confirm(tokens);
    const { data, error } = await this.auth.setSession(tokens);
    if (error || !data.session || data.session.access_token !== tokens.access_token ||
        data.session.refresh_token !== tokens.refresh_token) {
      return this.fail('sync', 'Cookies записаны, но сессия браузера не обновлена. Повторите попытку.');
    }
    this.confirmed = tokens;
    this.serverSignedOut = false;
    this.initialized = true;
    this.pendingAdoption = null;
    this.pendingSource = null;
    this.failedTokens = null;
    this.publish({ phase: 'authed' });
    return !this.logoutBlocked;
  }
  /** SIGNED_OUT emitted during explicit logout is handled by that same task. */
  signedOut() {
    if (this.logoutBlocked || this.serverSignedOut) return Promise.resolve(this.serverSignedOut && !this.logoutBlocked);
    return this.logout(false);
  }
  logout(revoke = true): Promise<boolean> {
    if (this.logoutFlight) return this.logoutFlight;
    // Block subsequent auth events immediately, before waiting for a pending sync.
    this.logoutBlocked = true;
    this.interactiveLogout = revoke;
    this.publish({ phase: 'logging-out' });
    const task = this.enqueue(async () => {
      try {
        if (revoke) {
          const { error } = await this.auth.signOut();
          if (error) return this.fail('logout', 'Не удалось завершить сессию Supabase. Выход не выполнен. Повторите попытку.');
        }
        const { data, error } = await this.auth.getSession();
        if (error) return this.fail('logout', 'Не удалось проверить состояние выхода. Cookies сохранены. Повторите попытку.');
        if (data.session) {
          if (revoke) return this.fail('logout', 'Сессия браузера осталась активной. Выход не подтверждён. Повторите попытку.');
          // A queued SIGNED_OUT event can precede a newer SIGNED_IN event.
          this.logoutBlocked = false;
          this.publish({ phase: 'unknown' });
          void this.synchronize();
          return false;
        }
        if (!await this.clear()) return this.fail('logout', 'Сессия браузера завершена, но серверные cookies не очищены. Повторите выход.');
        this.confirmed = null;
        this.pendingAdoption = null;
        this.pendingSource = null;
        this.failedTokens = null;
        this.serverSignedOut = true;
        await this.tabs?.confirm(null);
        this.logoutBlocked = false;
        this.publish({ phase: 'anon' });
        return true;
      } catch { return this.fail('logout', 'Не удалось завершить выход. Повторите попытку.'); }
    });
    this.logoutFlight = task;
    void task.finally(() => { if (this.logoutFlight === task) this.logoutFlight = null; });
    return task;
  }
}

export function authRedirect(state: BrowserAuthState, pathname: string, guest = false): string | null {
  const locale = localeFromPath(pathname);
  pathname = stripLocale(pathname);
  if (state.phase === 'anon' && !guest && pathname !== '/login' && pathname !== '/auth/callback') return localizedPath('/login', locale);
  if (state.phase === 'authed' && pathname === '/login') return localizedPath('/', locale);
  return null;
}

let browserSession: BrowserSession | undefined;
export function getBrowserSession() {
  if (typeof window === 'undefined') throw new Error('Browser session requires a browser');
  return browserSession ??= new BrowserSession(createBrowserClient().auth, postSessionSync, postSessionLogout,
    browserTabCoordination());
}
