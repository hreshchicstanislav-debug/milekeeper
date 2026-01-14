# Mileage calculations — AS-IS

**Date**: January 8, 2025  
**Purpose**: Factual documentation of current calculation logic (no proposals or improvements)  
**Mode**: AS-IS only

---

## Scope

This document describes how the system currently calculates:
- Average daily mileage rate (km/day) from odometer entries
- Remaining days until service item replacement
- Remaining kilometers until service item replacement
- Service item status (OVERDUE / SOON / OK / UNKNOWN)

**Out of scope**: TO-BE improvements, alternative formulas, code refactoring suggestions.

---

## Where values are shown in UI

### Home page (`/`)
- **Current mileage**: Maximum `mileage_km` from `odometer_entries` table
  - Component: `src/app/page.tsx` (line 464-466)
  - Display: `{formatNumber(maxMileageEntry.mileage_km)} км`
  - Date shown: `maxMileageEntry.occurred_at` (formatted via `LocalDateTime`)

- **Average daily rate hint**: Shown in "Soon Maintenance" block
  - Component: `src/app/components/HomeSoonMaintenanceBlock.tsx` (lines 121-127)
  - Display format:
    - If fallback: `"Средний пробег: ~{rate} км/день (примерно)"`
    - If calculated: `"Средний пробег за последние {windowDaysUsed} дней: ~{rate} км/день"`
  - Value source: `forecastDailyKmRate` from `estimateDailyKmRateUnified()`

- **Service items status**: Each item shows `remainingKm` and `remainingDays`
  - Component: `src/app/components/HomeAdaptiveContent.tsx` (legacy, minimal)
  - Component: `src/app/components/HomeSoonMaintenanceBlock.tsx` (main display)

### Item Details page (`/items/[id]`)
- **Average daily rate**: Shown for km-mode items only
  - Component: `src/app/items/[id]/ItemDetailsPageClient.tsx` (lines 330-346)
  - Display: `"{Math.round(statusResult.dailyKmRateUsed)} км/день"`
  - Hint text: `RU.items.details.calcAvgDailyHint`

- **Remaining km**: From `statusResult.remainingKm`
- **Remaining days**: From `statusResult.remainingDays`
- **Status**: `statusResult.status` (OVERDUE / SOON / OK / UNKNOWN)

### Item Details Sheet (modal)
- Same fields as Item Details page
- Component: `src/app/components/ItemDetailsSheet.tsx` (lines 593-610)

---

## Data sources

### Database table: `odometer_entries`
**Schema** (from `supabase/migrations/20260101114456_init_milekeeper.sql`):
```sql
CREATE TABLE odometer_entries (
  id UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,  -- User-provided date/time
  mileage_km INTEGER NOT NULL,        -- Odometer reading in kilometers
  note TEXT,                          -- Optional note
  created_at TIMESTAMPTZ DEFAULT NOW() -- System timestamp
);
```

**Indexes**:
- `idx_odometer_entries_occurred_at` on `occurred_at`
- `idx_odometer_entries_mileage_km` on `mileage_km`

**Key fields for calculations**:
- `occurred_at`: Date/time when mileage was recorded (user-provided, can be in the past)
- `mileage_km`: Odometer reading (must be strictly increasing: new entry > max existing)
- `created_at`: System timestamp (not used in calculations, only for audit)

### Database table: `service_items`
**Relevant fields**:
- `interval_km`: Number of kilometers between replacements (nullable)
- `interval_days`: Number of calendar days between replacements (nullable)
- `notify_before_days`: Days threshold for SOON status
- `measurement_mode`: `'km'` or `'calendar'` (determines calculation method)

### Database table: `service_events`
**Relevant fields**:
- `occurred_at`: Date/time when replacement happened
- `mileage_km`: Odometer reading at replacement time
- `service_item_id`: Links to `service_items`

---

## Mileage entries model

**Type definition** (`src/lib/db/types.ts` lines 7-13):
```typescript
export interface OdometerEntry {
  id: string;
  occurred_at: string;  // ISO timestamp
  mileage_km: number;
  note: string | null;
  created_at: string;    // ISO timestamp
}
```

**Ordering in queries**:
- Default order: `occurred_at DESC` (newest first)
- For calculations: Often sorted ascending (`occurred_at ASC`) to compute deltas

**Current mileage determination**:
- Function: `getMaxMileageEntry()` in `src/lib/actions/odometerActions.ts` (lines 117-167)
- Query: `SELECT * FROM odometer_entries ORDER BY mileage_km DESC LIMIT 1`
- **Note**: Uses `mileage_km` (not `occurred_at`) to find maximum
- This means: if user adds entry with past date but higher mileage, it becomes "current mileage"

**Date source for calculations**:
- **AppNow**: Canonical application time (`src/lib/appNow.ts`)
  - LIVE mode: Always equals `new Date()` (real current time)
  - TEST mode: Stored in localStorage/cookie, can be advanced for testing
- Used in: `estimateDailyKmRateUnified()` (anchors time windows to AppNow, not `new Date()`)

---

## Average mileage calculation (AS-IS)

### Function 1: `estimateDailyKmRateUnified()` (PRIMARY, used on Home)

**Location**: `src/lib/service/odometerForecast.ts` (lines 32-124)

**Input**:
- `entries`: Array of `OdometerEntry[]` ordered by `occurred_at DESC`
- `anchorNow`: Date object (AppNow, not `new Date()`)

**Algorithm**:
1. **Fallback check**: If `entries.length < 2` → return `30 km/day` (fallback)

2. **Try 14-day window first**:
   - Cutoff: `anchorNow - 14 days`
   - Filter entries: `occurred_at >= cutoff AND occurred_at <= anchorNow` (exclude future entries)
   - Limit: Take first 20 entries (most recent)
   - Sort: Ascending by `occurred_at`
   - Calculate: `deltaKm = newest.mileage_km - oldest.mileage_km`
   - Calculate: `deltaDays = (newest.occurred_at - oldest.occurred_at) / (1000 * 60 * 60 * 24)`
   - Validate: `deltaDays >= 1 AND deltaKm > 0`
   - Calculate: `dailyKmRate = deltaKm / deltaDays`
   - Validate: `1 <= dailyKmRate <= 1500` (clamp bounds)
   - If valid → return result with `windowDaysUsed: 14`

3. **Try 60-day window if 14-day fails**:
   - Same logic, but:
     - Cutoff: `anchorNow - 60 days`
     - Limit: First 60 entries
   - If valid → return result with `windowDaysUsed: 60`

4. **Fallback if both fail**:
   - Return `30 km/day` with `isFallback: true`, `windowDaysUsed: null`

**Key behavior**:
- Uses **total delta** (oldest to newest in window), not per-pair median
- **Excludes future entries** (entries with `occurred_at > anchorNow`)
- **Anchored to AppNow**, not real current time (important for TEST mode)

**Return type**:
```typescript
{
  dailyKmRate: number;        // Always > 0 (never null)
  isFallback: boolean;        // True if using 30 km/day fallback
  windowDaysUsed: number | null;  // 14, 60, or null
  samplesUsed: number;       // Number of entries in window
  fallbackReason: string | null;  // Reason if fallback used
}
```

### Function 2: `computeDailyRate()` (LEGACY, used for confidence calculation)

**Location**: `src/lib/prediction/dailyRate.ts` (lines 16-61)

**Input**:
- `entries`: Array of `OdometerEntry[]` ordered by `occurred_at DESC`

**Algorithm**:
1. Filter entries within last 60 days (relative to `new Date()`, not AppNow)
2. Take most recent 10 entries
3. Sort ascending by `occurred_at`
4. For each consecutive pair `(prev, curr)`:
   - Calculate: `daysDiff = (curr.occurred_at - prev.occurred_at) / (1000 * 60 * 60 * 24)`
   - Calculate: `kmDiff = curr.mileage_km - prev.mileage_km`
   - If `daysDiff > 0 AND kmDiff > 0`: `rate = kmDiff / daysDiff`
   - Add to `rates[]` array
5. Return **median** of all rates (not average)

**Key differences from `estimateDailyKmRateUnified`**:
- Uses **median of per-pair rates** (not total delta)
- Uses **real current time** (`new Date()`), not AppNow
- Fixed 60-day window, max 10 entries
- Returns `null` if insufficient data (no fallback)

**Usage**: Only for `computeConfidence()` calculation (not used for forecasting)

---

## Days counting logic (AS-IS)

### For calendar-mode service items

**Location**: `src/lib/service/calcServiceStatus.ts` (lines 172-203)

**Calculation**:
1. `dueDate = lastEvent.occurred_at + serviceItem.interval_days`
2. `remainingDays = (dueDate - now) / (1000 * 60 * 60 * 24)`
3. Round: `roundDays(remainingDays)` → rounds to 2 decimals, handles -0

**`now` parameter**: Passed from caller (usually `appNow` from `getAppNow()`)

**Result**: Can be negative (overdue), positive (future), or zero (due today)

### For km-mode service items

**Location**: `src/lib/service/calcServiceStatus.ts` (lines 112-171)

**Calculation**:
1. `remainingKm = (lastEvent.mileage_km + serviceItem.interval_km) - currentMileage`
2. If `remainingKm` is finite:
   - Use `dailyKmRate` from input (or fallback to `30 km/day` if invalid)
   - `predictedDaysFromKm = remainingKm / dailyKmRate`
   - Normalize near-zero: if `|predictedDaysFromKm| < 0.01` → set to `0`
   - `remainingDays = predictedDaysFromKm` (can be negative if overdue)

**Key behavior**:
- **No time-based deadline** for km-mode (no `dueDate` computed)
- `remainingDays` is a **prediction**, not a calendar deadline
- Uses same `dailyKmRate` that was calculated for forecasting

---

## Service item forecast calculation (AS-IS)

### Main function: `calcServiceStatus()`

**Location**: `src/lib/service/calcServiceStatus.ts` (lines 62-428)

**Input**:
```typescript
{
  serviceItem: ServiceItem;
  latestOdometerMileageKm: number | null;  // Current max mileage
  lastEvent: ServiceEvent | null;            // Last replacement event
  dailyKmRate?: number | null;               // Average km/day for prediction
  now?: Date;                                // Current time (usually AppNow)
}
```

### Step-by-step calculation

#### Step 1: Check prerequisites
- If `lastEvent === null` → return `UNKNOWN` status
- If `latestOdometerMileageKm === null` AND mode is `'km'` → return `UNKNOWN`

#### Step 2: Calculate remaining km
- If `serviceItem.interval_km !== null AND latestOdometerMileageKm !== null`:
  - `dueMileageKm = lastEvent.mileage_km + serviceItem.interval_km`
  - `remainingKm = dueMileageKm - latestOdometerMileageKm`
- Else: `remainingKm = null`

#### Step 3: Calculate remaining days (branch by `measurement_mode`)

**If `measurement_mode === 'km'`**:
- If `remainingKm !== null AND isFinite(remainingKm)`:
  - Use `dailyKmRate` (or fallback to `30 km/day` if invalid/null)
  - `predictedDaysFromKm = remainingKm / dailyKmRate`
  - Normalize: if `|predictedDaysFromKm| < 0.01` → `0`
  - `remainingDays = predictedDaysFromKm` (can be negative)
- Else: `remainingDays = null`

**If `measurement_mode === 'calendar'`**:
- If `serviceItem.interval_days !== null`:
  - `dueDate = new Date(lastEvent.occurred_at)`
  - `dueDate.setDate(dueDate.getDate() + serviceItem.interval_days)`
  - `remainingDays = (dueDate - now) / (1000 * 60 * 60 * 24)`
  - Round: `roundDays(remainingDays)`
- Else: return `UNKNOWN` (missing `interval_days`)

#### Step 4: Determine limiting factor

**If `measurement_mode === 'km'`**:
- `limitingFactor = 'km'` (always, never `'time'`)
- Primary: `remainingKm`
- Secondary: `remainingDays` (predicted, if available)

**If `measurement_mode === 'calendar'`**:
- If both `remainingKm` and `remainingDays` available:
  - If one is overdue (<= 0): that one is limiting
  - Else: choose smaller value (hits zero sooner)
- Else: use whichever is available

#### Step 5: Determine status

**OVERDUE**:
- If `remainingKm <= 0` OR `remainingDays <= 0` (any criterion)

**SOON**:
- If NOT OVERDUE AND `remainingDays <= serviceItem.notify_before_days`
- **Note**: Only checks `remainingDays`, not `remainingKm` (even for km-mode items)

**OK**:
- Otherwise

#### Step 6: Build result

**Fields in result**:
- `status`: OVERDUE / SOON / OK / UNKNOWN
- `limitingFactor`: 'km' / 'time' / 'none'
- `primary`: `{ kind, remainingValue, dueValue, unit, label }`
- `secondary`: Optional (if both km and time available)
- `remainingKm`: Raw value (can be negative)
- `remainingDays`: Raw value (can be negative)
- `predictedDaysFromKm`: Only for km-mode (debugging)
- `dailyKmRateUsed`: Rate actually used (with fallback to 30)

---

## Calculation chain (step-by-step)

### Home page flow

1. **Load data** (`src/app/page.tsx` lines 47-72):
   - `maxMileageEntry = getMaxMileageEntry('Home')` → max `mileage_km`
   - `odometerEntries = listOdometerEntries(50)` → last 50 entries, `occurred_at DESC`
   - `serviceItems = listServiceItems()`
   - `lastEventsMap = listLastServiceEventsForItems(itemIds)`

2. **Get AppNow** (line 86):
   - `appNow = getAppNow()` → canonical time (LIVE = real time, TEST = stored)

3. **Calculate daily rate** (lines 88-97):
   - `dailyRate = computeDailyRate(odometerEntries)` → median (for confidence only)
   - `forecastResult = estimateDailyKmRateUnified(odometerEntries, appNow)` → unified calculation
   - `forecastDailyKmRate = forecastResult.dailyKmRate` (always > 0, fallback = 30)
   - `isFallbackRate = forecastResult.isFallback`
   - `windowDaysUsed = forecastResult.windowDaysUsed` (14, 60, or null)

4. **Calculate confidence** (line 90):
   - `confidence = computeConfidence(odometerEntries)` → 'high' / 'medium' / 'low'
   - Based on: entries count in last 30/60 days, days since last entry

5. **For each service item** (lines 107-196):
   - `statusResult = calcServiceStatus({ serviceItem, latestOdometerMileageKm: currentMileage, lastEvent, dailyKmRate: forecastDailyKmRate, now: appNow })`
   - Extract: `remainingKm`, `remainingDays`, `urgency`

6. **Build view-model** (lines 299-329):
   - `statusVM = buildServiceItemStatusVM(item, statusResult, { measurement_mode, interval_km, interval_days, notify_before_days, dailyKmRate: forecastDailyKmRate, isFallbackRate, confidence })`
   - Calculates: `daysToReplace`, `totalDays`, `remainingRatio`, `statusColor`, `statusText`, `isPredictionReliable`

7. **Display**:
   - Home: `HomeSoonMaintenanceBlock` shows items with status
   - Average rate hint: `"Средний пробег за последние {windowDaysUsed} дней: ~{rate} км/день"`

### Item Details page flow

1. **Load data** (`src/app/items/[id]/page.tsx` lines 30-37):
   - `latestOdometer = getMaxMileageEntry('ItemDetails:...')`
   - `odometerEntries = listOdometerEntries(50)`
   - `lastEvent = listLastServiceEventsForItems([item.id])[item.id]`

2. **Calculate forecast** (line 40):
   - `forecastResult = estimateDailyKmRate(odometerEntries)` → legacy function (14-day window, max 20 entries)
   - **Note**: Uses `estimateDailyKmRate()`, not `estimateDailyKmRateUnified()` (different function)

3. **Calculate status** (in client component):
   - `statusResult = calcServiceStatus({ serviceItem, latestOdometerMileageKm, lastEvent, dailyKmRate: forecastDailyKmRate, now: new Date() })`
   - **Note**: Uses `new Date()`, not `appNow` (inconsistent with Home page)

4. **Display**:
   - Shows `statusResult.dailyKmRateUsed` (rate actually used, with fallback to 30)
   - Shows `statusResult.remainingKm` and `statusResult.remainingDays`

---

## Observed behavior scenarios

### Scenario 1: Multiple entries on same day

**Setup**:
- Entry 1: `occurred_at: 2025-01-01 10:00`, `mileage_km: 10000`
- Entry 2: `occurred_at: 2025-01-01 15:00`, `mileage_km: 10050`
- Entry 3: `occurred_at: 2025-01-02 10:00`, `mileage_km: 10100`

**Calculation** (`estimateDailyKmRateUnified`):
- 14-day window: Includes all 3 entries
- Sorted ascending: Entry 1, Entry 2, Entry 3
- `deltaDays = (Entry 3.occurred_at - Entry 1.occurred_at) / (1000 * 60 * 60 * 24) = 1.0 day`
- `deltaKm = 10100 - 10000 = 100 km`
- `dailyKmRate = 100 / 1.0 = 100 km/day`

**Note**: Entries on same day are included, but `deltaDays` is calculated from oldest to newest (may be < 1 day if same day).

### Scenario 2: Large gaps between entries

**Setup**:
- Entry 1: `occurred_at: 2024-12-01`, `mileage_km: 5000`
- Entry 2: `occurred_at: 2025-01-08`, `mileage_km: 8000`
- AppNow: `2025-01-08`

**Calculation**:
- 14-day window: Only Entry 2 (cutoff = 2024-12-25, Entry 1 excluded)
- 60-day window: Both entries (cutoff = 2024-11-09)
- `deltaDays = 38 days`
- `deltaKm = 3000 km`
- `dailyKmRate = 3000 / 38 = 78.9 km/day`

**Note**: If only 1 entry in window → fallback to 30 km/day.

### Scenario 3: Km-mode item with predicted days

**Setup**:
- Service item: `interval_km: 10000`, `measurement_mode: 'km'`, `notify_before_days: 7`
- Last event: `mileage_km: 50000`, `occurred_at: 2024-12-01`
- Current mileage: `55000`
- Daily rate: `50 km/day`

**Calculation**:
- `dueMileageKm = 50000 + 10000 = 60000`
- `remainingKm = 60000 - 55000 = 5000`
- `predictedDaysFromKm = 5000 / 50 = 100 days`
- `remainingDays = 100` (predicted, not calendar)
- Status: `OK` (100 > 7)
- If `remainingDays <= 7`: Status becomes `SOON` (based on predicted days, not km)

**Note**: For km-mode, `SOON` status is based on `remainingDays` (predicted), not `remainingKm`.

---

## Open questions / unclear points

1. **Inconsistent daily rate calculation**:
   - Home page uses `estimateDailyKmRateUnified()` (14/60-day windows, anchored to AppNow)
   - Item Details page uses `estimateDailyKmRate()` (14-day window, max 20 entries, uses `new Date()`)
   - **Question**: Why different functions? Are results consistent?

2. **Inconsistent time source**:
   - Home page passes `appNow` to `calcServiceStatus()`
   - Item Details page passes `new Date()` to `calcServiceStatus()`
   - **Question**: Should both use `appNow` for consistency?

3. **Multiple entries on same day**:
   - `estimateDailyKmRateUnified()` includes all entries in window, calculates total delta
   - If entries on same day: `deltaDays` may be < 1 day (e.g., 0.2 days)
   - **Question**: Is this intentional? Does it affect accuracy?

4. **SOON status for km-mode**:
   - Status is based on `remainingDays` (predicted) <= `notify_before_days`
   - Not based on `remainingKm` threshold
   - **Question**: Is this intentional? Should km-mode use km threshold instead?

5. **Fallback rate usage**:
   - Fallback is `30 km/day` (hardcoded)
   - Used when: insufficient entries, invalid delta, out of bounds
   - **Question**: Is 30 km/day appropriate for all vehicles? Should it be configurable?

6. **Current mileage determination**:
   - Uses `MAX(mileage_km)`, not `MAX(occurred_at)`
   - If user adds past-dated entry with higher mileage, it becomes "current"
   - **Question**: Is this intentional? Should it use most recent by date instead?

---

## Files reference

**Calculation functions**:
- `src/lib/service/odometerForecast.ts` — `estimateDailyKmRateUnified()`, `estimateDailyKmRate()`
- `src/lib/prediction/dailyRate.ts` — `computeDailyRate()`, `computeConfidence()`
- `src/lib/service/calcServiceStatus.ts` — `calcServiceStatus()`
- `src/lib/service/serviceItemStatusVM.ts` — `buildServiceItemStatusVM()`

**Data access**:
- `src/lib/actions/odometerActions.ts` — `getMaxMileageEntry()`, `listOdometerEntries()`
- `src/lib/actions/serviceActions.ts` — `listServiceItems()`, `listLastServiceEventsForItems()`

**Time management**:
- `src/lib/appNow.ts` — `getAppNow()`, `setAppNow()`, `advanceAppNow()`

**UI components**:
- `src/app/page.tsx` — Home page (server component)
- `src/app/components/HomeSoonMaintenanceBlock.tsx` — Soon maintenance display
- `src/app/items/[id]/page.tsx` — Item Details page (server component)
- `src/app/items/[id]/ItemDetailsPageClient.tsx` — Item Details client component

**Database schema**:
- `supabase/migrations/20260101114456_init_milekeeper.sql` — Initial schema

---

## AS-IS Verification & Coverage

**Verification date**: January 8, 2025  
**Method**: Global codebase search for all calculation functions and usage points

### Confirmed calculation entry points

#### Daily mileage rate calculation functions

1. **`estimateDailyKmRateUnified()`** (PRIMARY)
   - **Location**: `src/lib/service/odometerForecast.ts` (lines 32-124)
   - **Used in**:
     - `src/app/page.tsx` (Home page, line 94) — with `appNow`
     - `src/app/items/page.tsx` (Items List page, line 53) — with `appNow`
   - **Status**: ✅ Documented

2. **`estimateDailyKmRate()`** (LEGACY)
   - **Location**: `src/lib/service/odometerForecast.ts` (lines 134-213)
   - **Used in**:
     - `src/app/items/[id]/page.tsx` (Item Details page, line 40) — without `anchorNow` (uses `new Date()` internally)
   - **Status**: ✅ Documented
   - **Note**: Marked as `@deprecated` in code, but still used on Item Details page

3. **`computeDailyRate()`** (CONFIDENCE ONLY)
   - **Location**: `src/lib/prediction/dailyRate.ts` (lines 16-61)
   - **Used in**:
     - `src/app/page.tsx` (Home page, line 89) — only for `computeConfidence()`, NOT for forecasting
   - **Status**: ✅ Documented
   - **Note**: Returns median of per-pair rates, not used for service item forecasting

4. **`estimateDaysToReachKm()`** (UNUSED IN PRODUCTION)
   - **Location**: `src/lib/service/odometerForecast.ts` (lines 234-255)
   - **Used in**: Only in test files (`src/lib/service/__tests__/odometerForecast.test.ts`)
   - **Status**: ✅ Confirmed unused in production code
   - **Note**: Function exists but is not called from any UI or server component

#### Service item forecast calculation functions

1. **`calcServiceStatus()`** (ONLY FUNCTION)
   - **Location**: `src/lib/service/calcServiceStatus.ts` (lines 62-428)
   - **Used in**:
     - `src/app/page.tsx` (Home page, line 112) — with `appNow`
     - `src/app/items/page.tsx` (Items List page, line 59) — with `appNow`
     - `src/app/items/[id]/ItemDetailsPageClient.tsx` (Item Details client, line 187) — without `now` (defaults to `new Date()`)
     - `src/app/components/ItemDetailsSheet.tsx` (Item Details sheet, line 398) — without `now` (defaults to `new Date()`)
   - **Status**: ✅ Documented
   - **Note**: Single source of truth for service item status calculation

### Confirmed usage map

| Location | Daily Rate Function | Time Source | calcServiceStatus `now` | Status |
|----------|---------------------|-------------|-------------------------|--------|
| Home page (`/`) | `estimateDailyKmRateUnified()` | `appNow` (getAppNow()) | `appNow` | ✅ Consistent |
| Items List (`/items`) | `estimateDailyKmRateUnified()` | `appNow` (getAppNow()) | `appNow` | ✅ Consistent |
| Item Details (`/items/[id]`) | `estimateDailyKmRate()` (legacy) | `new Date()` (internal) | `new Date()` (default) | ⚠️ Inconsistent |
| ItemDetailsSheet (modal) | Uses prop `dailyKmRate` | N/A (uses prop) | `new Date()` (default) | ⚠️ Inconsistent |
| ItemDetailsPageClient | Uses prop `dailyKmRate` | N/A (uses prop) | `new Date()` (default) | ⚠️ Inconsistent |

**Key findings**:
- Home and Items List pages use unified function with `appNow` (consistent)
- Item Details page uses legacy function without `appNow` (inconsistent)
- ItemDetailsSheet and ItemDetailsPageClient don't pass `now` parameter (defaults to `new Date()`)

### Confirmed absence of alternative algorithms

**Search performed for**:
- Alternative calculation functions (experimental, legacy, feature-flag)
- Hidden formulas in utils/helpers
- Duplicate calculation logic in components

**Results**:
- ✅ **No experimental algorithms found**
- ✅ **No feature-flag controlled calculations found**
- ✅ **No duplicate calculation logic in UI components**
- ✅ **No alternative formulas in utils/helpers** (only `numberFormat.ts` exists, unrelated to calculations)

**Functions found but NOT used in production**:
- `estimateDaysToReachKm()` — exists but only used in tests
- `estimateDailyKmRateLegacy()` — deprecated wrapper, not called directly

**Dev-only functions** (not used in calculations):
- `findDateForMileage()` in `src/lib/actions/devActions.ts` — used only for seeding demo data, not for forecasting

### Time source verification

**Confirmed time sources used in calculations**:

1. **`appNow` (getAppNow())**:
   - Used in: Home page, Items List page
   - Behavior: LIVE mode = `new Date()`, TEST mode = stored value
   - Status: ✅ Documented

2. **`new Date()` (real current time)**:
   - Used in: Item Details page (server), ItemDetailsSheet, ItemDetailsPageClient
   - Behavior: Always real current time (ignores TEST mode)
   - Status: ✅ Documented (inconsistency noted)

3. **`occurred_at` (user-provided date)**:
   - Used in: All odometer entry calculations
   - Behavior: User-provided timestamp, can be in the past
   - Status: ✅ Documented

4. **`created_at` (system timestamp)**:
   - **NOT used in any calculations** (only for audit)
   - Status: ✅ Confirmed unused

### Remaining unknowns (if any)

**All calculation entry points have been identified and documented.**

**Inconsistencies found (factual, not questions)**:
1. Item Details page uses different daily rate function than Home/Items List
2. Item Details page and sheet components don't use `appNow` (use `new Date()` instead)
3. Legacy function `estimateDailyKmRate()` still in use despite deprecation

**No hidden or undocumented calculation logic found.**

---

**End of AS-IS documentation**
