/**
 * Chronology rule for NEW odometer readings (shared by the server action and the form).
 *
 * A new reading must not be dated earlier than the latest stored reading by date.
 * Comparison uses absolute instants, so the user's and the server's time zones do
 * not matter.
 *
 * Minute precision: the date picker and every displayed time show minutes, while stored
 * readings may carry seconds (and PostgreSQL even microseconds). A time in the SAME minute
 * as the latest reading is therefore not "earlier" from the user's point of view and is
 * accepted, but it is stored just after the latest reading (+1 ms), never before it. So no
 * reading is ever stored older than the latest one, and the date order stays unambiguous.
 * A time in an earlier minute is rejected.
 *
 * Applies only to creating odometer readings: service events may still be backdated,
 * and existing readings are neither changed nor re-validated.
 */

const MINUTE_MS = 60_000;

export type NewReadingTime =
  /** `occurredAt` is the time to store; `adjusted` when it was moved to just after the latest reading. */
  | { ok: true; occurredAt: Date; adjusted: boolean }
  /** Earlier minute than the latest reading. */
  | { ok: false; latestOccurredAt: string };

/**
 * @param occurredAt       Requested date of the new reading.
 * @param latestOccurredAt `occurred_at` of the latest stored reading (ISO), or null if none.
 */
export function resolveNewReadingTime(occurredAt: Date, latestOccurredAt: string | null | undefined): NewReadingTime {
  const unchanged = { ok: true, occurredAt, adjusted: false } as const;
  if (!latestOccurredAt) return unchanged;
  const latest = Date.parse(latestOccurredAt);
  if (Number.isNaN(latest)) return unchanged;

  const time = occurredAt.getTime();
  if (time > latest) return unchanged;
  // Same minute as the latest reading (including the exact same instant): keep the new
  // reading strictly after it. `Date.parse` drops microseconds, so +1 ms is still later.
  if (time >= Math.floor(latest / MINUTE_MS) * MINUTE_MS) {
    return { ok: true, occurredAt: new Date(latest + 1), adjusted: true };
  }
  return { ok: false, latestOccurredAt };
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
