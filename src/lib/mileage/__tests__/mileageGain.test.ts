import { describe, expect, it } from 'vitest';
import { latestMileageGain, positiveMileageDelta, previewEntryGain, type OdometerReading } from '../mileageGain';

const reading = (id: string, occurred_at: string, mileage_km: number): OdometerReading => ({ id, occurred_at, mileage_km });

describe('previewEntryGain (live hint while typing)', () => {
  it('shows the gain over the last reading', () => {
    expect(previewEntryGain('150 205', 150000)).toEqual({ kind: 'gain', km: 205, lastKm: 150000 });
    expect(previewEntryGain('150,205', 150000)).toEqual({ kind: 'gain', km: 205, lastKm: 150000 });
  });

  it('has no arbitrary upper bound on the gain', () => {
    expect(previewEntryGain('1 500 000', 150000)).toEqual({ kind: 'gain', km: 1350000, lastKm: 150000 });
  });

  it('shows nothing before any input or without a previous reading', () => {
    expect(previewEntryGain('', 150000)).toEqual({ kind: 'empty' });
    expect(previewEntryGain('   ', 150000)).toEqual({ kind: 'empty' });
    expect(previewEntryGain('150 205', null)).toEqual({ kind: 'no-previous' });
  });

  it('treats a value shorter than the last reading as still being typed', () => {
    expect(previewEntryGain('1', 150000)).toEqual({ kind: 'incomplete' });
    expect(previewEntryGain('15 020', 150000)).toEqual({ kind: 'incomplete' });
    expect(previewEntryGain('00 150', 150000)).toEqual({ kind: 'incomplete' });
  });

  it('flags zero and negative gains instead of showing them with "+"', () => {
    expect(previewEntryGain('150 000', 150000)).toEqual({ kind: 'not-greater', lastKm: 150000 });
    expect(previewEntryGain('149 999', 150000)).toEqual({ kind: 'not-greater', lastKm: 150000 });
  });

  it('rejects non-numeric, zero and unsafe input', () => {
    expect(previewEntryGain('abc', 150000)).toEqual({ kind: 'invalid' });
    expect(previewEntryGain('15.5', 150000)).toEqual({ kind: 'invalid' });
    expect(previewEntryGain('-150205', 150000)).toEqual({ kind: 'invalid' });
    expect(previewEntryGain('0', 150000)).toEqual({ kind: 'invalid' });
    expect(previewEntryGain('99999999999999999999', 150000)).toEqual({ kind: 'invalid' });
  });
});

describe('latestMileageGain (home page)', () => {
  const a = reading('a', '2026-10-01T08:00:00Z', 150000);
  const b = reading('b', '2026-10-05T08:00:00Z', 150205);

  it('returns the gain of the newest reading over the previous one, in any input order', () => {
    expect(latestMileageGain([b, a], b)).toEqual({ kind: 'gain', km: 205, latest: b, previous: a });
    expect(latestMileageGain([a, b], b)).toMatchObject({ kind: 'gain', km: 205 });
  });

  it('needs two readings and the maximum reading', () => {
    expect(latestMileageGain([], null)).toEqual({ kind: 'none' });
    expect(latestMileageGain([a], a)).toEqual({ kind: 'none' });
    expect(latestMileageGain([a, b], null)).toEqual({ kind: 'none' });
  });

  it('is based on actual readings only, not on a later estimate', () => {
    // Estimated mileage is never passed in: the result depends on stored readings alone.
    const later = reading('c', '2026-10-30T08:00:00Z', 151000);
    expect(latestMileageGain([a, b, later], later)).toMatchObject({ kind: 'gain', km: 795, previous: b });
  });

  it('hides the gain when a backdated reading makes the newest by date differ from the highest', () => {
    // c was entered last with the highest mileage but dated before b.
    const c = reading('c', '2026-10-03T08:00:00Z', 150500);
    expect(latestMileageGain([a, b, c], c)).toEqual({ kind: 'inconsistent' });
  });

  it('hides the gain when an older reading is higher than the previous one', () => {
    const backdated = reading('x', '2026-09-01T08:00:00Z', 150300);
    const latest = reading('y', '2026-10-10T08:00:00Z', 150400);
    expect(latestMileageGain([a, b, backdated, latest], latest)).toEqual({ kind: 'inconsistent' });
  });

  it('never reports zero or negative gains', () => {
    const same = reading('s', '2026-10-06T08:00:00Z', 150205);
    expect(latestMileageGain([a, b, same], same)).toEqual({ kind: 'inconsistent' });
    const lower = reading('l', '2026-10-06T08:00:00Z', 149000);
    expect(latestMileageGain([a, b, lower], b)).toEqual({ kind: 'inconsistent' });
  });

  it('breaks ties on equal timestamps by mileage, like the rest of the app', () => {
    const sameTime = reading('t', b.occurred_at, 150300);
    expect(latestMileageGain([a, b, sameTime], sameTime)).toMatchObject({ kind: 'gain', km: 95, previous: b });
  });
});

describe('positiveMileageDelta (odometer history rows)', () => {
  it('returns only positive differences', () => {
    expect(positiveMileageDelta(150205, 150000)).toBe(205);
    expect(positiveMileageDelta(150000, 150000)).toBeNull();
    expect(positiveMileageDelta(149000, 150000)).toBeNull();
    expect(positiveMileageDelta(150000, undefined)).toBeNull();
    expect(positiveMileageDelta(150000, null)).toBeNull();
  });
});
