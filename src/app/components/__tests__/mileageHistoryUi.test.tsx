import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEvent } from '@/lib/db/types';

const mocks = vi.hoisted(() => ({ pathname: '/', max: vi.fn(), entries: vi.fn(), items: vi.fn(), events: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
type WithChildren = { children?: React.ReactNode };
vi.mock('next/link', () => ({ default: ({ children, href }: WithChildren & { href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/i18n/server', async () => ({ getCopy: async () => (await import('@/lib/i18n/copy')).createCopy(mocks.pathname.startsWith('/en') ? 'en' : 'ru') }));
vi.mock('@/lib/actions/odometerActions', () => ({ getMaxMileageEntry: mocks.max, listOdometerEntries: mocks.entries }));
vi.mock('@/lib/actions/serviceActions', () => ({ listServiceItems: mocks.items, listLastServiceEventsForItems: mocks.events, addServiceEvent: vi.fn(), deleteServiceEvent: vi.fn() }));
vi.mock('../AddMileageForm', () => ({ default: ({ lastMileageKm, latestReadingAt }: { lastMileageKm: number | null; latestReadingAt: string | null }) => <button data-last={String(lastMileageKm)} data-latest-at={String(latestReadingAt)}>mileage form</button> }));
vi.mock('../HomeContentClient', () => ({ default: ({ children }: WithChildren) => <div>{children}</div> }));
vi.mock('../HomeSoonMaintenanceBlock', () => ({ default: () => null }));
vi.mock('../HomeAdaptiveContent', () => ({ default: () => null }));
vi.mock('../ModalSheet', () => ({ default: ({ children }: WithChildren) => <div>{children}</div> }));

import Home from '@/app/page';
import ItemHistoryList from '../ItemHistoryList';
import AddServiceEventForm from '../AddServiceEventForm';
import { ToastProvider } from '../ToastProvider';

const reading = (id: string, occurred_at: string, mileage_km: number) => ({ id, user_id: 'u', occurred_at, mileage_km, note: null, created_at: occurred_at });
const event = (n: number, mileage_km: number, kind: ServiceEvent['kind'] = 'replacement', extra: Partial<ServiceEvent> = {}): ServiceEvent => ({
  id: `e${n}`, user_id: 'u', service_item_id: 'oil', occurred_at: new Date(Date.UTC(2025, n, 1)).toISOString(), mileage_km, note: null, created_at: '2025-01-01T00:00:00Z',
  kind, amount_liters: null, ...extra,
});
const list = (events: ServiceEvent[], props: Partial<React.ComponentProps<typeof ItemHistoryList>> = {}) => renderToStaticMarkup(
  <ToastProvider>
    <ItemHistoryList events={events} previousReplacement={null} hasMore={false} isLoadingMore={false} loadMoreFailed={false}
      onLoadMore={() => {}} onDeleted={() => {}} {...props} />
  </ToastProvider>
).replace(/[\u00a0\u202f]/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = '/';
  mocks.items.mockResolvedValue([{ id: 'oil', title: 'Oil', measurement_mode: 'km', interval_km: 10000, interval_days: null, notify_before_days: 30 }]);
  mocks.events.mockResolvedValue({});
  vi.stubEnv('NEXT_PUBLIC_DEV_GUEST_MODE', '0');
});

describe('home: latest actual gain', () => {
  it.each([['/', 'Последний прирост: +205 км'], ['/en', 'Latest increase: +205 km']])('shows the gain between actual readings on %s', async (pathname, text) => {
    mocks.pathname = pathname;
    const latest = reading('b', '2026-10-05T08:00:00Z', 150205);
    mocks.max.mockResolvedValue(latest);
    mocks.entries.mockResolvedValue([latest, reading('a', '2026-10-01T08:00:00Z', 150000)]);
    const html = renderToStaticMarkup(await Home());
    expect(html.replace(/ | /g, ' ')).toContain(text);
    expect(html).toContain('data-last="150205"');
    expect(html).toContain('data-latest-at="2026-10-05T08:00:00Z"');
  });

  it('omits the line without a previous reading or with backdated readings', async () => {
    const only = reading('a', '2026-10-01T08:00:00Z', 150000);
    mocks.max.mockResolvedValue(only); mocks.entries.mockResolvedValue([only]);
    expect(renderToStaticMarkup(await Home())).not.toContain('data-testid="home-last-gain"');

    const backdated = reading('c', '2026-10-03T08:00:00Z', 150500);
    mocks.max.mockResolvedValue(backdated);
    mocks.entries.mockResolvedValue([reading('b', '2026-10-05T08:00:00Z', 150205), backdated, only]);
    const html = renderToStaticMarkup(await Home());
    expect(html).not.toContain('data-testid="home-last-gain"');
    expect(html).not.toContain('+-');
  });
});

describe('item history: mileage between replacements', () => {
  it.each([['/', 'Между заменами: 5 200 км'], ['/en', 'Since previous replacement: 5,200 km']])('shows the interval on %s and none for the first replacement', (pathname, text) => {
    mocks.pathname = pathname;
    const html = list([event(2, 105200), event(1, 100000)]);
    expect(html).toContain(text);
    expect(html.match(/data-interval=/g)).toHaveLength(1);
  });

  it('uses the previous replacement from the API for the oldest visible row and does not show it', () => {
    const events = Array.from({ length: 10 }, (_, i) => event(11 - i, 100000 + (11 - i) * 1000));
    const html = list(events, { previousReplacement: event(1, 101000), hasMore: true });
    expect(html.match(/<li /g)).toHaveLength(10);
    expect(html.match(/data-interval="interval"/g)).toHaveLength(10);
    expect(html).not.toContain('101 000');
    expect(html).toContain('Показать ещё');
  });

  it('has no "show more" button when everything is loaded', () => {
    const events = Array.from({ length: 10 }, (_, i) => event(10 - i, 100000 + (10 - i) * 1000));
    expect(list(events)).not.toContain('Показать ещё');
  });

  it('never presents a lower reading as a positive interval', () => {
    const html = list([event(3, 99000), event(2, 100000), event(1, 100000)]);
    expect(html).toContain('data-interval="decreased"');
    expect(html).toContain('data-interval="same-mileage"');
    expect(html).not.toContain('Между заменами');
  });
});

describe('item history: kinds in one timeline', () => {
  const mixed = [
    event(5, 106000, 'check', { note: 'Уровень между min и max' }),
    event(4, 105500, 'top_up', { amount_liters: 0.5, note: 'Долил до max' }),
    event(3, 105200, 'replacement'),
    event(2, 103000, 'top_up'),
    event(1, 100000, 'replacement'),
  ];

  it.each([
    ['/', ['Проверка', 'Долив', 'Замена', '0,5 л', 'Между заменами: 5 200 км']],
    ['/en', ['Check', 'Top-up', 'Replacement', '0.5 L', 'Since previous replacement: 5,200 km']],
  ])('labels each record, shows volume, comment and replacement intervals only (%s)', (pathname, texts) => {
    mocks.pathname = pathname;
    const html = list(mixed);
    for (const text of texts) expect(html).toContain(text);
    // User comments are shown as entered, never translated.
    expect(html).toContain('Уровень между min и max');
    expect(html).toContain('Долил до max');
    // Only the newer replacement has an interval; checks and top-ups have none.
    expect(html.match(/data-interval=/g)).toHaveLength(1);
    expect(html.match(/data-kind="replacement"/g)).toHaveLength(2);
    expect(html.match(/data-testid="item-history-volume"/g)).toHaveLength(1);
    if (pathname === '/en') expect(html.replace(/Уровень между min и max|Долил до max/g, '')).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('offers a labelled delete action on every record', () => {
    const html = list(mixed);
    expect(html.match(/class="item-history-delete"/g)).toHaveLength(5);
    expect(html).toContain('aria-label="Удалить: Проверка"');
  });
});

describe('record form: kind first, then the fields', () => {
  it.each([['/', ['Что вы сделали?', 'Полная замена', 'Осмотр состояния', 'Добавление жидкости']], ['/en', ['What did you do?', 'Full replacement', 'Condition inspection', 'Adding fluid']]])(
    'asks for the kind without preselecting one (%s)', (pathname, texts) => {
      mocks.pathname = pathname;
      const html = renderToStaticMarkup(
        <AddServiceEventForm serviceItemId="oil" serviceItemTitle="Oil" defaultMileage={150205} lastReadingAt="2026-10-05T08:00:00Z" isOpen onClose={() => {}} />
      );
      for (const text of texts) expect(html).toContain(text);
      expect(html.match(/type="radio"/g)).toHaveLength(3);
      expect(html).not.toMatch(/type="radio"[^>]*checked/);
      expect(html).not.toContain('serviceEventMileageKm');
      expect(html).toMatch(/type="submit"[^>]*disabled/);
    });
});
