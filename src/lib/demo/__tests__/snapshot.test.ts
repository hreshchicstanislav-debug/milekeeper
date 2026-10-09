import { describe, expect, it } from 'vitest';
import { createDemoSnapshot, DEMO_DAY } from '../snapshot';
import { isDemoPath } from '../routing';
import { demoCopy, loginChoiceCopy, formatDemoSoon } from '../copy';

describe('frozen synthetic demo using the real engine', () => {
  it('matches the researched facts, predictions, ordering and unknown state', () => {
    const result = createDemoSnapshot();
    expect(result.day).toBe(DEMO_DAY);
    expect(result.measuredDay).toBe('2026-10-07');
    expect(result.rate.dailyRate).toBe(40);
    expect(result.odometer).toMatchObject({ lastActualKm: 122200, estimatedKm: 122280, elapsedDays: 2, isEstimated: true });
    const expected = {
      oil: ['SOON', 720, 18, 'orange'], cabin: ['OVERDUE', -280, -7, 'red'],
      air: ['OK', 6720, 168, 'green'], brake: ['SOON', null, 10, 'red'],
      wipers: ['UNKNOWN', null, null, 'yellow'],
    };
    for (const row of result.items) expect([row.status.status, row.status.remainingKm, row.status.remainingDays, row.vm.statusColor]).toEqual(expected[row.id]);
    expect(result.soon.map(row => row.id)).toEqual(['cabin', 'brake', 'oil']);
    expect(result.items.map(row => row.id)).toEqual(['cabin', 'brake', 'oil', 'air', 'wipers']);
    result.items[0].status.remainingKm = 1;
    expect(createDemoSnapshot().items[0].status.remainingKm).toBe(-280);
  });
  it('admits exactly implemented public routes', () => {
    expect(isDemoPath('/demo')).toBe(true); expect(isDemoPath('/en/demo')).toBe(true);
    for (const path of ['/demo-items', '/demo/../items', '/demo/items', '/en/demo/items', '/demonstration', '/items/demo', '/history', '/', '/en/items']) expect(isDemoPath(path)).toBe(false);
  });
  it('provides complete English copy and the approved independent choices', () => {
    const leaves = (value: object): string[] => Object.values(value).flatMap(v => typeof v === 'string' ? [v] : leaves(v));
    expect(leaves(demoCopy.en).length).toBe(leaves(demoCopy.ru).length);
    expect(leaves(demoCopy.en).join(' ')).not.toMatch(/[А-Яа-яЁё]/);
    expect(loginChoiceCopy.en).toEqual({ demo: 'Explore demo', google: 'Continue with Google' });
    expect(createDemoSnapshot().soon.map(row => formatDemoSoon(row, 'en'))).toEqual(['Overdue', '10 days', '~18 days (720 km)']);
    expect(createDemoSnapshot().soon.map(row => formatDemoSoon(row, 'ru'))).toEqual(['Просрочено', '10 дней', '~18 дней (720 км)']);
  });
});
