import { describe, expect, it } from 'vitest';
import { RU } from '@/lib/copy/ru';
import { EN } from '../en';
import { createCopy, englishCopy, translateSystem } from '../copy';
import { localizedPath, localeFromPath, stripLocale, callbackHome } from '../routing';
import { createManifest } from '../manifest';
import { formatServiceTimeFromSignedDays } from '@/lib/format/formatServiceTime';
function leaves(value: object, prefix = ''): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]) => typeof child === 'string' ? [[`${prefix}${key}`, child]] : leaves(child, `${prefix}${key}.`));
}
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
describe('complete dictionaries', () => {
  it('has the same nested keys and a nonempty English translation for every Russian leaf', () => {
    const ru = leaves(RU), en = leaves(englishCopy);
    expect(en.map(([key]) => key)).toEqual(ru.map(([key]) => key));
    for (const [, text] of ru) expect(EN[text as keyof typeof EN]).toBeTruthy();
    for (const [, text] of en) { expect(text.trim()).not.toBe(''); expect(text).not.toMatch(/[А-Яа-яЁё]/); }
  });
  it('preserves interpolation tokens across every translation', () => {
    for (const [ru, en] of Object.entries(EN)) expect(placeholders(en), ru).toEqual(placeholders(ru));
  });
  it('keeps Russian copy verbatim and units in kilometers', () => {
    expect(createCopy('ru').RU).toBe(RU);
    expect(createCopy('en').RU.common.km).toBe('km');
  });
});
describe('locale routing', () => {
  it.each(['/', '/items', '/items/my-item', '/history', '/login'])('round-trips %s', pathname => {
    const english = localizedPath(pathname, 'en');
    expect(localeFromPath(english)).toBe('en');
    expect(stripLocale(english)).toBe(pathname);
    expect(localizedPath(english, 'ru')).toBe(pathname);
  });
  it('does not confuse similar prefixes or duplicate the locale', () => {
    expect(localeFromPath('/english')).toBe('ru');
    expect(localizedPath('/en/items/123?tab=calc', 'en')).toBe('/en/items/123?tab=calc');
  });
  it('keeps callback and API routes shared', () => {
    for (const pathname of ['/auth/callback', '/api/auth/sync', '/api/service-events']) expect(localizedPath(pathname, 'en')).toBe(pathname);
  });
  it.each(['https://evil.test', '//evil.test', '/items', 'en/../../x', null, undefined])('never redirects to arbitrary callback input %s', input => {
    expect(callbackHome(input)).toBe('/');
  });
  it('selects exactly two callback destinations', () => {
    expect(callbackHome('en')).toBe('/en'); expect(callbackHome('ru')).toBe('/');
  });
});
describe('locale formatting and system output', () => {
  it('uses ru-RU/en-US numbers and retains the input numeric value', () => {
    expect(createCopy('ru').formatNumber(123456)).toBe(new Intl.NumberFormat('ru-RU').format(123456));
    expect(createCopy('en').formatNumber(123456)).toBe('123,456');
    expect(createCopy('en').formatMileageInput('123456')).toBe('123,456');
  });
  it('uses the corresponding date locale', () => {
    const date = new Date('2026-10-09T12:00:00Z');
    expect(createCopy('en').formatDate(date)).toBe(new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date));
  });
  it.each([-100, -1, 0, 1, 2, 11, 30, 31, 60, 100, 365])('translates service time for %s days without changing Russian output', days => {
    expect(createCopy('ru').formatServiceTimeFromSignedDays(days)).toBe(formatServiceTimeFromSignedDays(days));
    expect(createCopy('en').formatServiceTimeFromSignedDays(days)).not.toMatch(/[А-Яа-яЁё]/);
  });
  it.each([
    'Просрочено по пробегу: -100 км', 'Просрочено по календарю: -5 дней',
    'Скоро по прогнозу: осталось 5 дн (порог: 30 дн)', 'Скоро по календарю: 5 дней (порог: 30 дней)',
    'Осталось 100 км / ~3 дн.', 'Осталось 100 км / недостаточно данных', 'Осталось ? дней',
  ])('translates a generated explanation: %s', value => {
    expect(translateSystem('en', value)).not.toMatch(/[А-Яа-яЁё]/);
  });
  it('translates auth errors and handles unknown system errors', () => {
    expect(createCopy('en').errorMessageText('Сессия не синхронизирована. Повторите попытку.')).toBe('Your session is not synchronized. Please try again.');
    expect(createCopy('en').errorMessageText('Неизвестная ошибка БД')).not.toMatch(/[А-Яа-яЁё]/);
  });
});
it('uses one PWA identity and scope for both locales, with an English launch URL', () => {
  const ru = createManifest('ru'), en = createManifest('en');
  expect(ru.id).toBe(en.id); expect(en.scope).toBe('/'); expect(en.start_url).toBe('/en');
  expect(ru.start_url).toBe('/'); expect(en.lang).toBe('en'); expect(en.name).not.toMatch(/[А-Яа-яЁё]/);
});
