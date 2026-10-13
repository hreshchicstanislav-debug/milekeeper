import { localeFromPath, stripLocale, localizedPath } from '@/lib/i18n/routing';
import { createBrowserClient } from '@/lib/supabase/browserClient';
import { postSessionLogout, postSessionSync, postSessionRecovery } from './sessionSync';
import type { SessionTokens } from './validateSession';
import { browserTabCoordination, type TabCoordination } from './sessionTabCoordination';
import { classifyAuthFailure } from './authFailure';

type Result = { error: unknown; data: { session: SessionTokens | null } };
type Auth = {
  getSession(): Promise<Result>;
  setSession(tokens: SessionTokens): Promise<Result>;
  signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
};
export type BrowserAuthState = {
  phase: 'unknown' | 'syncing' | 'authed' | 'anon' | 'error' | 'logging-out' | 'reauth';
  operation?: 'sync' | 'logout';
  message?: string;
  interactiveLogout?: boolean;
  sessionMissing?: boolean;
  cookiesVerified?: boolean;
};

/** Serializes cookie writes, SDK adoption and logout. Shared by callback and gate.
 * No async SDK calls run inside onAuthStateChange's lock-held callback.
 */
export class BrowserSession {
  state: BrowserAuthState = { phase: 'unknown' };
  private listeners = new Set<(state: BrowserAuthState) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private syncFlight: Promise<boolean> | null = null;
  private syncProof: { verified: boolean } | null = null;
  private logoutFlight: Promise<boolean> | null = null;
  private confirmed: SessionTokens | null = null;
  private pendingAdoption: SessionTokens | null = null;
  private pendingSource: SessionTokens | null = null;
  private failedTokens: SessionTokens | null = null;
  private logoutBlocked = false;
  private serverSignedOut = false;
  private initialized = false;
  private recoveryFailure: BrowserAuthState | null = null;
  private interactiveLogout = false;

  constructor(private auth: Auth, private sync = postSessionSync, private clear = postSessionLogout,
    private tabs?: TabCoordination, private recover = postSessionRecovery) {}
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
  private enqueue(work: () => Promise<boolean>, operation: 'sync' | 'logout' = 'sync') {
    const task = this.queue.then(() => this.tabs ? this.tabs.exclusive(work) : work()).catch(() =>
      this.fail(operation, operation === 'logout' ? 'Не удалось завершить выход. Повторите попытку.'
        : 'Не удалось синхронизировать сессию. Повторите попытку.'));
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
    if (this.syncFlight) {
      const flight = this.syncFlight, proof = this.syncProof;
      // A forced recovery may share a real cookie verification, but not a
      // background flight that merely reused the in-memory confirmation.
      return force ? flight.then(ok => ok && !proof?.verified ? this.synchronize(true) : ok) : flight;
    }
    const proof = { verified: false };
    this.syncProof = proof;
    const task = this.enqueue(async () => {
      if (this.logoutBlocked) return false;
      try {
        this.publish({ phase: 'syncing' });
        // If the server wrote cookies but SDK adoption failed, retry adoption
        // of that exact pair first, rather than rotating an old refresh token.
        if (this.pendingAdoption) return await this.adopt();
        const { data, error } = await this.auth.getSession();
        const kind = error ? classifyAuthFailure(error as Parameters<typeof classifyAuthFailure>[0]) : null;
        if (error && kind !== 'invalid') return this.fail('sync', kind === 'rate-limit'
          ? 'Превышен лимит запросов. Повторите попытку позже.' : 'Не удалось проверить сессию. Повторите попытку.');
        if (!data.session || kind === 'invalid') {
          this.confirmed = null;
          // Old versions may have rotated only the cookie copy. Recover that
          // session if SDK storage is absent/rejected, before offering login.
          if (this.serverSignedOut) { this.publish({ phase: 'anon' }); return false; }
          if (this.recoveryFailure && !force) {
            this.publish(this.recoveryFailure);
            return false;
          }
          const result = await this.recover();
          if (!result.ok) {
            if (result.status === 401) {
              this.publish({ phase: 'reauth', sessionMissing: result.missing === true,
                message: result.missing ? 'Сессия входа отсутствует. Повторите вход.'
                  : 'Сессия отклонена сервером. Повторите вход через Google.' });
            } else {
              this.fail('sync', result.status === 429
                ? 'Превышен лимит запросов. Повторите попытку позже.' : 'Не удалось проверить сессию. Повторите попытку.');
            }
            this.recoveryFailure = this.state;
            return false;
          }
          this.pendingAdoption = result.session;
          this.pendingSource = null;
          proof.verified = true;
          return await this.adopt();
        }
        const tokens = data.session;
        if (!force && this.confirmed?.access_token === tokens.access_token && this.confirmed.refresh_token === tokens.refresh_token) {
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
        this.confirmed = null;
        const result = await this.sync(tokens);
        if (!result.ok) {
          this.failedTokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
          if (result.status === 401) {
            this.publish({ phase: 'reauth', message: 'Сессия отклонена сервером. Повторите вход через Google.' });
            return false;
          }
          return this.fail('sync', result.status === 429 ? 'Превышен лимит запросов. Повторите попытку позже.' :
            'Не удалось синхронизировать сессию. Повторите попытку.');
        }
        this.pendingAdoption = result.session;
        this.pendingSource = tokens;
        proof.verified = true;
        return await this.adopt();
      } catch {
        return this.fail('sync', 'Не удалось синхронизировать сессию. Повторите попытку.');
      }
    });
    this.syncFlight = task;
    void task.finally(() => { if (this.syncFlight === task) { this.syncFlight = null; this.syncProof = null; } });
    return task;
  }
  private async adopt() {
    const tokens = this.pendingAdoption!;
    const current = await this.auth.getSession();
    if (current.error) return this.fail('sync', 'Cookies записаны, но сессия браузера не проверена. Повторите попытку.');
    const matches = (other: SessionTokens | null) => !!other &&
      current.data.session?.access_token === other.access_token &&
      current.data.session.refresh_token === other.refresh_token;
    if (!(this.pendingSource === null && !current.data.session) && !matches(this.pendingSource) && !matches(tokens)) {
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
    this.recoveryFailure = null;
    this.pendingAdoption = null;
    this.pendingSource = null;
    this.failedTokens = null;
    this.publish({ phase: 'authed', cookiesVerified: true });
    return !this.logoutBlocked;
  }
  /** SDK rejection is recoverable and must not unmount an open form or erase
   * cookies that may contain a newer generation. Explicit logout owns clearing.
   */
  signedOut() {
    if (this.logoutBlocked || this.serverSignedOut) return Promise.resolve(false);
    return this.synchronize();
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
          const { error } = await this.auth.signOut({ scope: 'local' });
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
    }, 'logout');
    this.logoutFlight = task;
    void task.finally(() => { if (this.logoutFlight === task) this.logoutFlight = null; });
    return task;
  }
}

export function authRedirect(state: BrowserAuthState, pathname: string, guest = false): string | null {
  const locale = localeFromPath(pathname);
  pathname = stripLocale(pathname);
  if (state.phase === 'anon' && !guest && pathname !== '/login' && pathname !== '/auth/callback' && pathname !== '/auth/recover') return localizedPath('/login', locale);
  if (state.phase === 'authed' && pathname === '/login') return localizedPath('/', locale);
  return null;
}

let browserSession: BrowserSession | undefined;
export function getBrowserSession() {
  if (typeof window === 'undefined') throw new Error('Browser session requires a browser');
  return browserSession ??= new BrowserSession(createBrowserClient().auth, postSessionSync, postSessionLogout,
    browserTabCoordination());
}
