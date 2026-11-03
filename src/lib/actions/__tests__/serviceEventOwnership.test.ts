import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEventInput } from '@/lib/db/types';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getMileage: vi.fn(),
  from: vi.fn(),
  selectItem: vi.fn(),
  itemEq: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  selectEvent: vi.fn(),
  singleEvent: vi.fn(),
  del: vi.fn(),
  delEq: vi.fn(),
  delSelect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/rlsServerClient', () => ({
  getRlsClientAndUserId: mocks.getClient,
}));
vi.mock('../odometerActions', () => ({ getMaxMileageEntry: mocks.getMileage }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: mocks.revalidatePath }));

import { addServiceEvent, deleteServiceEvent } from '../serviceActions';

const ITEM = '00000000-0000-4000-8000-0000000000a1';
const EVENT = '00000000-0000-4000-8000-0000000000e1';
const input: ServiceEventInput = {
  serviceItemId: ITEM, kind: 'replacement', occurredAt: new Date('2026-10-08T10:00:00Z'), mileageKm: 900,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.getClient.mockResolvedValue({ supabase: { from: mocks.from }, userId: 'user-a' });
  mocks.getMileage.mockResolvedValue({ mileage_km: 1000, occurred_at: '2026-10-07T08:00:00Z' });
  const lookup = { eq: mocks.itemEq, maybeSingle: mocks.maybeSingle };
  mocks.selectItem.mockReturnValue(lookup);
  mocks.itemEq.mockReturnValue(lookup);
  mocks.maybeSingle.mockResolvedValue({ data: { id: ITEM }, error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'service_items') return { select: mocks.selectItem };
    if (table === 'service_events') return { insert: mocks.insert, delete: mocks.del };
    throw new Error(`Unexpected table: ${table}`);
  });
  mocks.insert.mockReturnValue({ select: mocks.selectEvent });
  mocks.selectEvent.mockReturnValue({ single: mocks.singleEvent });
  mocks.singleEvent.mockResolvedValue({ data: { id: 'event-a', user_id: 'user-a' }, error: null });
  const deletion = { eq: mocks.delEq, select: mocks.delSelect };
  mocks.del.mockReturnValue(deletion);
  mocks.delEq.mockReturnValue(deletion);
  mocks.delSelect.mockResolvedValue({ data: [{ id: EVENT, kind: 'check', service_item_id: ITEM }], error: null });
});

describe('addServiceEvent ownership check', () => {
  it('creates a replacement for an item owned by the current user', async () => {
    await expect(addServiceEvent(input)).resolves.toMatchObject({ ok: true, event: { user_id: 'user-a' } });
    expect(mocks.itemEq).toHaveBeenCalledWith('id', ITEM);
    expect(mocks.itemEq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-a', service_item_id: ITEM, mileage_km: 900, kind: 'replacement', amount_liters: null,
    }));
  });

  it.each(['another user item', 'missing item'])('rejects %s without inserting', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(addServiceEvent({ ...input, kind: 'top_up', amountLiters: 1 })).resolves.toEqual({ ok: false, reason: 'item-unavailable' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('does not write when the ownership lookup fails, and hides the details', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection to 10.0.0.1 refused' } });
    await expect(addServiceEvent(input)).rejects.toThrow(/^Не удалось сохранить запись$/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('reports an FK rejection (item changed after the lookup) as an unavailable item', async () => {
    mocks.singleEvent.mockResolvedValue({ data: null, error: { code: '23503', message: 'FK rejected' } });
    await expect(addServiceEvent(input)).resolves.toEqual({ ok: false, reason: 'item-unavailable' });
  });

  it('never exposes SQL errors of the insert', async () => {
    mocks.singleEvent.mockResolvedValue({ data: null, error: { code: '42703', message: 'column "kind" does not exist' } });
    await expect(addServiceEvent(input)).rejects.toThrow(/^Не удалось сохранить запись$/);
  });

  it('still requires an initial odometer reading', async () => {
    mocks.getMileage.mockResolvedValue(null);
    await expect(addServiceEvent(input)).resolves.toEqual({ ok: false, reason: 'no-odometer' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe('addServiceEvent kinds and validation', () => {
  it.each([
    ['check', undefined, null],
    ['top_up', 0.5, 0.5],
    ['top_up', null, null],
    ['top_up', 99.99, 99.99],
  ] as const)('stores a %s with volume %s', async (kind, amountLiters, stored) => {
    await expect(addServiceEvent({ ...input, kind, amountLiters, note: '  level ok  ' })).resolves.toMatchObject({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ kind, amount_liters: stored, note: 'level ok' }));
  });

  it.each([
    ['check', 1], ['replacement', 1], ['top_up', 0], ['top_up', -1], ['top_up', 100], ['top_up', 1.234], ['top_up', Number.NaN],
    ['top_up', Number.POSITIVE_INFINITY],
  ] as const)('rejects a volume for %s = %s without inserting', async (kind, amountLiters) => {
    await expect(addServiceEvent({ ...input, kind, amountLiters })).resolves.toEqual({ ok: false, reason: 'invalid-amount' });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown kind', { kind: 'oil_change' }],
    ['missing kind', { kind: undefined }],
    ['invalid date', { occurredAt: new Date('nope') }],
    ['fractional mileage', { mileageKm: 900.5 }],
    ['zero mileage', { mileageKm: 0 }],
    ['malformed item id', { serviceItemId: 'item-a' }],
    ['too long comment', { note: 'x'.repeat(1001) }],
  ])('rejects %s without touching the database', async (_label, patch) => {
    await expect(addServiceEvent({ ...input, ...patch } as unknown as ServiceEventInput)).resolves.toEqual({ ok: false, reason: 'invalid-input' });
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it.each(['replacement', 'check', 'top_up'] as const)('rejects a %s above the recorded odometer with its value', async (kind) => {
    await expect(addServiceEvent({ ...input, kind, mileageKm: 1001 })).resolves.toEqual({
      ok: false, reason: 'mileage-above-odometer', odometerKm: 1000, odometerAt: '2026-10-07T08:00:00Z',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('accepts exactly the recorded odometer value', async () => {
    await expect(addServiceEvent({ ...input, kind: 'check', mileageKm: 1000 })).resolves.toMatchObject({ ok: true });
  });

  it('turns the DB mileage trigger (reading deleted concurrently) into the same result', async () => {
    mocks.singleEvent.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Пробег события обслуживания не может быть больше текущего пробега (800 км).' } });
    mocks.getMileage.mockResolvedValueOnce({ mileage_km: 1000, occurred_at: '2026-10-07T08:00:00Z' })
      .mockResolvedValueOnce({ mileage_km: 800, occurred_at: '2026-09-01T08:00:00Z' });
    await expect(addServiceEvent(input)).resolves.toEqual({
      ok: false, reason: 'mileage-above-odometer', odometerKm: 800, odometerAt: '2026-09-01T08:00:00Z',
    });
  });
});

describe('addServiceEvent never writes the odometer', () => {
  it.each(['replacement', 'check', 'top_up'] as const)('saving a %s touches only items (read) and events (insert)', async (kind) => {
    const backdated = { ...input, kind, occurredAt: new Date('2019-03-01T08:00:00Z') };
    await expect(addServiceEvent(backdated)).resolves.toMatchObject({ ok: true, event: { id: 'event-a' } });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ occurred_at: '2019-03-01T08:00:00.000Z' }));
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['service_items', 'service_events']);
  });
});

describe('deleteServiceEvent', () => {
  it('deletes only the given record of the current user and revalidates forecasts', async () => {
    await expect(deleteServiceEvent(EVENT)).resolves.toEqual({ ok: true, deleted: { id: EVENT, kind: 'check', service_item_id: ITEM } });
    expect(mocks.delEq).toHaveBeenCalledWith('id', EVENT);
    expect(mocks.delEq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'page');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/items', 'layout');
    // The odometer is never touched.
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['service_events']);
  });

  it("reports another user's (or a missing) record as not found", async () => {
    // RLS and the owner filter return no rows for someone else's record.
    mocks.delSelect.mockResolvedValue({ data: [], error: null });
    await expect(deleteServiceEvent(EVENT)).resolves.toEqual({ ok: false, reason: 'not-found' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(['', 'event-1', "x' OR 1=1", undefined])('rejects a malformed id %s without a query', async (id) => {
    await expect(deleteServiceEvent(id as unknown as string)).resolves.toEqual({ ok: false, reason: 'invalid-input' });
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('hides database errors', async () => {
    mocks.delSelect.mockResolvedValue({ data: null, error: { message: 'permission denied for table service_events' } });
    await expect(deleteServiceEvent(EVENT)).rejects.toThrow(/^Не удалось удалить запись$/);
  });
});
