/**
 * Mileage gain between actual odometer readings.
 *
 * Pure display helpers: nothing here is persisted. Every value is derived from
 * manually entered odometer readings, never from the estimated odometer.
 */

export interface OdometerReading {
  id: string;
  occurred_at: string;
  mileage_km: number;
}

/** Live preview of the gain while the user types a new odometer reading. */
export type EntryGainPreview =
  /** Nothing typed yet. */
  | { kind: 'empty' }
  /** First reading ever: there is nothing to compare against. */
  | { kind: 'no-previous' }
  /** Fewer digits than the last reading: the user is probably still typing. */
  | { kind: 'incomplete' }
  /** Not a positive whole number. */
  | { kind: 'invalid' }
  /** Equal to or below the last reading; saving would be rejected. */
  | { kind: 'not-greater'; lastKm: number }
  | { kind: 'gain'; km: number; lastKm: number };

/**
 * @param input        Raw text of the mileage field (may contain thousands separators).
 * @param lastMileageKm Highest actual reading — the same baseline the server validates
 *                      new readings against (`mileage_km` must be strictly greater).
 */
export function previewEntryGain(input: string, lastMileageKm: number | null): EntryGainPreview {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'empty' };

  const compact = trimmed.replace(/[\s,  ]/g, '');
  if (!/^\d+$/.test(compact)) return { kind: 'invalid' };
  const value = Number(compact);
  if (!Number.isSafeInteger(value) || value <= 0) return { kind: 'invalid' };

  if (lastMileageKm === null || !Number.isFinite(lastMileageKm)) return { kind: 'no-previous' };

  if (compact.replace(/^0+/, '').length < String(Math.trunc(lastMileageKm)).length) {
    return { kind: 'incomplete' };
  }

  const km = value - lastMileageKm;
  return km > 0 ? { kind: 'gain', km, lastKm: lastMileageKm } : { kind: 'not-greater', lastKm: lastMileageKm };
}

/** Result of `latestMileageGain`. Only `gain` is meant to be shown to the user. */
export type LatestMileageGain =
  | { kind: 'none' }
  /**
   * Readings disagree with each other: a backdated entry made the newest reading by
   * date differ from the highest reading by mileage (or similar). The gain would be
   * ambiguous, so it is not shown.
   */
  | { kind: 'inconsistent' }
  | { kind: 'gain'; km: number; latest: OdometerReading; previous: OdometerReading };

/** `occurred_at DESC, mileage_km DESC` — the order the app already uses for "latest". */
function compareNewestFirst(a: OdometerReading, b: OdometerReading): number {
  const delta = Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
  if (delta !== 0 && !Number.isNaN(delta)) return delta;
  return b.mileage_km - a.mileage_km;
}

/**
 * Gain added by the most recent reading.
 *
 * The gain is shown only when it is unambiguous: the newest reading by date is also the
 * highest reading (`maxEntry`, which the home page shows as the current odometer), and the
 * reading before it by date is also the next highest. Then the date order and the mileage
 * order agree, so the same number appears in the entry preview, on the home page and in
 * the top row of the odometer history.
 *
 * @param entries  Recent readings in any order (the home page loads the latest 50 by date).
 * @param maxEntry Reading with the highest mileage across the whole history.
 */
export function latestMileageGain(
  entries: readonly OdometerReading[],
  maxEntry: OdometerReading | null
): LatestMileageGain {
  if (entries.length < 2 || maxEntry === null) return { kind: 'none' };

  const [latest, previous, ...older] = [...entries].sort(compareNewestFirst);

  if (latest.id !== maxEntry.id && latest.mileage_km !== maxEntry.mileage_km) {
    return { kind: 'inconsistent' };
  }
  if (older.some((entry) => entry.mileage_km >= previous.mileage_km)) {
    return { kind: 'inconsistent' };
  }

  const km = latest.mileage_km - previous.mileage_km;
  if (!(km > 0)) return { kind: 'inconsistent' };
  return { kind: 'gain', km, latest, previous };
}

/**
 * Difference between two neighbouring rows of the odometer history, or `null` when it
 * should not be presented as a gain (no previous row, zero or negative difference).
 */
export function positiveMileageDelta(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  const delta = current - previous;
  return delta > 0 ? delta : null;
}
