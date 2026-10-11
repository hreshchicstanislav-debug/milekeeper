import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pathname: '/', max: vi.fn(), entries: vi.fn(), items: vi.fn(), events: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('next/link', () => ({ default: ({ prefetch, children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock('@/lib/i18n/server', async () => ({ getCopy: async () => (await import('@/lib/i18n/copy')).createCopy(mocks.pathname.startsWith('/en') ? 'en' : 'ru') }));
vi.mock('@/lib/actions/odometerActions', () => ({ getMaxMileageEntry: mocks.max, listOdometerEntries: mocks.entries }));
vi.mock('@/lib/actions/serviceActions', () => ({ listServiceItems: mocks.items, listLastServiceEventsForItems: mocks.events }));
vi.mock('../AddMileageForm', () => ({ default: ({ buttonLabel }: any) => <button>{buttonLabel || 'mileage form'}</button> }));
vi.mock('../AddServiceItemForm', () => ({ default: () => <button>item form</button> }));
vi.mock('../HomeContentClient', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('../HomeSoonMaintenanceBlock', () => ({ default: () => null }));
vi.mock('../HomeAdaptiveContent', () => ({ default: () => <p>generic prediction hint</p> }));
import Home from '@/app/page';
import HomeGettingStarted from '../HomeGettingStarted';
const reading = { id: 'reading', user_id: 'test', mileage_km: 120000, occurred_at: '2026-10-11T08:00:00Z', created_at: '2026-10-11T08:00:00Z', note: null };
const item = { id: 'oil', title: 'Personal масло', measurement_mode: 'km', interval_km: 10000, interval_days: null, notify_before_days: 30 };
beforeEach(() => { vi.clearAllMocks(); mocks.pathname = '/'; mocks.max.mockResolvedValue(null); mocks.entries.mockResolvedValue([]); mocks.items.mockResolvedValue([]); mocks.events.mockResolvedValue({}); vi.stubEnv('NEXT_PUBLIC_DEV_GUEST_MODE', '0'); });
it.each(['/', '/en'])('renders a single first-reading action and localized demo on %s', async pathname => {
  mocks.pathname = pathname;
  const html = renderToStaticMarkup(await Home());
  expect(html).toContain('data-step="odometer"');
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain(pathname === '/' ? 'href="/demo"' : 'href="/en/demo"');
  expect(html).toContain(pathname === '/' ? 'Добавить первое показание' : 'Add first reading');
  expect(html).not.toContain('generic prediction hint');
});
it.each(['max', 'entries', 'items', 'events'] as const)('propagates %s loader errors without rendering empty onboarding', async source => {
  if (source === 'events') { mocks.max.mockResolvedValue(reading); mocks.entries.mockResolvedValue([reading]); mocks.items.mockResolvedValue([item]); }
  mocks[source].mockRejectedValue(new Error('network failure'));
  await expect(Home()).rejects.toThrow('network failure');
});
it('does not render onboarding for dev guest auth fallback', async () => {
  vi.stubEnv('NEXT_PUBLIC_DEV_GUEST_MODE', '1'); mocks.max.mockRejectedValue(new Error('Not authenticated'));
  expect(renderToStaticMarkup(await Home())).not.toContain('data-step=');
});
it.each(['/', '/en'])('links to the existing item screen and preserves personal titles on %s', pathname => {
  mocks.pathname = pathname;
  const html = renderToStaticMarkup(<HomeGettingStarted step={{ kind: 'replacement', item: { id: 'oil', title: 'Personal масло' } }} />);
  expect(html).toContain(`href="${pathname === '/' ? '' : '/en'}/items/oil"`);
  expect(html).toContain('Personal масло');
  expect(html).toContain(pathname === '/' ? 'Если данных нет, оставьте элемент без записи' : 'If you don’t have this information, leave the item without a replacement record');
  expect(html).not.toContain('role="dialog"');
});

it.each(['/', '/en'])('explains mileage history and existing calendar support on %s', pathname => {
  mocks.pathname = pathname;
  const html = renderToStaticMarkup(<HomeGettingStarted step={{ kind: 'history' }} />);
  expect(html).toContain(pathname === '/' ? 'После следующей поездки добавьте новое показание одометра в другой календарный день.' : 'After your next drive, add a new odometer reading on a different calendar day.');
  expect(html).toContain(pathname === '/' ? 'Календарные сроки уже работают. Остаток километров доступен для элементов с интервалом по пробегу.' : 'Calendar-based due dates already work. Remaining kilometres are available for items with a mileage interval.');
});
