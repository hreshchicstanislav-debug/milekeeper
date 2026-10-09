import React from 'react';
import { renderToString } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEMO_WELCOME_KEY, hasSeenDemoWelcome, rememberDemoWelcome } from '../welcome';

const mocks = vi.hoisted(() => ({ locale: 'ru', lock: vi.fn(), unlock: vi.fn() }));
vi.mock('@/lib/i18n/client', () => ({ useCopy: () => ({ locale: mocks.locale }) }));
vi.mock('@/lib/ui/scrollLock', () => ({ lockScroll: mocks.lock, unlockScroll: mocks.unlock }));
vi.mock('@/app/components/LanguageSwitcher', () => ({ default: ({ persistPreference }: { persistPreference: boolean }) => <span data-persist={persistPreference} /> }));
import DemoWelcome from '@/app/demo/DemoWelcome';

let tree: ReactTestRenderer | undefined;
let storage: Map<string, string>;
let getItem = vi.fn<[string], string | null>(), setItem = vi.fn<[string, string], void>();
const dialog = { showModal: vi.fn(), close: vi.fn(), querySelector: () => null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.locale = 'ru'; storage = new Map();
  getItem = vi.fn((key: string) => storage.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => { storage.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem, setItem } });
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.unstubAllGlobals(); });
async function mount() { await act(async () => { tree = create(<DemoWelcome />, { createNodeMock: element => element.type === 'dialog' ? dialog : { focus: vi.fn() } }); }); }
const buttons = () => tree!.root.findAllByType('button');

it('does not access storage or render a dialog during SSR', () => {
  const html = renderToString(<DemoWelcome />);
  expect(html).toContain('О MileKeeper'); expect(html).not.toContain('<dialog');
  expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
});
it('shows after mounting and writes only the shared marker when closed', async () => {
  await mount(); expect(dialog.showModal).toHaveBeenCalledTimes(1);
  expect(setItem).not.toHaveBeenCalled();
  await act(async () => buttons().at(-1)!.props.onClick());
  expect(tree!.root.findAllByType('dialog')).toHaveLength(0);
  expect(setItem).toHaveBeenCalledTimes(1); expect(setItem).toHaveBeenCalledWith(DEMO_WELCOME_KEY, 'seen');
  expect(mocks.unlock).toHaveBeenCalledTimes(1);
});
it.each(['ru', 'en'])('shares dismissal across languages and remounts (%s)', async locale => {
  rememberDemoWelcome(); mocks.locale = locale;
  await mount(); expect(tree!.root.findAllByType('dialog')).toHaveLength(0);
  await act(async () => buttons()[0].props.onClick());
  expect(tree!.root.findAllByType('dialog')).toHaveLength(1);
  expect(tree!.root.findByType('span').props['data-persist']).toBe(false);
});
it('keeps an open dialog mounted during locale changes without writing preferences', async () => {
  await mount(); mocks.locale = 'en';
  await act(async () => tree!.update(<DemoWelcome />));
  expect(tree!.root.findByType('h2').children.join('')).toBe('Keep your car maintenance on track');
  expect(dialog.showModal).toHaveBeenCalledTimes(1); expect(setItem).not.toHaveBeenCalled();
});
it('closes on Escape and remembers dismissal', async () => {
  await mount(); const preventDefault = vi.fn();
  await act(async () => tree!.root.findByType('dialog').props.onCancel({ preventDefault }));
  expect(preventDefault).toHaveBeenCalled(); expect(hasSeenDemoWelcome()).toBe(true);
  expect(tree!.root.findAllByType('dialog')).toHaveLength(0);
});
it('continues when reads and writes fail', async () => {
  getItem.mockImplementation(() => { throw new Error('denied'); });
  setItem.mockImplementation(() => { throw new Error('quota'); });
  await mount(); expect(tree!.root.findAllByType('dialog')).toHaveLength(1);
  await act(async () => buttons().at(-1)!.props.onClick());
  expect(tree!.root.findAllByType('dialog')).toHaveLength(0);
  await act(async () => buttons()[0].props.onClick());
  expect(tree!.root.findAllByType('dialog')).toHaveLength(1);
});
it('handles a denied localStorage getter', () => {
  vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', { get() { throw new Error('denied'); } }));
  expect(hasSeenDemoWelcome()).toBe(false); expect(() => rememberDemoWelcome()).not.toThrow();
});
