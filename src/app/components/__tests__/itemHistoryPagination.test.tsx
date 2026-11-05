import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEvent, ServiceItem } from '@/lib/db/types';

/**
 * Deleting loaded records while older pages exist (regression: deleting the first ten
 * of 23 records showed "no history yet" although 13 remained in the database).
 * Drives the real sheet, `useItemHistory` and `ItemHistoryList` against an in-memory
 * server that implements the API contract of /api/service-events independently.
 */
const mocks = vi.hoisted(() => ({ pathname: '/', deleteServiceEvent: vi.fn(), toast: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/serviceActions', () => ({ addServiceEvent: vi.fn(), deleteServiceEvent: mocks.deleteServiceEvent }));
vi.mock('../ToastProvider', () => ({ useToast: () => ({ success: mocks.toast }) }));
vi.mock('../ModalSheet', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../AddMileageForm', () => ({ default: () => null }));

import ItemDetailsSheet from '../ItemDetailsSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEM_ID = '00000000-0000-4000-8000-000000000010';
const item: ServiceItem = {
  id: ITEM_ID, user_id: 'u', title: 'Масло двигателя', interval_km: 10000, interval_days: null,
  notify_before_days: 30, notify_before_km: null, measurement_mode: 'km', note: null, is_active: true, created_at: '2025-01-01T00:00:00Z',
};

/** Record n (1 = oldest … 23 = newest); every third one is a replacement. */
const record = (n: number): ServiceEvent => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, user_id: 'u', service_item_id: ITEM_ID,
  occurred_at: new Date(Date.UTC(2026, 0, n, 9)).toISOString(), mileage_km: 100000 + n * 1000, note: null,
  created_at: '2026-01-01T00:00:00Z', kind: n % 3 === 1 ? 'replacement' : 'check', amount_liters: null,
});

let db: ServiceEvent[] = [];
let failNextPage = false;
/** Newest first; distinct UTC millisecond timestamps of equal width compare as text. */
const newestFirst = (rows: ServiceEvent[]) => [...rows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
const olderThan = (cursor: { at: string; km: number; id: string }) => (e: ServiceEvent) =>
  e.occurred_at < cursor.at || (e.occurred_at === cursor.at && (e.mileage_km < cursor.km || (e.mileage_km === cursor.km && e.id < cursor.id)));

function serve(url: string) {
  const params = new URL(url, 'http://test').searchParams;
  const limit = Number(params.get('limit'));
  const at = params.get('beforeAt');
  if (at !== null && failNextPage) {
    failNextPage = false;
    return { ok: false, json: async () => ({ ok: false, error: 'Не удалось загрузить историю. Попробуйте ещё раз.' }) };
  }
  const rows = at === null ? newestFirst(db)
    : newestFirst(db).filter(olderThan({ at, km: Number(params.get('beforeKm')), id: params.get('beforeId')! }));
  const events = rows.slice(0, limit);
  const oldest = events.at(-1);
  const previousReplacement = oldest
    ? rows.slice(limit).find((e) => e.kind === 'replacement') ?? null
    : null;
  return { ok: true, json: async () => ({ ok: true, events, hasMore: rows.length > limit, previousReplacement }) };
}

let tree: ReactTestRenderer;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const all = () => text(tree.root).replace(/[  ]/g, ' ');
const shownIds = () => tree.root.findAll((n) => n.type === 'li' && n.props.className === 'item-history-row').map((n) => n.props['data-event-id'] as string);
const ids = (...ns: number[]) => ns.map((n) => record(n).id);
const range = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);
const moreButton = () => tree.root.findAll((n) => n.type === 'button' && String(n.props.className).includes('item-history-more-button'))[0];
const EMPTY = 'Пока нет записей обслуживания.';

async function mount() {
  await act(async () => {
    tree = create(
      <ItemDetailsSheet
        item={item}
        latestOdometer={{ mileage_km: 130000, occurred_at: '2026-02-01T08:00:00Z' }}
        estimatedOdometer={{ estimatedKm: 130000, lastActualKm: 130000, lastActualAt: '2026-02-01T08:00:00Z', elapsedDays: 0, dailyRate: null, isEstimated: false }}
        dailyKmRate={null}
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
  });
}
const showMore = async () => { await act(async () => { moreButton().props.onClick(); }); };
async function remove(id: string) {
  const row = tree.root.find((n) => n.type === 'li' && n.props['data-event-id'] === id);
  await act(async () => { row.find((n) => n.type === 'button' && n.props.className === 'item-history-delete').props.onClick(); });
  await act(async () => { tree.root.find((n) => n.type === 'button' && text(n) === 'Удалить запись').props.onClick(); });
}
const removeAll = async (list: string[]) => { for (const id of list) await remove(id); };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname = '/';
  db = Array.from({ length: 23 }, (_, i) => record(i + 1));
  failNextPage = false;
  vi.stubGlobal('window', { scrollTo: vi.fn() });
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockImplementation(async (url: string) => serve(url));
  mocks.deleteServiceEvent.mockImplementation(async (id: string) => {
    db = db.filter((e) => e.id !== id);
    return { ok: true, deleted: {} };
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  vi.unstubAllGlobals();
});

describe('history: deleting every loaded record while older pages exist', () => {
  it('23 records, first page deleted: the 13 remaining records appear without a reload', async () => {
    await mount();
    expect(shownIds()).toEqual(ids(...range(23, 14)));
    await removeAll(ids(...range(23, 14)));
    expect(db).toHaveLength(13);
    expect(all()).not.toContain(EMPTY);
    // The next page loaded by itself; the last three are behind "Show more".
    expect(shownIds()).toEqual(ids(...range(13, 4)));
    await showMore();
    expect(shownIds()).toEqual(ids(...range(13, 1)));
    expect(moreButton()).toBeUndefined();
    // No record was requested again: only the initial page and two older pages.
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('two pages loaded and all 20 deleted: the third page appears', async () => {
    await mount();
    await showMore();
    expect(shownIds()).toEqual(ids(...range(23, 4)));
    await removeAll(ids(...range(23, 4)));
    expect(all()).not.toContain(EMPTY);
    expect(shownIds()).toEqual(ids(3, 2, 1));
    expect(moreButton()).toBeUndefined();
  });

  it('second page: deleting its last visible record, then "Show more" loads the rest without gap or duplicate', async () => {
    await mount();
    await showMore();
    await remove(record(4).id);
    expect(shownIds()).toEqual(ids(...range(23, 5)));
    await showMore();
    expect(shownIds()).toEqual(ids(...range(23, 5), 3, 2, 1));
  });

  it('third page: deleting its last visible record keeps the rest; deleting the whole third page leaves the others', async () => {
    await mount();
    await showMore();
    await showMore();
    expect(shownIds()).toHaveLength(23);
    await remove(record(1).id);
    expect(shownIds()).toEqual(ids(...range(23, 2)));
    await removeAll(ids(3, 2));
    expect(shownIds()).toEqual(ids(...range(23, 4)));
    expect(moreButton()).toBeUndefined();
  });

  it('every record of the full history deleted: now the history really is empty', async () => {
    await mount();
    await showMore();
    await showMore();
    await removeAll(ids(...range(23, 1)));
    expect(db).toHaveLength(0);
    expect(all()).toContain(EMPTY);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('when loading the next page fails, the user gets an error and "Show more" instead of "empty"', async () => {
    await mount();
    failNextPage = true;
    await removeAll(ids(...range(23, 14)));
    expect(all()).not.toContain(EMPTY);
    expect(shownIds()).toEqual([]);
    expect(all()).toContain('Не удалось загрузить предыдущие записи. Попробуйте ещё раз.');
    await showMore();
    expect(shownIds()).toEqual(ids(...range(13, 4)));
  });

  it('intervals stay correct after the deleted page is replaced by the next one', async () => {
    await mount();
    await removeAll(ids(...range(23, 14)));
    // Replacements among 13…4: 13, 10, 7, 4; 4's predecessor (1) is on the next page.
    const intervals = tree.root.findAll((n) => n.props['data-interval'] !== undefined && n.type === 'span')
      .map((n) => n.props['data-interval']);
    expect(intervals).toEqual(['interval', 'interval', 'interval', 'interval']);
    expect(all().match(/Между заменами: 3\s000 км/gu)).toHaveLength(4);
  });

  it('works in English', async () => {
    mocks.pathname = '/en';
    await mount();
    await act(async () => {}); // render with the English locale
    const row = (id: string) => tree.root.find((n) => n.type === 'li' && n.props['data-event-id'] === id);
    for (const id of ids(...range(23, 14))) {
      await act(async () => { row(id).find((n) => n.type === 'button' && n.props.className === 'item-history-delete').props.onClick(); });
      await act(async () => { tree.root.find((n) => n.type === 'button' && text(n) === 'Delete record').props.onClick(); });
    }
    expect(all()).not.toContain('No service records yet.');
    expect(shownIds()).toEqual(ids(...range(13, 4)));
  });
});
