import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pickLatestReading, resolveNewReadingTime } from '../readingChronology';

/** Latest stored reading WITH seconds (e.g. saved without changing the date). */
const latest = '2026-11-01T05:30:37.000Z';
const latestMs = Date.parse(latest);
const at = (iso: string) => resolveNewReadingTime(new Date(iso), latest);

describe('resolveNewReadingTime', () => {
  it('keeps a later time as is', () => {
    expect(at('2026-11-01T05:30:37.001Z')).toEqual({ ok: true, occurredAt: new Date('2026-11-01T05:30:37.001Z'), adjusted: false });
    expect(at('2026-11-01T05:31:00.000Z')).toMatchObject({ ok: true, adjusted: false });
  });

  it('accepts the same minute as the latest reading, stored just after it (never before)', () => {
    // 05:30 picked in a minute-precision date picker, latest reading at 05:30:37.
    for (const sameMinute of ['2026-11-01T05:30:00.000Z', '2026-11-01T05:30:36.999Z', latest]) {
      const result = at(sameMinute);
      expect(result).toEqual({ ok: true, occurredAt: new Date(latestMs + 1), adjusted: true });
      if (result.ok) expect(result.occurredAt.getTime()).toBeGreaterThan(latestMs);
    }
  });

  it('rejects an earlier minute and reports the latest reading', () => {
    expect(at('2026-11-01T05:29:59.999Z')).toEqual({ ok: false, latestOccurredAt: latest });
    expect(at('2025-01-01T00:00:00Z')).toMatchObject({ ok: false });
  });

  it('works with readings stored on whole minutes (legacy data)', () => {
    const wholeMinute = '2026-11-01T05:30:00.000Z';
    expect(resolveNewReadingTime(new Date(wholeMinute), wholeMinute)).toMatchObject({ ok: true, adjusted: true });
    expect(resolveNewReadingTime(new Date('2026-11-01T05:29:00Z'), wholeMinute)).toMatchObject({ ok: false });
  });

  it('stays after a PostgreSQL timestamp with microseconds', () => {
    const micro = '2026-11-01T05:30:37.123456+00:00';
    const result = resolveNewReadingTime(new Date('2026-11-01T05:30:00Z'), micro);
    expect(result).toMatchObject({ ok: true, adjusted: true });
    // Stored value .124 sorts after .123456.
    if (result.ok) expect(result.occurredAt.toISOString()).toBe('2026-11-01T05:30:37.124Z');
  });

  it('allows anything when there is no (valid) previous reading', () => {
    for (const none of [null, undefined, '', 'not a date']) {
      expect(resolveNewReadingTime(new Date('2000-01-01T00:00:00Z'), none)).toMatchObject({ ok: true, adjusted: false });
    }
  });

  it('compares instants, so the offset in the stored value does not matter', () => {
    // Same instant written with a +05:00 offset (as PostgREST may return it).
    const withOffset = '2026-11-01T10:30:37+05:00';
    expect(resolveNewReadingTime(new Date('2026-11-01T05:30:00Z'), withOffset)).toMatchObject({ ok: true, adjusted: true });
    expect(resolveNewReadingTime(new Date('2026-11-01T05:29:00Z'), withOffset)).toMatchObject({ ok: false });
  });
});

describe('resolveNewReadingTime with a datetime-local value in different time zones', () => {
  // TZ cannot be changed inside a Vitest worker, so each zone runs in its own Node process
  // with the real (dependency-free) modules.
  const root = path.resolve(__dirname, '../../..');
  const run = (tz: string, values: string[]) => {
    const script = `
      const { fromDateTimeLocalValue } = await import(${JSON.stringify(path.join(root, 'lib/time/datetimeLocal.ts'))});
      const { resolveNewReadingTime } = await import(${JSON.stringify(path.join(root, 'lib/mileage/readingChronology.ts'))});
      const values = ${JSON.stringify(values)};
      console.log(JSON.stringify(values.map(v => {
        const r = resolveNewReadingTime(fromDateTimeLocalValue(v), ${JSON.stringify(latest)});
        return r.ok ? r.occurredAt.toISOString() : 'rejected';
      })));`;
    const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop()!);
  };

  it.each([
    ['Asia/Almaty', '2026-11-01T10:30', '2026-11-01T10:29', '2026-11-01T10:31'],      // UTC+5
    ['Europe/Moscow', '2026-11-01T08:30', '2026-11-01T08:29', '2026-11-01T08:31'],    // UTC+3
    ['America/New_York', '2026-11-01T01:30', '2026-11-01T01:29', '2026-11-01T01:31'], // DST fall-back day (ambiguous hour)
    ['UTC', '2026-11-01T05:30', '2026-11-01T05:29', '2026-11-01T05:31'],
  ])('%s: the latest reading’s minute is stored just after it, an earlier minute is rejected', (tz, same, earlier, later) => {
    expect(run(tz, [same, earlier, later])).toEqual(['2026-11-01T05:30:37.001Z', 'rejected', '2026-11-01T05:31:00.000Z']);
  });
});

describe('pickLatestReading', () => {
  it('picks the latest reading by date, ties broken by mileage', () => {
    const a = { id: 'a', occurred_at: '2026-10-01T00:00:00Z', mileage_km: 100 };
    const b = { id: 'b', occurred_at: '2026-10-05T00:00:00Z', mileage_km: 90 }; // backdated-looking but newest by date
    const c = { id: 'c', occurred_at: '2026-10-05T00:00:00Z', mileage_km: 95 };
    expect(pickLatestReading([a, b, c])).toBe(c);
    expect(pickLatestReading([])).toBeNull();
  });
});
