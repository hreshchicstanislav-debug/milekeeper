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
}));

vi.mock('@/lib/supabase/rlsServerClient', () => ({
  getRlsClientAndUserId: mocks.getClient,
}));
vi.mock('../odometerActions', () => ({ getMaxMileageEntry: mocks.getMileage }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { addServiceEvent } from '../serviceActions';

const input: ServiceEventInput = {
  serviceItemId: 'item-a', occurredAt: new Date('2026-10-08T10:00:00Z'), mileageKm: 900,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getClient.mockResolvedValue({ supabase: { from: mocks.from }, userId: 'user-a' });
  mocks.getMileage.mockResolvedValue({ mileage_km: 1000 });
  const lookup = { eq: mocks.itemEq, maybeSingle: mocks.maybeSingle };
  mocks.selectItem.mockReturnValue(lookup);
  mocks.itemEq.mockReturnValue(lookup);
  mocks.maybeSingle.mockResolvedValue({ data: { id: 'item-a' }, error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'service_items') return { select: mocks.selectItem };
    if (table === 'service_events') return { insert: mocks.insert };
    throw new Error(`Unexpected table: ${table}`);
  });
  mocks.insert.mockReturnValue({ select: mocks.selectEvent });
  mocks.selectEvent.mockReturnValue({ single: mocks.singleEvent });
  mocks.singleEvent.mockResolvedValue({ data: { id: 'event-a', user_id: 'user-a' }, error: null });
});

describe('addServiceEvent ownership check', () => {
  it('creates a replacement for an item owned by the current user', async () => {
    await expect(addServiceEvent(input)).resolves.toMatchObject({ user_id: 'user-a' });
    expect(mocks.itemEq).toHaveBeenCalledWith('id', 'item-a');
    expect(mocks.itemEq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-a', service_item_id: 'item-a', mileage_km: 900,
    }));
  });

  it.each(['another user item', 'missing item'])('rejects %s without inserting', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(addServiceEvent(input)).rejects.toThrow('Элемент обслуживания не найден или недоступен');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('does not write when the ownership lookup fails', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
    await expect(addServiceEvent(input)).rejects.toThrow('Не удалось проверить элемент обслуживания');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('surfaces FK rejection if the item changed after the ownership lookup', async () => {
    mocks.singleEvent.mockResolvedValue({ data: null, error: { code: '23503', message: 'FK rejected' } });
    await expect(addServiceEvent(input)).rejects.toThrow('Failed to add service event');
  });

  it('still requires an initial odometer reading', async () => {
    mocks.getMileage.mockResolvedValue(null);
    await expect(addServiceEvent(input)).rejects.toThrow('Сначала добавьте пробег');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('still rejects mileage above the current odometer', async () => {
    await expect(addServiceEvent({ ...input, mileageKm: 1001 })).rejects.toThrow('Пробег замены не может быть больше');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
