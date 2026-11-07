import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceEventInput } from '@/lib/db/types';

/**
 * Release A (compatible): the real `serviceEventKinds` module, no release-B mock. The app
 * reads checks and top-ups but the server action refuses to create them, whatever the
 * client sends. Release B's creation of every kind is covered in serviceEventOwnership.test.ts.
 */
const mocks = vi.hoisted(() => ({
  getClient: vi.fn(), getMileage: vi.fn(), from: vi.fn(), revalidatePath: vi.fn(),
  itemEq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), selectEvent: vi.fn(), singleEvent: vi.fn(),
  del: vi.fn(), delEq: vi.fn(), delSelect: vi.fn(),
}));
vi.mock('@/lib/supabase/rlsServerClient', () => ({ getRlsClientAndUserId: mocks.getClient }));
vi.mock('../odometerActions', () => ({ getMaxMileageEntry: mocks.getMileage }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: mocks.revalidatePath }));

import { addServiceEvent, deleteServiceEvent } from '../serviceActions';
import {
  CREATABLE_SERVICE_EVENT_KINDS, isCreatableServiceEventKind, isServiceEventKind, SERVICE_EVENT_KINDS,
} from '@/lib/service/serviceEventKinds';

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
  mocks.itemEq.mockReturnValue(lookup);
  mocks.maybeSingle.mockResolvedValue({ data: { id: ITEM }, error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'service_items') return { select: () => lookup };
    if (table === 'service_events') return { insert: mocks.insert, delete: mocks.del };
    throw new Error(`Unexpected table: ${table}`);
  });
  mocks.insert.mockReturnValue({ select: mocks.selectEvent });
  mocks.selectEvent.mockReturnValue({ single: mocks.singleEvent });
  mocks.singleEvent.mockResolvedValue({ data: { id: 'event-a', user_id: 'user-a', kind: 'replacement' }, error: null });
  const deletion = { eq: mocks.delEq, select: mocks.delSelect };
  mocks.del.mockReturnValue(deletion);
  mocks.delEq.mockReturnValue(deletion);
});

describe('release A: kinds the app reads vs kinds it creates', () => {
  it('reads all three kinds but creates replacements only', () => {
    expect(SERVICE_EVENT_KINDS).toEqual(['replacement', 'check', 'top_up']);
    expect(CREATABLE_SERVICE_EVENT_KINDS).toEqual(['replacement']);
    for (const kind of SERVICE_EVENT_KINDS) expect(isServiceEventKind(kind)).toBe(true);
    expect(isCreatableServiceEventKind('replacement')).toBe(true);
    expect(isCreatableServiceEventKind('check')).toBe(false);
    expect(isCreatableServiceEventKind('top_up')).toBe(false);
    expect(isCreatableServiceEventKind('oil_change')).toBe(false);
  });
});

describe('release A: addServiceEvent refuses checks and top-ups on the server', () => {
  it.each([
    ['check', { kind: 'check' }],
    ['check with a volume', { kind: 'check', amountLiters: 1 }],
    ['top-up', { kind: 'top_up' }],
    ['top-up with a valid volume', { kind: 'top_up', amountLiters: 0.5 }],
    ['top-up with a comment', { kind: 'top_up', amountLiters: 1.25, note: 'После трассы' }],
  ])('a forged %s is invalid input, with no database or odometer access', async (_label, patch) => {
    await expect(addServiceEvent({ ...input, ...patch } as ServiceEventInput)).resolves.toEqual({ ok: false, reason: 'invalid-input' });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.getMileage).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('a forged future-dated check is still refused as an uncreatable kind first', async () => {
    await expect(addServiceEvent({ ...input, kind: 'check', occurredAt: new Date('2099-01-01T00:00:00Z') }))
      .resolves.toEqual({ ok: false, reason: 'invalid-input' });
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('still creates a replacement, stored with its kind and no volume', async () => {
    await expect(addServiceEvent({ ...input, note: '  Масло 5W-30  ' })).resolves.toMatchObject({ ok: true });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-a', service_item_id: ITEM, kind: 'replacement', mileage_km: 900, amount_liters: null, note: 'Масло 5W-30',
    }));
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['service_items', 'service_events']);
  });

  it('keeps the replacement rules: a volume on a replacement and a mileage above the odometer are rejected', async () => {
    await expect(addServiceEvent({ ...input, amountLiters: 1 })).resolves.toEqual({ ok: false, reason: 'invalid-amount' });
    await expect(addServiceEvent({ ...input, mileageKm: 1001 })).resolves.toEqual({
      ok: false, reason: 'mileage-above-odometer', odometerKm: 1000, odometerAt: '2026-10-07T08:00:00Z',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe('release A: existing checks and top-ups stay deletable', () => {
  it.each(['check', 'top_up'] as const)('deletes an existing %s and revalidates forecasts', async (kind) => {
    mocks.delSelect.mockResolvedValue({ data: [{ id: EVENT, kind, service_item_id: ITEM }], error: null });
    await expect(deleteServiceEvent(EVENT)).resolves.toEqual({ ok: true, deleted: { id: EVENT, kind, service_item_id: ITEM } });
    expect(mocks.delEq).toHaveBeenCalledWith('id', EVENT);
    expect(mocks.delEq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'page');
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['service_events']);
  });
});
