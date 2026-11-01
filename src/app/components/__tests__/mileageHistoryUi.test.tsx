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
vi.mock('@/lib/actions/serviceActions', () => ({ listServiceItems: mocks.items, listLastServiceEventsForItems: mocks.events, addServiceEvent: vi.fn() }));
vi.mock('../AddMileageForm', () => ({ default: ({ lastMileageKm, latestReadingAt }: { lastMileageKm: number | null; latestReadingAt: string | null }) => <button data-last={String(lastMileageKm)} data-latest-at={String(latestReadingAt)}>mileage form</button> }));
vi.mock('../HomeContentClient', () => ({ default: ({ children }: WithChildren) => <div>{children}</div> }));
vi.mock('../HomeSoonMaintenanceBlock', () => ({ default: () => null }));
vi.mock('../HomeAdaptiveContent', () => ({ default: () => null }));
vi.mock('../ModalSheet', () => ({ default: ({ children }: WithChildren) => <div>{children}</div> }));

import Home from '@/app/page';
import ItemHistoryList from '../ItemHistoryList';
import AddServiceEventForm from '../AddServiceEventForm';

const reading = (id: string, occurred_at: string, mileage_km: number) => ({ id, user_id: 'u', occurred_at, mileage_km, note: null, created_at: occurred_at });
const event = (n: number, mileage_km: number): ServiceEvent => ({
  id: `e${n}`, user_id: 'u', service_item_id: 'oil', occurred_at: new Date(Date.UTC(2025, n, 1)).toISOString(), mileage_km, note: null, created_at: '2025-01-01T00:00:00Z',
});

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
    const html = renderToStaticMarkup(<ItemHistoryList events={[event(2, 105200), event(1, 100000)]} />);
    expect(html.replace(/ | /g, ' ')).toContain(text);
    expect(html.match(/data-interval=/g)).toHaveLength(1);
  });

  it('uses the extra loaded record for the oldest visible row and hides it', () => {
    // 11 events newest first, 1 000 km apart.
    const events = Array.from({ length: 11 }, (_, i) => event(11 - i, 100000 + (11 - i) * 1000));
    const html = renderToStaticMarkup(<ItemHistoryList events={events} />);
    expect(html.match(/<li /g)).toHaveLength(10);
    expect(html.match(/data-interval="interval"/g)).toHaveLength(10);
    expect(html).not.toContain('101 000');
    expect(html).toContain('Показаны последние записи');
  });

  it('does not show the "latest records" hint when everything fits', () => {
    const events = Array.from({ length: 10 }, (_, i) => event(10 - i, 100000 + (10 - i) * 1000));
    expect(renderToStaticMarkup(<ItemHistoryList events={events} />)).not.toContain('Показаны последние записи');
  });

  it('never presents a lower reading as a positive interval', () => {
    const html = renderToStaticMarkup(<ItemHistoryList events={[event(3, 99000), event(2, 100000), event(1, 100000)]} />);
    expect(html).toContain('data-interval="decreased"');
    expect(html).toContain('data-interval="same-mileage"');
    expect(html).not.toContain('Между заменами');
  });
});

describe('replacement form: last odometer reading', () => {
  it.each([['/', 'Последнее показание: 150 205 км'], ['/en', 'Last reading: 150,205 km']])('explains the prefilled value on %s', (pathname, text) => {
    mocks.pathname = pathname;
    const html = renderToStaticMarkup(
      <AddServiceEventForm serviceItemId="oil" serviceItemTitle="Oil" defaultMileage={150205} lastReadingAt="2026-10-05T08:00:00Z" isOpen onClose={() => {}} />
    );
    expect(html.replace(/ | /g, ' ')).toContain(text);
    // The field stays editable and prefilled with the same value.
    expect(html).toMatch(/id="serviceEventMileageKm"[^>]*value="150[ ,]205"/);
  });

  it('shows no hint without a reading', () => {
    const html = renderToStaticMarkup(<AddServiceEventForm serviceItemId="oil" serviceItemTitle="Oil" defaultMileage={null} isOpen onClose={() => {}} />);
    expect(html).not.toContain('service-event-last-reading');
  });
});
