import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/demo', client: vi.fn(), subscribe: vi.fn(), authEvents: vi.fn(),
  remember: vi.fn(), saveOAuth: vi.fn(), push: vi.fn(), oauth: vi.fn(), assign: vi.fn(), replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/supabase/browserClient', () => ({ createBrowserClient: mocks.client }));
vi.mock('@/lib/auth/browserSession', async original => ({ ...await original<typeof import('@/lib/auth/browserSession')>(), getBrowserSession: () => ({ subscribe: mocks.subscribe }) }));
vi.mock('@/lib/i18n/routing', async original => ({ ...await original<typeof import('@/lib/i18n/routing')>(), rememberLocale: mocks.remember, saveOAuthLocale: mocks.saveOAuth }));
vi.mock('../BottomNav', () => ({ default: () => <nav>private nav</nav> }));
vi.mock('../TopBreadcrumbsBar', () => ({ default: () => <div>private breadcrumbs</div> }));
vi.mock('../ScrollLockRouteGuard', () => ({ default: () => null }));
import AppShell from '../AppShell';
import LanguageSwitcher from '../LanguageSwitcher';
import LoginPageClient from '@/app/login/pageClient';

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { pathname: '/demo', origin: 'https://milekeeper.test', search: '', hash: '', assign: mocks.assign }, history: { pushState: mocks.push } });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  mocks.pathname = '/demo';
  mocks.client.mockReturnValue({ auth: { onAuthStateChange: mocks.authEvents, signInWithOAuth: mocks.oauth } });
  mocks.authEvents.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.subscribe.mockReturnValue(vi.fn());
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.unstubAllGlobals(); });
async function mount(element: React.ReactElement) { await act(async () => { tree = create(element); }); }

it.each(['/demo', '/en/demo'])('does not initialize the actual AuthGate or private chrome on %s', async path => {
  mocks.pathname = path;
  await mount(<AppShell><p>example</p></AppShell>);
  expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.subscribe).not.toHaveBeenCalled(); expect(mocks.authEvents).not.toHaveBeenCalled();
  expect(tree!.root.findAllByType('nav')).toHaveLength(0);
});
it('mounts auth for private routes and unmounts it when entering demo, including client navigation back', async () => {
  mocks.pathname = '/en/items';
  await mount(<AppShell><p>private</p></AppShell>);
  expect(mocks.client).toHaveBeenCalledTimes(1); expect(mocks.authEvents).toHaveBeenCalledTimes(1);
  expect(tree!.root.findAllByType('nav')).toHaveLength(1);
  const unsubscribe = mocks.subscribe.mock.results[0].value;
  mocks.pathname = '/en/demo';
  await act(async () => tree!.update(<AppShell><p>example</p></AppShell>));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(tree!.root.findAllByType('nav')).toHaveLength(0);
  expect(mocks.client).toHaveBeenCalledTimes(1);
  mocks.pathname = '/history';
  await act(async () => tree!.update(<AppShell><p>private</p></AppShell>));
  expect(mocks.client).toHaveBeenCalledTimes(2);
});
it('switches the demo URL without persisting a personal locale preference', async () => {
  await mount(<LanguageSwitcher persistPreference={false} />);
  await act(async () => tree!.root.findAllByType('button')[1].props.onClick());
  expect(mocks.push).toHaveBeenCalledWith(null, '', '/en/demo');
  expect(mocks.remember).not.toHaveBeenCalled();
});
it('retains preference persistence in the existing private shell', async () => {
  await mount(<LanguageSwitcher />);
  await act(async () => tree!.root.findAllByType('button')[1].props.onClick());
  expect(mocks.remember).toHaveBeenCalledWith('en');
});
it.each(['/login', '/en/login'])('keeps independent demo and the original Google OAuth request on %s', async path => {
  mocks.pathname = path;
  mocks.oauth.mockResolvedValue({ data: { url: 'https://fixture.test/oauth' }, error: null });
  await mount(<LoginPageClient />);
  expect(tree!.root.findByType('a').props.href).toBe(path === '/login' ? '/demo' : '/en/demo');
  expect(mocks.oauth).not.toHaveBeenCalled();
  await act(async () => tree!.root.findByType('button').props.onClick());
  expect(mocks.oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://milekeeper.test/auth/callback' } });
  expect(mocks.saveOAuth).toHaveBeenCalledWith(path === '/login' ? 'ru' : 'en');
  expect(mocks.assign).toHaveBeenCalledWith('https://fixture.test/oauth');
});
