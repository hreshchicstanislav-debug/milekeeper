import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getClient: vi.fn(), max: vi.fn(), latest: vi.fn(), insert: vi.fn(), insertError: { current: null as null | { message: string } } }));
vi.mock('@/lib/supabase/rlsServerClient', () => ({ getRlsClientAndUserId: mocks.getClient }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { addOdometerEntry } from '../odometerActions';

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
      const error = mocks.insertError.current;
      return { select: () => ({ single: async () => (error ? { data: null, error } : { data: { id: 'new', ...row }, error: null }) }) };
    },
  });
  return q;
}

/** Latest reading 05:30:37 UTC, returned with a +05:00 offset as PostgREST may do. */
const latest = '2026-11-01T05:30:37.000Z';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.insertError.current = null;
  mocks.getClient.mockResolvedValue({ supabase: { from: () => table() }, userId: 'user-a' });
  mocks.max.mockResolvedValue({ data: { mileage_km: 150205 }, error: null });
  mocks.latest.mockResolvedValue({ data: { occurred_at: '2026-11-01T10:30:37+05:00' }, error: null }); // == latest
});

describe('addOdometerEntry: expected rejections are returned, not thrown', () => {
  it('rejects a reading dated in an earlier minute and reports the latest reading', async () => {
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-11-01T05:29:59Z') }))
      .resolves.toEqual({ ok: false, reason: 'date-before-latest', latestOccurredAt: latest });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects mileage that does not exceed the maximum', async () => {
    await expect(addOdometerEntry({ mileageKm: 150205, occurredAt: new Date('2026-11-02T00:00:00Z') }))
      .resolves.toEqual({ ok: false, reason: 'mileage-not-greater' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('maps the DB trigger (a reading saved concurrently) to the same mileage rejection', async () => {
    mocks.insertError.current = { message: 'Mileage must be greater than previous odometer value. Latest mileage: 150400 km, provided: 150300 km' };
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-11-02T00:00:00Z') }))
      .resolves.toEqual({ ok: false, reason: 'mileage-not-greater' });
  });

  it('rejects invalid input without touching the database', async () => {
    for (const input of [
      { mileageKm: 150300, occurredAt: new Date('invalid') },
      { mileageKm: 0, occurredAt: new Date('2026-11-02T00:00:00Z') },
      { mileageKm: Number.NaN, occurredAt: new Date('2026-11-02T00:00:00Z') },
    ]) {
      await expect(addOdometerEntry(input)).resolves.toEqual({ ok: false, reason: 'invalid-input' });
    }
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});

describe('addOdometerEntry: time precision', () => {
  it('stores a later time unchanged', async () => {
    const result = await addOdometerEntry({ mileageKm: 150400, occurredAt: new Date('2026-11-01T06:00:00Z') });
    expect(result).toMatchObject({ ok: true, entry: { mileage_km: 150400 } });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ occurred_at: '2026-11-01T06:00:00.000Z' }));
  });

  it('accepts the latest reading’s minute from the date picker and stores it just after that reading', async () => {
    // Picker value 05:30 (seconds 0) vs latest 05:30:37: not an earlier minute, so no false rejection,
    // and the stored reading is not older than the latest one.
    const result = await addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-11-01T05:30:00Z') });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ occurred_at: '2026-11-01T05:30:37.001Z' }));
  });

  it('allows the first reading with any date', async () => {
    mocks.max.mockResolvedValue({ data: null, error: null });
    mocks.latest.mockResolvedValue({ data: null, error: null });
    await expect(addOdometerEntry({ mileageKm: 1000, occurredAt: new Date('2001-01-01T00:00:00Z') })).resolves.toMatchObject({ ok: true, entry: { mileage_km: 1000 } });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ occurred_at: '2001-01-01T00:00:00.000Z' }));
  });
});

describe('addOdometerEntry: unexpected failures still throw (shown as a generic message)', () => {
  it('fails closed when the latest reading cannot be loaded', async () => {
    mocks.latest.mockResolvedValue({ data: null, error: { code: 'XX', message: 'boom' } });
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-11-02T00:00:00Z') })).rejects.toThrow('Failed to fetch latest reading');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('throws on other insert errors', async () => {
    mocks.insertError.current = { message: 'permission denied for table odometer_entries' };
    await expect(addOdometerEntry({ mileageKm: 150300, occurredAt: new Date('2026-11-02T00:00:00Z') })).rejects.toThrow('Failed to add odometer entry');
  });
});
