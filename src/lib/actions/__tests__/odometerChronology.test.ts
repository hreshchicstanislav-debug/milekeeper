import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getClient: vi.fn(), max: vi.fn(), latest: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/supabase/rlsServerClient', () => ({ getRlsClientAndUserId: mocks.getClient }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { addOdometerEntry } from '../odometerActions';
import { READING_BEFORE_LATEST_ERROR } from '@/lib/mileage/readingChronology';

/** Minimal PostgREST builder: resolves by the column the query orders on. */
function table() {
  let orderedBy = '';
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    order: (column: string) => { orderedBy ||= column; return q; },
    limit: () => q,
    maybeSingle: () => (orderedBy === 'mileage_km' ? mocks.max() : mocks.latest()),
    insert: (row: Record<string, unknown>) => {
      mocks.insert(row);
      return { select: () => ({ single: async () => ({ data: { id: 'new', ...row }, error: null }) }) };
    },
  });
  return q;
}

const latest = '2026-11-01T05:30:00.000Z';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getClient.mockResolvedValue({ supabase: { from: () => table() }, userId: 'user-a' });
  mocks.max.mockResolvedValue({ data: { mileage_km: 150205 }, error: null });
  mocks.latest.mockResolvedValue({ data: { occurred_at: '2026-11-01T10:30:00+05:00' }, error: null }); // == latest
});

describe('addOdometerEntry chronology rule', () => {
  it('rejects a new reading dated before the latest reading and explains why', async () => {
    const promise = addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-10-31T12:00:00Z') });
    await expect(promise).rejects.toThrow(READING_BEFORE_LATEST_ERROR);
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-10-31T12:00:00Z') }))
      .rejects.toThrow(`Latest reading: ${latest}`);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('accepts a reading at the same instant or later', async () => {
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date(latest) })).resolves.toMatchObject({ mileage_km: 150300 });
    await expect(addOdometerEntry({ mileageKm: 150400, occurredAt: new Date('2026-11-01T06:00:00Z') })).resolves.toMatchObject({ mileage_km: 150400 });
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });

  it('keeps the mileage rule: mileage must exceed the maximum', async () => {
    await expect(addOdometerEntry({ mileageKm: 150205, occurredAt: new Date('2026-11-02T00:00:00Z') })).rejects.toThrow('Mileage must be greater');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('allows the first reading with any date', async () => {
    mocks.max.mockResolvedValue({ data: null, error: null });
    mocks.latest.mockResolvedValue({ data: null, error: null });
    await expect(addOdometerEntry({ mileageKm: 1000, occurredAt: new Date('2001-01-01T00:00:00Z') })).resolves.toMatchObject({ mileage_km: 1000 });
  });

  it('rejects an invalid date without touching the database', async () => {
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('invalid') })).rejects.toThrow('Invalid reading date');
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('fails closed when the latest reading cannot be loaded', async () => {
    mocks.latest.mockResolvedValue({ data: null, error: { code: 'XX', message: 'boom' } });
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-11-02T00:00:00Z') })).rejects.toThrow('Failed to fetch latest reading');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
