/**
 * Estimated current odometer (derived, never persisted)
 *
 * Разделяет два понятия:
 * - фактический пробег — последняя вручную введённая запись одометра (контрольная точка);
 * - расчётный пробег — оценка текущего состояния автомобиля между замерами:
 *   `lastActualKm + elapsedDays * dailyRate`.
 *
 * Ручной ввод не двигает систему вперёд, он калибрует прогноз: позиция автомобиля
 * корректируется мгновенно (новая запись сразу становится новым якорем), а скорость
 * модели (dailyRate) адаптируется плавно — за счёт существующего скользящего окна
 * в `calculateDailyMileageRateToBe`.
 *
 * Значение считается «на чтение» и никогда не записывается в БД.
 */

import type { OdometerEntry } from '../db/types';
import { toLocalDayKey, fromLocalDayKey } from './dailyMileageRateToBe';

export interface EstimatedOdometerResult {
  /** Расчётный текущий пробег (целые км), null если нет ни одного фактического замера */
  estimatedKm: number | null;
  /** Последний фактический пробег (контрольная точка), null если замеров нет */
  lastActualKm: number | null;
  /** occurred_at последнего фактического замера (ISO), null если замеров нет */
  lastActualAt: string | null;
  /** Целые локальные календарные дни от даты замера до `now`, всегда >= 0 */
  elapsedDays: number;
  /** Дневной темп, фактически использованный для оценки (null — оценка не применялась) */
  dailyRate: number | null;
  /** true только когда расчётное значение реально ушло вперёд от факта */
  isEstimated: boolean;
}

const EMPTY_RESULT: EstimatedOdometerResult = {
  estimatedKm: null,
  lastActualKm: null,
  lastActualAt: null,
  elapsedDays: 0,
  dailyRate: null,
  isEstimated: false,
};

/**
 * Разница в целых локальных календарных днях между двумя моментами времени.
 * Использует те же day-key правила, что и расчёт среднего пробега.
 */
function diffLocalCalendarDays(from: Date, to: Date): number {
  const a = fromLocalDayKey(toLocalDayKey(from)).getTime();
  const b = fromLocalDayKey(toLocalDayKey(to)).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/**
 * Вычислить расчётный текущий пробег.
 *
 * Правила:
 * - нет фактического замера => расчётного пробега нет;
 * - dailyRate невалиден (null / <= 0 / не число) => используем факт, isEstimated = false;
 * - elapsedDays clamp-ится в 0 (замер «из будущего» не откатывает пробег назад);
 * - estimatedKm никогда не меньше lastActualKm;
 * - результат округляется до целых км (как и mileage_km в БД).
 *
 * @param lastActualEntry запись одометра с максимальным пробегом (getMaxMileageEntry)
 * @param dailyRate средний дневной пробег (calculateDailyMileageRateToBe)
 * @param now единый источник времени (getAppNow)
 */
export function computeEstimatedOdometer(
  lastActualEntry: OdometerEntry | null,
  dailyRate: number | null,
  now: Date
): EstimatedOdometerResult {
  if (!lastActualEntry) {
    return EMPTY_RESULT;
  }

  const lastActualKm = lastActualEntry.mileage_km;
  const lastActualAt = lastActualEntry.occurred_at;
  const occurredAt = new Date(lastActualAt);

  const elapsedDays =
    isNaN(occurredAt.getTime()) || isNaN(now.getTime())
      ? 0
      : Math.max(0, diffLocalCalendarDays(occurredAt, now));

  const hasValidRate = dailyRate !== null && Number.isFinite(dailyRate) && dailyRate > 0;

  if (!hasValidRate || elapsedDays === 0) {
    return {
      estimatedKm: lastActualKm,
      lastActualKm,
      lastActualAt,
      elapsedDays,
      dailyRate: null,
      isEstimated: false,
    };
  }

  // dailyRate валиден (проверено выше), поэтому прибавка неотрицательна.
  const estimatedKm = Math.max(lastActualKm, Math.round(lastActualKm + elapsedDays * dailyRate));

  return {
    estimatedKm,
    lastActualKm,
    lastActualAt,
    elapsedDays,
    dailyRate,
    isEstimated: estimatedKm > lastActualKm,
  };
}
