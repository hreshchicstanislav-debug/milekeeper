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

/** Upper bound of a top-up volume; mirrors `service_events_amount_liters_check`. */
export const AMOUNT_LITERS_MAX = 99.99;
/** Maximum comment length accepted from the form and by the server action. */
export const SERVICE_EVENT_NOTE_MAX_LENGTH = 1000;

/** Positive, at most `AMOUNT_LITERS_MAX`, at most two decimals. */
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
  if (!/^\d{1,2}(?:[.,]\d{1,2})?$|^[.,]\d{1,2}$/.test(text)) return { ok: false };
  const value = Number(text.replace(',', '.'));
  return isValidAmountLiters(value) ? { ok: true, value } : { ok: false };
}
