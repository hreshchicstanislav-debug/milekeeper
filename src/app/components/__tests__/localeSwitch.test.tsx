import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pathname: '/en/login', refresh: vi.fn(), oauth: vi.fn(), assign: vi.fn(), pushState: vi.fn(), store: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('next/link', () => ({ default: (props: React.ComponentProps<'a'> & { prefetch?: boolean }) => <a {...props} /> }));
vi.mock('@/lib/supabase/browserClient', () => ({ createBrowserClient: () => ({ auth: { signInWithOAuth: mocks.oauth } }) }));
import { LocaleProvider } from '@/lib/i18n/client';
import LanguageSwitcher from '../LanguageSwitcher';
import BottomNav from '../BottomNav';
import Login from '@/app/login/pageClient';
let tree: ReactTestRenderer | undefined;
const mount = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.pathname = '/en/login';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', { protocol: 'https:' });
  vi.stubGlobal('document', { cookie: '', documentElement: { lang: 'ru' }, querySelector: () => null });
  vi.stubGlobal('sessionStorage', { setItem: mocks.store });
  vi.stubGlobal('window', { location: { origin: 'https://milekeeper.test', pathname: '/en/items/123', search: '?tab=calc', hash: '#details', assign: mocks.assign }, history: { pushState: mocks.pushState } });
  mocks.oauth.mockResolvedValue({ data: { url: 'https://project.supabase.co/auth/v1/authorize' }, error: null });
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.unstubAllGlobals(); });
it('preserves the page, query and fragment when switching and writes only a locale cookie', async () => {
  mocks.pathname = '/en/items/123'; await mount(<LanguageSwitcher />);
  await act(async () => { tree!.root.findAllByType('button')[0].props.onClick(); });
  expect(mocks.pushState).toHaveBeenCalledWith(null, '', '/items/123?tab=calc#details');
  expect(mocks.refresh).not.toHaveBeenCalled(); expect(document.cookie).toContain('mk_locale=ru;');
  expect(document.cookie).not.toContain('mk_sb');
});
it('saves the originating English locale while keeping the exact shared OAuth callback', async () => {
  await mount(<Login />); await act(async () => { await tree!.root.findByType('button').props.onClick(); });
  expect(mocks.oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://milekeeper.test/auth/callback' } });
  expect(mocks.store).toHaveBeenCalledWith('milekeeper:oauth-locale', 'en');
  expect(document.cookie).toContain('mk_locale=en;'); expect(mocks.assign).toHaveBeenCalledOnce();
});
it.each(['/login', '/en/login', '/auth/callback'])('does not prefetch stale anonymous redirects on %s', async pathname => {
  mocks.pathname = pathname; await mount(<BottomNav />);
  for (const link of tree!.root.findAllByType('a')) expect(link.props.prefetch).toBe(false);
});

it('refreshes server copy after the URL locale changes and stops once matching RSC props arrive', async () => {
  mocks.pathname = '/en'; await mount(<LocaleProvider initialLocale="en"><span /></LocaleProvider>);
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.pathname = '/'; await act(async () => { tree!.update(<LocaleProvider initialLocale="en"><span /></LocaleProvider>); });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  await act(async () => { tree!.update(<LocaleProvider initialLocale="ru"><span /></LocaleProvider>); });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
