import type { ServiceEventKind } from '@/lib/db/types';

/**
 * Kinds of service records. Only a replacement starts a new maintenance interval;
 * checks and top-ups are kept in the same history but never move forecasts.
 */
export const SERVICE_EVENT_KINDS: readonly ServiceEventKind[] = ['replacement', 'check', 'top_up'];

export function isServiceEventKind(value: unknown): value is ServiceEventKind {
  return typeof value === 'string' && (SERVICE_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Kinds a user may create, separate from the kinds the app reads (`SERVICE_EVENT_KINDS`).
 *
 * Release A (compatible): only replacements can be created, while existing checks and
 * top-ups are read, shown, deleted and kept out of forecasts. Release B widens this list
 * to `SERVICE_EVENT_KINDS`. Rolling B back to A therefore never needs a data change.
 * The server action enforces this list; the form only follows it.
 */
export const CREATABLE_SERVICE_EVENT_KINDS: readonly ServiceEventKind[] = ['replacement'];

export function isCreatableServiceEventKind(value: unknown): value is ServiceEventKind {
  return isServiceEventKind(value) && CREATABLE_SERVICE_EVENT_KINDS.includes(value);
}

/**
 * The single predicate for "this record resets the interval". A record without a kind
 * (stored before the column existed) is a replacement, matching the database default.
 */
export function isReplacementEvent(event: { kind?: ServiceEventKind | null }): boolean {
  return (event.kind ?? 'replacement') === 'replacement';
}

/** First replacement in a newest-first list (the newest replacement), or null. */
export function findLastReplacement<T extends { kind?: ServiceEventKind | null }>(eventsNewestFirst: readonly T[]): T | null {
  return eventsNewestFirst.find(isReplacementEvent) ?? null;
}

/**
 * Largest top-up volume. This is not a product rule: it is what the column
 * `amount_liters numeric(5,2)` can hold (3 integer digits, 2 decimals). The database
 * CHECK allows a volume only on a top-up and only when it is positive and not NaN
 * (`amount_liters > 0 AND amount_liters <> 'NaN'`); the type limits the range and scale.
 */
export const AMOUNT_LITERS_MAX = 999.99;
/** Maximum comment length accepted from the form and by the server action. */
export const SERVICE_EVENT_NOTE_MAX_LENGTH = 1000;

/** Positive, at most two decimals, within the `numeric(5,2)` range (`AMOUNT_LITERS_MAX`). */
export function isValidAmountLiters(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value <= 0 || value > AMOUNT_LITERS_MAX) return false;
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

export type AmountLitersInput =
  | { ok: true; value: number | null }
  | { ok: false };

/**
 * Parses the optional volume field. Accepts a decimal comma or point ("0,5", "1.25");
 * an empty field means "not specified".
 */
export function parseAmountLitersInput(raw: string): AmountLitersInput {
  const text = raw.trim().replace(/\s+/g, '');
  if (text === '') return { ok: true, value: null };
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$|^[.,]\d{1,2}$/.test(text)) return { ok: false };
  const value = Number(text.replace(',', '.'));
  return isValidAmountLiters(value) ? { ok: true, value } : { ok: false };
}

/**
 * Earliest date accepted for a service record. Any real car fits; the bound only keeps
 * obviously mistyped years (0001, 1015) out of the history.
 */
export const SERVICE_EVENT_MIN_DATE = '1950-01-01';
/** A client clock may run slightly ahead of the server; anything beyond is a future date. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

export type ServiceEventDateCheck = 'ok' | 'in-future' | 'too-old';

/**
 * Checks the moment a record is dated. A valid record is never later than "now" (today is
 * stored as the current moment, other days as local noon), so a comparison of instants is
 * independent of the user's time zone.
 */
export function checkServiceEventDate(occurredAt: Date, now: Date): ServiceEventDateCheck {
  if (occurredAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return 'in-future';
  // One day of slack so the bound holds in every time zone.
  if (occurredAt.getTime() < Date.parse(`${SERVICE_EVENT_MIN_DATE}T00:00:00Z`) - 24 * 60 * 60 * 1000) return 'too-old';
  return 'ok';
}
