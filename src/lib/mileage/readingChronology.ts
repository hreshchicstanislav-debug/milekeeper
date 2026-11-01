/**
 * Chronology rule for NEW odometer readings (shared by the server action and the form).
 *
 * A new reading must not be dated earlier than the latest stored reading by date.
 * Comparison uses absolute instants, so the user's and the server's time zones do
 * not matter. Equal timestamps are allowed ("not earlier").
 *
 * Applies only to creating odometer readings: service events may still be backdated,
 * and existing readings are neither changed nor re-validated.
 */

/** Stable marker the client uses to recognise this server-side rejection. */
export const READING_BEFORE_LATEST_ERROR = 'Reading date must not be earlier than the latest reading';

/**
 * @param occurredAt       Date of the new reading.
 * @param latestOccurredAt `occurred_at` of the latest stored reading (ISO), or null if none.
 * @returns true when the new reading would be dated before the latest one.
 */
export function isBeforeLatestReading(occurredAt: Date, latestOccurredAt: string | null | undefined): boolean {
  if (!latestOccurredAt) return false;
  const latest = Date.parse(latestOccurredAt);
  if (Number.isNaN(latest)) return false;
  return occurredAt.getTime() < latest;
}

/** Extracts the ISO timestamp appended to the server error, if present. */
export function latestReadingFromError(message: string): string | null {
  const match = /Latest reading: (\S+)/.exec(message);
  return match && !Number.isNaN(Date.parse(match[1])) ? match[1] : null;
}

/** `occurred_at DESC, mileage_km DESC` — the reading the app treats as the latest by date. */
export function pickLatestReading<T extends { occurred_at: string; mileage_km: number }>(entries: readonly T[]): T | null {
  let latest: T | null = null;
  for (const entry of entries) {
    if (latest === null) { latest = entry; continue; }
    const delta = Date.parse(entry.occurred_at) - Date.parse(latest.occurred_at);
    if (delta > 0 || (delta === 0 && entry.mileage_km > latest.mileage_km)) latest = entry;
  }
  return latest;
}
