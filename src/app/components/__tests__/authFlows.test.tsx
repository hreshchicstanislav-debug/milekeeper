import React, { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSession } from '@/lib/auth/browserSession';

const mocks = vi.hoisted(() => ({
  pathname: '/login', params: new URLSearchParams(), replace: vi.fn(),
  getSession: vi.fn(), setSession: vi.fn(), signOut: vi.fn(), exchange: vi.fn(),
  subscribe: vi.fn(), manager: undefined as unknown,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.params,
}));
vi.mock('@/lib/supabase/browserClient', () => ({ createBrowserClient: () => client }));
vi.mock('@/lib/auth/browserSession', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth/browserSession')>(),
  getBrowserSession: () => mocks.manager,
}));
import AuthGate from '../AuthGate';
import AuthCallback from '@/app/auth/callback/pageClient';
import TopBreadcrumbsBar from '../TopBreadcrumbsBar';
const router = { replace: mocks.replace };
const client = { auth: {
  getSession: mocks.getSession, setSession: mocks.setSession, signOut: mocks.signOut,
  exchangeCodeForSession: mocks.exchange, onAuthStateChange: mocks.subscribe,
} };
const original = { access_token: 'at-a', refresh_token: 'rt-a' };
const rotated = { access_token: 'at-b', refresh_token: 'rt-b' };
const sync = vi.fn();
const clear = vi.fn();
let current: typeof original | null;
let listeners: Array<(event: string, session: typeof original | null) => void>;
let tree: ReactTestRenderer | undefined;
const flush = async () => { await act(async () => { await vi.runAllTimersAsync(); }); };
const mount = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  mocks.pathname = '/login'; mocks.params = new URLSearchParams();
  current = original; listeners = [];
  mocks.getSession.mockImplementation(async () => ({ data: { session: current }, error: null }));
  mocks.setSession.mockImplementation(async tokens => {
    current = tokens;
    listeners.forEach(listener => listener('SIGNED_IN', tokens));
    return { data: { session: tokens }, error: null };
  });
  mocks.signOut.mockImplementation(async () => {
    current = null;
    listeners.forEach(listener => listener('SIGNED_OUT', null));
    return { error: null };
  });
  mocks.exchange.mockImplementation(async () => { current = original; return { data: { session: current }, error: null }; });
  mocks.subscribe.mockImplementation(callback => {
    listeners.push(callback);
    Promise.resolve().then(() => callback('INITIAL_SESSION', current));
    return { data: { subscription: { unsubscribe: () => { listeners = listeners.filter(listener => listener !== callback); } } } };
  });
  sync.mockResolvedValue({ ok: true, session: rotated }); clear.mockResolvedValue(true);
  mocks.manager = new BrowserSession(client.auth, sync, clear);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('callback UI', () => {
  it('stays on callback after refused cookie sync and only navigates after an explicit successful retry', async () => {
    mocks.pathname = '/auth/callback';
    sync.mockResolvedValueOnce({ ok: false, status: 503 });
    await mount(<AuthCallback />);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(tree!.root.findByProps({ role: 'alert' }).children.join('')).toContain('синхронизировать');
    await act(async () => { tree!.root.findByType('button').props.onClick(); });
    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(sync).toHaveBeenCalledTimes(2);
  });
  it('exchanges a one-use code once under StrictMode and does not exchange it again for sync retry', async () => {
    mocks.pathname = '/auth/callback'; mocks.params = new URLSearchParams('code=one-use'); current = null;
    sync.mockResolvedValueOnce({ ok: false, status: 429 });
    await mount(<StrictMode><AuthCallback /></StrictMode>);
    expect(mocks.exchange).toHaveBeenCalledOnce();
    expect(mocks.exchange).toHaveBeenCalledWith('one-use');
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => { tree!.root.findByType('button').props.onClick(); });
    expect(mocks.exchange).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });
  it('displays OAuth failure without redirect loops or deleting an existing session', async () => {
    mocks.pathname = '/auth/callback'; mocks.params = new URLSearchParams('error=access_denied');
    await mount(<AuthCallback />);
    expect(tree!.root.findByProps({ role: 'alert' }).children.join('')).toContain('Google');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});

describe('AuthGate UI', () => {
  it('does not bounce from login to home on a failed sync; explicit retry performs one navigation', async () => {
    sync.mockResolvedValueOnce({ ok: false, status: 429 });
    await mount(<AuthGate />); await flush();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(tree!.root.findByProps({ role: 'alert' })).toBeDefined();
    await act(async () => { tree!.root.findByType('button').props.onClick(); });
    await flush();
    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(sync).toHaveBeenCalledTimes(2); // SDK's SIGNED_IN after adoption did not sync again
    mocks.pathname = '/';
    await act(async () => { tree!.update(<AuthGate />); });
    expect(mocks.replace).toHaveBeenCalledOnce();
  });
  it('redirects an absent session to login once and stops there', async () => {
    current = null; mocks.pathname = '/';
    await mount(<AuthGate />); await flush();
    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/login');
    mocks.pathname = '/login';
    await act(async () => { tree!.update(<AuthGate />); });
    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('logout UI', () => {
  async function openAndExit() {
    mocks.pathname = '/';
    await mount(<><AuthGate /><TopBreadcrumbsBar /></>); await flush();
    await act(async () => { tree!.root.findByProps({ className: 'top-breadcrumbs-logout-trigger' }).props.onClick(); });
    await act(async () => { await tree!.root.findByProps({ className: 'top-breadcrumbs-confirm-exit' }).props.onClick(); });
    await flush();
  }
  it('does not navigate or report success when Supabase signOut fails', async () => {
    mocks.signOut.mockResolvedValue({ error: { status: 503 } });
    await openAndExit();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(tree!.root.findByProps({ role: 'alert' }).children.join('')).toContain('Выход не выполнен');
  });
  it('retains a retry dialog after partial cookie-clear failure and prevents gate redirect', async () => {
    clear.mockResolvedValueOnce(false);
    await openAndExit();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(tree!.root.findByProps({ role: 'alert' }).children.join('')).toContain('cookies не очищены');
    await act(async () => { await tree!.root.findByProps({ className: 'top-breadcrumbs-confirm-exit' }).props.onClick(); });
    await flush();
    expect(mocks.replace.mock.calls.every(([path]) => path === '/login')).toBe(true);
    expect(mocks.replace).toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(2);
  });
  it('navigates to login after both logout operations succeed', async () => {
    await openAndExit();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/login');
    expect(sync).toHaveBeenCalledOnce();
  });
});

it('allows explicit retry after a temporary callback session-read error without logging out', async () => {
  mocks.pathname = '/auth/callback';
  mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: { status: 429 } });
  await mount(<AuthCallback />);
  expect(mocks.replace).not.toHaveBeenCalled();
  await act(async () => { tree!.root.findByType('button').props.onClick(); });
  expect(mocks.replace).toHaveBeenCalledWith('/');
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it('shows a retry action for an automatic sign-out cookie-clear failure', async () => {
  mocks.pathname = '/';
  await mount(<AuthGate />); await flush();
  clear.mockResolvedValueOnce(false);
  current = null;
  await act(async () => { listeners.forEach(listener => listener('SIGNED_OUT', null)); });
  await flush();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(tree!.root.findByProps({ role: 'alert' }).children.length).toBeGreaterThan(0);
  await act(async () => { tree!.root.findByType('button').props.onClick(); });
  expect(mocks.replace).toHaveBeenCalledWith('/login');
});

describe('English auth flow', () => {
  it('returns from the shared callback to /en only after confirmed synchronization', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'en' });
    mocks.pathname = '/auth/callback';
    sync.mockResolvedValueOnce({ ok: false, status: 503 });
    await mount(<AuthCallback />);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(tree!.root.findByProps({ role: 'alert' }).children.join('')).toContain('synchronize');
    expect(tree!.root.findByType('a').props.href).toBe('/en/login');
    await act(async () => { tree!.root.findByType('button').props.onClick(); });
    expect(mocks.replace).toHaveBeenCalledWith('/en');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('switches an authenticated gate between RU and EN without a second sync or sign-out', async () => {
    mocks.pathname = '/'; await mount(<AuthGate />); await flush();
    expect(sync).toHaveBeenCalledOnce();
    for (const pathname of ['/en', '/en/items', '/items']) {
      mocks.pathname = pathname;
      await act(async () => { tree!.update(<AuthGate />); }); await flush();
    }
    expect(sync).toHaveBeenCalledOnce(); expect(clear).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.replace).not.toHaveBeenCalled();
  });
  it('redirects an anonymous English session to English login', async () => {
    current = null; mocks.pathname = '/en/items'; await mount(<AuthGate />); await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/en/login');
  });
  it('keeps an authenticated English login in the English app', async () => {
    mocks.pathname = '/en/login'; await mount(<AuthGate />); await flush();
    expect(mocks.replace).toHaveBeenCalledWith('/en');
  });
  it('signs out to English login after both operations succeed', async () => {
    mocks.pathname = '/en'; await mount(<><AuthGate /><TopBreadcrumbsBar /></>); await flush();
    await act(async () => { tree!.root.findByProps({ className: 'top-breadcrumbs-logout-trigger' }).props.onClick(); });
    await act(async () => { await tree!.root.findByProps({ className: 'top-breadcrumbs-confirm-exit' }).props.onClick(); }); await flush();
    expect(mocks.signOut).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/en/login');
  });
});
