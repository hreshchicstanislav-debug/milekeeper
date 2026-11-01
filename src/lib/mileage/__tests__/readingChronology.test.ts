import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { isBeforeLatestReading, latestReadingFromError, pickLatestReading, READING_BEFORE_LATEST_ERROR } from '../readingChronology';

const latest = '2026-11-01T05:30:00.000Z';

describe('isBeforeLatestReading', () => {
  it('rejects only dates strictly earlier than the latest reading', () => {
    expect(isBeforeLatestReading(new Date('2026-11-01T05:29:59.999Z'), latest)).toBe(true);
    expect(isBeforeLatestReading(new Date('2025-01-01T00:00:00Z'), latest)).toBe(true);
    expect(isBeforeLatestReading(new Date(latest), latest)).toBe(false); // "not earlier" allows equal
    expect(isBeforeLatestReading(new Date('2026-11-01T05:30:00.001Z'), latest)).toBe(false);
  });

  it('allows anything when there is no (valid) previous reading', () => {
    expect(isBeforeLatestReading(new Date('2000-01-01T00:00:00Z'), null)).toBe(false);
    expect(isBeforeLatestReading(new Date('2000-01-01T00:00:00Z'), undefined)).toBe(false);
    expect(isBeforeLatestReading(new Date('2000-01-01T00:00:00Z'), 'not a date')).toBe(false);
  });

  it('compares instants, so the offset in the stored value does not matter', () => {
    // Same instant written with a +05:00 offset (as PostgREST may return it).
    expect(isBeforeLatestReading(new Date(latest), '2026-11-01T10:30:00+05:00')).toBe(false);
    expect(isBeforeLatestReading(new Date('2026-11-01T05:29:00Z'), '2026-11-01T10:30:00+05:00')).toBe(true);
  });
});

describe('isBeforeLatestReading with a datetime-local value in different time zones', () => {
  // TZ cannot be changed inside a Vitest worker, so each zone runs in its own Node process
  // with the real (dependency-free) modules.
  const root = path.resolve(__dirname, '../../..');
  const run = (tz: string, values: string[]) => {
    const script = `
      const { fromDateTimeLocalValue } = await import(${JSON.stringify(path.join(root, 'lib/time/datetimeLocal.ts'))});
      const { isBeforeLatestReading } = await import(${JSON.stringify(path.join(root, 'lib/mileage/readingChronology.ts'))});
      const values = ${JSON.stringify(values)};
      console.log(JSON.stringify(values.map(v => isBeforeLatestReading(fromDateTimeLocalValue(v), ${JSON.stringify(latest)}))));`;
    const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop()!);
  };

  it.each([
    ['Asia/Almaty', '2026-11-01T10:30', '2026-11-01T10:29'],      // UTC+5
    ['Europe/Moscow', '2026-11-01T08:30', '2026-11-01T08:29'],    // UTC+3
    ['America/New_York', '2026-11-01T01:30', '2026-11-01T01:29'], // DST fall-back day (ambiguous hour)
    ['UTC', '2026-11-01T05:30', '2026-11-01T05:29'],
  ])('%s: the same wall-clock moment is allowed, one minute earlier is rejected', (tz, same, earlier) => {
    expect(run(tz, [same, earlier])).toEqual([false, true]);
  });
});

describe('helpers', () => {
  it('reads the latest reading timestamp back from the server error', () => {
    expect(latestReadingFromError(`${READING_BEFORE_LATEST_ERROR}. Latest reading: ${latest}`)).toBe(latest);
    expect(latestReadingFromError('Something else')).toBeNull();
  });

  it('picks the latest reading by date, ties broken by mileage', () => {
    const a = { id: 'a', occurred_at: '2026-10-01T00:00:00Z', mileage_km: 100 };
    const b = { id: 'b', occurred_at: '2026-10-05T00:00:00Z', mileage_km: 90 }; // backdated-looking but newest by date
    const c = { id: 'c', occurred_at: '2026-10-05T00:00:00Z', mileage_km: 95 };
    expect(pickLatestReading([a, b, c])).toBe(c);
    expect(pickLatestReading([])).toBeNull();
  });
});
