# Prediction Reliability Audit

**Date:** 2025-01-02  
**Type:** Diagnostic Documentation  
**Goal:** Explain how prediction reliability is determined and why "Скоро" + ⓘ appears in TEST mode despite simulations

---

## 1. Where `isPredictionReliable` is Computed

**File:** `src/lib/service/serviceItemStatusVM.ts`  
**Function:** `buildServiceItemStatusVM()`  
**Lines:** 101-108

```typescript
const isPredictionReliable = !(
  context.isFallbackRate === true ||
  (statusResult.dailyKmRateUsed !== null && statusResult.dailyKmRateUsed !== undefined && statusResult.dailyKmRateUsed === 30) ||
  context.confidence === 'low'
);
```

**Logic:** Prediction is **unreliable** if ANY of these conditions are true:
1. `context.isFallbackRate === true` (daily rate calculation used fallback)
2. `statusResult.dailyKmRateUsed === 30` (fallback rate of 30 km/day was used)
3. `context.confidence === 'low'` (confidence level is low)

---

## 2. Signal Sources and Thresholds

### 2.1. `isFallbackRate` (from `estimateDailyKmRateUnified`)

**File:** `src/lib/service/odometerForecast.ts`  
**Function:** `estimateDailyKmRateUnified()`  
**Lines:** 32-122

**Algorithm:**
1. Try 14-day window (max 20 entries within `[anchorNow - 14 days, anchorNow]`)
2. If insufficient data, try 60-day window (max 60 entries within `[anchorNow - 60 days, anchorNow]`)
3. If still insufficient, use fallback (30 km/day) and set `isFallback: true`

**Fallback triggers when:**
- `entries.length < 2` (not enough entries total)
- `windowEntries.length < 2` (not enough entries in window)
- `deltaDays < 1` (entries too close together)
- `deltaKm <= 0` (mileage didn't increase)
- `dailyKmRate < 1` or `dailyKmRate > 1500` (out of bounds)

**Used in Home:** `src/app/page.tsx:93-95`

### 2.2. `dailyKmRateUsed` (from `calcServiceStatus`)

**File:** `src/lib/service/calcServiceStatus.ts`  
**Function:** `calcServiceStatus()`  
**Lines:** 410-413

```typescript
if (serviceItem.measurement_mode === 'km') {
  result.predictedDaysFromKm = predictedDaysFromKm;
  result.dailyKmRateUsed = (dailyKmRate !== null && dailyKmRate > 0) ? dailyKmRate : 30;
}
```

**Logic:** If `dailyKmRate` is null or <= 0, it defaults to 30 (fallback rate).

**Used in Home:** `src/app/page.tsx:106-112` (passed to `calcServiceStatus`)

### 2.3. `confidence` (from `computeConfidence`)

**File:** `src/lib/prediction/dailyRate.ts`  
**Function:** `computeConfidence()`  
**Lines:** 85-116

**Algorithm:**
- **High confidence:** `entriesLast30Days >= 6` AND `daysSinceLast <= 3`
- **Medium confidence:** `entriesLast60Days >= 4` AND `daysSinceLast <= 7`
- **Low confidence:** Otherwise

**Note:** Uses `new Date()` directly (not AppNow) - see `src/lib/prediction/dailyRate.ts:90-92`

**Used in Home:** `src/app/page.tsx:89`

---

## 3. Data Read by Reliability Logic

### 3.1. Odometer Entries

**Source:** `src/app/page.tsx:48-49`  
**Query:** `listOdometerEntries(50)` - last 50 entries, ordered by `occurred_at DESC`

### 3.2. Window Filtering (relative to AppNow)

**File:** `src/lib/service/odometerForecast.ts:56-59`  
**Filter:** `entryDate >= cutoff && entryDate <= anchorNow`  
- Excludes future entries (`occurred_at > anchorNow`)
- Only includes entries within window (`[anchorNow - windowDays, anchorNow]`)

### 3.3. Confidence Calculation

**File:** `src/lib/prediction/dailyRate.ts:95-100`  
**Counts:**
- `entriesLast30Days`: entries with `occurred_at >= (now - 30 days)`
- `entriesLast60Days`: entries with `occurred_at >= (now - 60 days)`
- `daysSinceLast`: days since most recent entry

**Issue:** Uses `new Date()` instead of AppNow, so in TEST mode it may count entries relative to real time, not AppNow.

---

## 4. UI Mapping

### 4.1. Status Text

**File:** `src/lib/service/serviceItemStatusVM.ts`  
**Lines:** 133-149

```typescript
if (!isPredictionReliable) {
  statusText = 'Скоро';  // Unreliable -> "Скоро" without days
} else if (statusResult.status === 'OVERDUE') {
  statusText = 'Просрочено';
} else if (daysToReplace !== null) {
  statusText = `~${daysRounded} дней`;  // Reliable -> "~N дней"
} else {
  statusText = 'Скоро';  // No data -> fallback
}
```

### 4.2. Tooltip (ⓘ indicator)

**File:** `src/app/components/StatusRowCompact.tsx`  
**Lines:** 61, 74-95

**Text:** `'Не можем точно посчитать срок, потому что пробег вносится редко. Добавляй пробег хотя бы раз в неделю — прогноз станет точнее.'`

**Shown when:** `!isPredictionReliable` (line 74)

---

## 5. Call Chain Diagram

```
Home (src/app/page.tsx:36)
  │
  ├─> listOdometerEntries(50) → odometerEntries[]
  │
  ├─> getAppNow() → appNow (Date)
  │
  ├─> estimateDailyKmRateUnified(odometerEntries, appNow)
  │   └─> Returns: { dailyKmRate, isFallback, windowDaysUsed, ... }
  │
  ├─> computeConfidence(odometerEntries)
  │   └─> Returns: 'high' | 'medium' | 'low'
  │   └─> ⚠️ Uses new Date() instead of AppNow
  │
  └─> For each serviceItem:
      │
      └─> calcServiceStatus({ ..., dailyKmRate: forecastDailyKmRate, now: appNow })
          └─> Returns: { ..., dailyKmRateUsed, ... }
          │
          └─> buildServiceItemStatusVM(serviceItem, statusResult, {
                isFallbackRate,
                dailyKmRate: forecastDailyKmRate,
                confidence,
                ...
              })
              └─> Computes: isPredictionReliable = !(isFallbackRate || dailyKmRateUsed === 30 || confidence === 'low')
                  │
                  └─> Sets: statusText = isPredictionReliable ? '~N дней' : 'Скоро'
                      │
                      └─> StatusRowCompact renders statusText + ⓘ (if !isPredictionReliable)
```

---

## 6. Concrete Examples

### Example A: Reliable Case

**Inputs:**
- `odometerEntries`: 10 entries within last 14 days (relative to AppNow)
- `appNow`: 2026-01-07
- `forecastResult`: { dailyKmRate: 45, isFallback: false, windowDaysUsed: 14 }
- `confidence`: 'high' (6+ entries in last 30 days, last entry within 3 days)
- `dailyKmRateUsed`: 45 (not 30)

**Outputs:**
- `isPredictionReliable`: `true`
- `statusText`: `"~15 дней"` (example)
- **UI:** Shows "~15 дней" without ⓘ

---

### Example B: Unreliable Case After 2x 'Week' Simulation

**Inputs:**
- `odometerEntries`: 2 entries (both from simulations, e.g., 2026-05-01 and 2026-05-08)
- `appNow`: 2026-01-07 (TEST mode, not advanced)
- `forecastResult`: { dailyKmRate: 30, isFallback: true, windowDaysUsed: null }
  - **Why fallback:** Both entries are in the future relative to AppNow, so window is empty
- `confidence`: 'low' (only 2 entries, last entry is 120+ days ago relative to real time)
- `dailyKmRateUsed`: 30 (fallback)

**Outputs:**
- `isPredictionReliable`: `false` (because `isFallbackRate === true` AND `dailyKmRateUsed === 30` AND `confidence === 'low'`)
- `statusText`: `"Скоро"`
- **UI:** Shows "Скоро" with ⓘ tooltip

**Root Cause:** Future-dated simulated entries are excluded from window calculation, leaving insufficient data.

---

### Example C: Fallback Case (No Entries)

**Inputs:**
- `odometerEntries`: 0 entries
- `appNow`: 2026-01-07
- `forecastResult`: { dailyKmRate: 30, isFallback: true, windowDaysUsed: null, fallbackReason: 'entries.length < 2' }
- `confidence`: 'low' (no entries)
- `dailyKmRateUsed`: 30 (fallback)

**Outputs:**
- `isPredictionReliable`: `false`
- `statusText`: `"Скоро"`
- **UI:** Shows "Скоро" with ⓘ tooltip

---

## 7. Known Issues

### Issue 1: `computeConfidence` Uses Real Time, Not AppNow

**File:** `src/lib/prediction/dailyRate.ts:90-92`  
**Problem:** Uses `new Date()` instead of AppNow, so in TEST mode:
- Counts entries relative to real time, not AppNow
- May show 'low' confidence even when entries are recent relative to AppNow

**Impact:** Can cause `isPredictionReliable = false` even when data is sufficient relative to AppNow.

### Issue 2: Future Entries Excluded from Window

**File:** `src/lib/service/odometerForecast.ts:56-59`  
**Behavior:** Correctly excludes entries with `occurred_at > anchorNow`  
**Impact:** In TEST mode, if AppNow is not advanced after simulations, simulated entries are excluded, causing fallback.

---

## 8. Summary

Prediction reliability depends on three signals:
1. **Daily rate fallback:** `isFallbackRate === true` → unreliable
2. **Fallback rate used:** `dailyKmRateUsed === 30` → unreliable
3. **Low confidence:** `confidence === 'low'` → unreliable

**In TEST mode with simulations:**
- If AppNow is not advanced, future entries are excluded → insufficient data → fallback → unreliable
- `computeConfidence` uses real time, not AppNow → may show 'low' even with recent AppNow-relative data

