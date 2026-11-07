import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEvent, ServiceItem } from '@/lib/db/types';

const mocks = vi.hoisted(() => ({
  pathname: '/', addServiceEvent: vi.fn(), deleteServiceEvent: vi.fn(), toast: vi.fn(), fetch: vi.fn(),
}));
// Release B behaviour (check and top-up creatable); release A is covered in the *ReleaseA tests.
vi.mock('@/lib/service/serviceEventKinds', async (importOriginal) =>
  (await import('@/lib/service/__tests__/allKindsCreatable')).allKindsCreatable(await importOriginal()));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/serviceActions', () => ({ addServiceEvent: mocks.addServiceEvent, deleteServiceEvent: mocks.deleteServiceEvent }));
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
const event = (n: number, kind: ServiceEvent['kind'], mileage_km: number): ServiceEvent => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, user_id: 'u', service_item_id: ITEM_ID,
  occurred_at: new Date(Date.UTC(2026, n, 1)).toISOString(), mileage_km, note: null, created_at: '2026-01-01T00:00:00Z',
  kind, amount_liters: kind === 'top_up' ? '0.50' as unknown as number : null,
});
// Newest first, as the API returns them.
const history = [event(3, 'top_up', 131000), event(2, 'replacement', 120000), event(1, 'replacement', 100000)];

const onClose = vi.fn();
const onRefresh = vi.fn();
let tree: ReactTestRenderer;

const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const all = () => text(tree.root).replace(/[  ]/g, ' ');
const button = (label: string) => tree.root.find((n) => n.type === 'button' && text(n) === label);
const rows = () => tree.root.findAll((n) => n.type === 'li' && n.props.className === 'item-history-row');
const input = (id: string) => tree.root.find((n) => (n.type === 'input' || n.type === 'textarea') && n.props.id === id);
const radio = (kind: string) => tree.root.find((n) => n.type === 'input' && n.props.type === 'radio' && n.props.value === kind);

async function mount() {
  await act(async () => {
    tree = create(
      <ItemDetailsSheet
        item={item}
        latestOdometer={{ mileage_km: 131000, occurred_at: '2026-10-05T08:00:00Z' }}
        estimatedOdometer={{ estimatedKm: 131000, lastActualKm: 131000, lastActualAt: '2026-10-05T08:00:00Z', elapsedDays: 0, dailyRate: null, isEstimated: false }}
        dailyKmRate={null}
        onClose={onClose}
        onOpenSettings={vi.fn()}
        onRefresh={onRefresh}
      />
    );
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname = '/';
  vi.stubGlobal('window', { scrollTo: vi.fn() });
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue({
    ok: true, json: async () => ({ ok: true, events: history, hasMore: false, previousReplacement: null }),
  });
  mocks.addServiceEvent.mockResolvedValue({ ok: true, event: history[0] });
  mocks.deleteServiceEvent.mockResolvedValue({ ok: true, deleted: {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  vi.unstubAllGlobals();
});

describe('ItemDetailsSheet (the /items sheet)', () => {
  it('loads the timeline of all kinds from the history API', async () => {
    await mount();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/service-events?itemId=${ITEM_ID}&limit=10`), expect.anything());
    expect(rows().map((row) => row.props['data-kind'])).toEqual(['top_up', 'replacement', 'replacement']);
  });

  it('adds a record from the sheet: explicit kind, saved without touching the odometer, sheet closes and refreshes', async () => {
    await mount();
    await act(async () => { button('Добавить запись').props.onClick(); });
    expect(all()).toContain('Что вы сделали?');
    expect(tree.root.findAll((n) => n.type === 'input' && n.props.type === 'radio' && n.props.checked)).toHaveLength(0);

    await act(async () => { radio('top_up').props.onChange(); });
    // The volume is right below the compact date line.
    expect(all()).toContain('Дата: Сегодня');
    await act(async () => { input('serviceEventAmount').props.onChange({ target: { value: '0,5' } }); });
    await act(async () => { await tree.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });

    expect(mocks.addServiceEvent).toHaveBeenCalledWith(expect.objectContaining({
      serviceItemId: ITEM_ID, kind: 'top_up', mileageKm: 131000, amountLiters: 0.5,
    }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ subtitle: 'Долив записан' }));
    expect(onClose).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });

  it('deletes the latest replacement from the sheet with the right warning, then refreshes the parent', async () => {
    await mount();
    const del = tree.root.findAll((n) => n.type === 'button' && n.props.className === 'item-history-delete');
    expect(del).toHaveLength(3);
    await act(async () => { del[1].props.onClick(); });
    expect(all()).toContain('Это последняя замена: прогноз следующего обслуживания будет пересчитан по предыдущей замене.');

    await act(async () => { button('Удалить запись').props.onClick(); });
    expect(mocks.deleteServiceEvent).toHaveBeenCalledWith(history[1].id);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(rows().map((row) => row.props['data-event-id'])).toEqual([history[0].id, history[2].id]);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Запись удалена. Прогноз пересчитан.' }));
  });

  it('deleting the only replacement in the sheet warns that the item returns to "first replacement"', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true, json: async () => ({ ok: true, events: [history[0], history[2]], hasMore: false, previousReplacement: null }),
    });
    await mount();
    const del = tree.root.findAll((n) => n.type === 'button' && n.props.className === 'item-history-delete');
    await act(async () => { del[1].props.onClick(); });
    expect(all()).toContain('Это единственная замена.');
    expect(all()).not.toContain('по предыдущей замене');
  });

  it('works in English', async () => {
    mocks.pathname = '/en';
    await mount();
    await act(async () => { button('Add record').props.onClick(); });
    expect(all()).toContain('What did you do?');
    expect(all()).toContain('Full replacement');
    expect(all()).toContain('Adding fluid');
    const del = tree.root.findAll((n) => n.type === 'button' && n.props.className === 'item-history-delete');
    await act(async () => { del[2].props.onClick(); });
    expect(all()).toContain('This is not the latest replacement');
  });
});
