# App Mode and Time Audit — Current Implementation

**Date:** 2025-01-02  
**Type:** Implementation Audit Document  
**Goal:** Single source of truth describing how mileage entries are created, dated, shown in History, and used in calculations  
**Scope:** Manual mileage flow, dev simulation flow, time sources, and calculation behavior

---

## 1. What is an Odometer Entry

### Database Schema

**Table:** `odometer_entries`  
**Location:** `supabase/migrations/20260101114456_init_milekeeper.sql:9-15`

```sql
CREATE TABLE odometer_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL,
  mileage_km INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### TypeScript Interface

**Location:** `src/lib/db/types.ts:7-13`

```typescript
export interface OdometerEntry {
  id: string;
  occurred_at: string; // ISO timestamp
  mileage_km: number;
  note: string | null;
  created_at: string; // ISO timestamp
}
```

### Key Fields

- **`occurred_at`**: Timestamp when the mileage reading occurred (TIMESTAMPTZ, required)
  - Stored as ISO string in TypeScript
  - Can be in the past, present, or future
  - Used for sorting and time-based calculations

- **`mileage_km`**: Odometer reading in kilometers (INTEGER, required)
  - Must be strictly greater than previous maximum (enforced by DB trigger)
  - Used for "current mileage" calculations (MAX query)

- **`note`**: Optional text note (TEXT, nullable)
  - Can be null
  - Used for dev simulation markers (e.g., "DEV: simulate day")

- **`created_at`**: Record creation timestamp (TIMESTAMPTZ, auto-generated)
  - Not used in calculations
  - Only for audit/debugging

### Source Field

**Note:** There is **NO** `source` field in the database schema. The system distinguishes between manual and dev-simulated entries by:
- **Manual entries**: No special note pattern
- **Dev-simulated entries**: Note starts with "DEV: simulate" prefix
  - Location: `src/lib/actions/devActions.ts:334,340,346`

---

## 2. Manual Add Mileage Flow

### Call Chain Diagram

```
User clicks "Добавить пробег"
  ↓
AddMileageForm.tsx (client)
  ↓
User fills form: mileageKm, occurredAt (optional), note (optional)
  ↓
handleSubmit() → addOdometerEntry() server action
  ↓
odometerActions.ts:addOdometerEntry()
  ↓
Validation: mileageKm > maxMileage
  ↓
DB insert: { occurred_at, mileage_km, note }
  ↓
Cache invalidation + revalidatePath()
  ↓
Router refresh → UI updates
```

### UI Component

**Location:** `src/app/components/AddMileageForm.tsx`

**Initial State:**
- `occurredAt`: `new Date().toISOString().slice(0, 16)` (line 13)
  - Defaults to **current browser time** (datetime-local format)
  - User can toggle date picker to change it (line 145-163)

- `mileageKm`: Empty string (line 12)
- `note`: Empty string (line 16)

**Form Submission:**
- Line 42-46: Calls `addOdometerEntry()` with:
  ```typescript
  {
    occurredAt: new Date(occurredAt), // Convert string to Date
    mileageKm: mileage, // Parsed from input
    note: note ? trimWhitespace(note) : null,
  }
  ```

### Server Action: addOdometerEntry

**Location:** `src/lib/actions/odometerActions.ts:175-235`

**Validation Logic:**
- Lines 183-201: Fetches MAX(mileage_km) from database
- Validates: `input.mileageKm > maxMileage`
- Throws error if mileage is not strictly greater

**Insert Logic:**
- Lines 204-212: Inserts into database:
  ```typescript
  {
    occurred_at: input.occurredAt.toISOString(), // Convert Date to ISO string
    mileage_km: input.mileageKm,
    note: input.note || null,
  }
  ```

**Cache Invalidation:**
- Lines 223-232: Invalidates cache tags and paths:
  - `TAGS.odometer`, `TAGS.odometerEntries`, `TAGS.home`, `TAGS.items`
  - Revalidates `/` and `/items` paths

**Database-Level Validation:**
- Location: `supabase/migrations/20260101120354_mileage_guardrails.sql:6-29`
- Trigger `enforce_odometer_monotonic()` runs BEFORE INSERT
- Ensures `NEW.mileage_km > MAX(mileage_km)` from all existing entries
- Throws exception if validation fails

### Time Source for Manual Entries

**`occurred_at` comes from:**
1. **Default:** Browser's `new Date()` when form opens (line 13)
2. **User override:** User can change via datetime-local input (line 155-162)
3. **Final value:** `new Date(occurredAt)` where `occurredAt` is the form state (line 43)

**No server-side time adjustment:** The date/time from the form is used as-is.

---

## 3. Dev Simulation Flow

### Call Chain Diagram

```
User clicks "Поездил день/неделю/месяц" button
  ↓
DevToolsPanel.tsx:handleSimulate(range)
  ↓
simulateTripRange(range) server action
  ↓
devActions.ts:simulateTripRange()
  ↓
Fetch MAX(mileage_km) entry from DB
  ↓
Calculate: nextMileage = baseMileage + incrementKm
  ↓
Calculate: nextDate = baseDate + dayIncrement
  ↓
DB insert: { occurred_at: nextDate, mileage_km: nextMileage, note: "DEV: simulate ..." }
  ↓
Cache invalidation + router refresh
```

### UI Component

**Location:** `src/app/components/DevToolsPanel.tsx`

**Buttons:**
- Line 151: "Поездил день" → `handleSimulate('day')`
- Line 159: "Поездил неделю" → `handleSimulate('week')`
- Line 167: "Поездил месяц" → `handleSimulate('month')`

**Handler:**
- Lines 87-109: `handleSimulate(range)` calls `simulateTripRange(range)`
- After success: Waits 800ms, then `router.replace(/?_t=${Date.now()})` + `router.refresh()`

### Server Action: simulateTripRange

**Location:** `src/lib/actions/devActions.ts:301-419`

**Base Entry Selection:**
- Lines 308-318: Fetches entry with MAX(mileage_km)
  - Query: `ORDER BY mileage_km DESC, occurred_at DESC LIMIT 1`
  - Uses this as the baseline for next entry

**Mileage Calculation:**
- Lines 329-348: Calculates increment based on range:
  - `day`: 60-150 km, dayIncrement = 1
  - `week`: 420-680 km, dayIncrement = 7
  - `month`: 2000-3000 km, dayIncrement = 30
- Line 350: `nextMileage = baseMileage + totalIncrementKm`

**Date Calculation:**
- Lines 352-354: `nextDate = new Date(baseDate)`
  - `nextDate.setDate(nextDate.getDate() + dayIncrement)`
  - **Important:** Uses `baseDate` (from base entry's `occurred_at`) as baseline
  - Even if `baseDate` is in the future, it advances from that date

**Insert:**
- Lines 357-365: Inserts with note prefix:
  - `day`: `"DEV: simulate day"`
  - `week`: `"DEV: simulate week"`
  - `month`: `"DEV: simulate month"`

**Cache Invalidation:**
- Lines 388-398: Invalidates same tags/paths as manual flow

### Test Clock / Dev Time

**Current Implementation:** There is **NO** separate test clock or `devNow` storage.

**Time Advancement:**
- Dev simulation advances time by adding days to the **latest entry's `occurred_at`**
- No global "app time" or "dev time" state
- Each simulation uses the previous entry's date as the anchor

**Future Dates:**
- If base entry has `occurred_at` in the future, next entry will also be in the future
- No validation prevents future dates
- No special handling for future dates in calculations

---

## 4. History Page

### Data Loading

**Location:** `src/app/history/page.tsx:8-10`

```typescript
const entries = await listOdometerEntries(50);
const latestEntry = await getLatestOdometerEntry('History');
```

### listOdometerEntries Function

**Location:** `src/lib/actions/odometerActions.ts:41-51`

**Query:**
- Lines 23-30: `SELECT * FROM odometer_entries ORDER BY occurred_at DESC LIMIT ?`
- **No filtering by source:** All entries are included (manual + dev-simulated)
- **No `includeDevSim` parameter:** Dev-simulated entries are always included
- **No toggles/filters:** History shows all entries without filtering options

**Caching:**
- Lines 43-49: Uses `unstable_cache` with tag `TAGS.odometerEntries`
- Cache key includes limit: `odometerEntries:${limit}` or `odometerEntries:all`

### Display

**Location:** `src/app/history/page.tsx:35-65`

**Rendering:**
- Shows all entries in descending order (newest first)
- Displays: mileage, date/time (formatted), delta from previous entry, note
- **No visual distinction** between manual and dev-simulated entries
- Dev-simulated entries show their "DEV: simulate ..." note text

**Actions:**
- Lines 28-31: Edit/Delete buttons for latest entry only
- No bulk operations or filtering UI

---

## 5. Home + Items Calculations

### Home Page

**Location:** `src/app/page.tsx:36-491`

#### Odometer Data Loading

**Lines 45-60:**
```typescript
const maxMileageEntryP = getMaxMileageEntry('Home')
const odometerEntriesP = listOdometerEntries(50)
```

**Functions Used:**
1. **`getMaxMileageEntry('Home')`**
   - Location: `src/lib/actions/odometerActions.ts:145-167`
   - Query: `ORDER BY mileage_km DESC LIMIT 1` (line 123)
   - **No filtering:** Includes all entries (manual + dev-simulated)
   - **No `includeDevSim` parameter:** Always includes dev entries
   - Returns entry with maximum mileage (used as "current mileage")

2. **`listOdometerEntries(50)`**
   - Location: `src/lib/actions/odometerActions.ts:41-51`
   - Query: `ORDER BY occurred_at DESC LIMIT 50` (line 26)
   - **No filtering:** Includes all entries
   - Used for daily rate calculation

#### Time Source: 'now'

**Line 82:**
```typescript
const now = new Date();
```

**Source:** Browser/server `new Date()` - **real current time**, not simulated time.

#### Daily Rate Calculation

**Lines 85-92:**
```typescript
const dailyRate = computeDailyRate(odometerEntries); // Legacy, not used
const forecastResult = estimateDailyKmRate(odometerEntries);
const forecastDailyKmRate = forecastResult.dailyKmRate; // Always > 0
```

**Functions:**

1. **`computeDailyRate(entries)`**
   - Location: `src/lib/prediction/dailyRate.ts:16-61`
   - Uses: Last 10 entries within 60 days (line 25-27)
   - Window anchor: `new Date()` (real current time, line 21)
   - Returns: Median km/day or null
   - **Note:** This function is computed but not used in status calculations (line 85)

2. **`estimateDailyKmRate(entries)`**
   - Location: `src/lib/service/odometerForecast.ts:28-86`
   - Uses: Last 20 entries within 14 days (defaults, lines 33-34)
   - Window anchor: `newestEntry.occurred_at` (line 48-49)
     - `cutoffDate = newestDate - 14 days` (line 52-53)
   - Returns: `EstimateResult { dailyKmRate: number, isFallback: boolean }`
   - Fallback: 30 km/day if insufficient data (line 37, 44, 62, 74, 82)

#### Status Calculation

**Lines 106-112:**
```typescript
const statusResult = calcServiceStatus({
  serviceItem: item,
  latestOdometerMileageKm: currentMileage, // From maxMileageEntry
  lastEvent,
  dailyKmRate: forecastDailyKmRate, // From estimateDailyKmRate
  now, // new Date() - real current time
});
```

**Time Sources:**
- `now`: Real current time (`new Date()`)
- `latestOdometerMileageKm`: From MAX(mileage_km) entry
- `dailyKmRate`: Calculated from entries within 14-day window anchored to newest entry's date

### Items Page

**Location:** `src/app/items/page.tsx:14-118`

#### Odometer Data Loading

**Lines 20-31:**
```typescript
const latestOdometerP = getMaxMileageEntry('ItemsList')
const odometerEntriesP = listOdometerEntries(50)
```

**Same functions as Home:**
- `getMaxMileageEntry()`: MAX(mileage_km), no filtering
- `listOdometerEntries(50)`: Last 50 by date, no filtering

#### Time Source: 'now'

**Line 45:**
```typescript
const now = new Date();
```

**Source:** Browser/server `new Date()` - **real current time**.

#### Daily Rate Calculation

**Lines 48-51:**
```typescript
const forecastResult = estimateDailyKmRate(odometerEntries);
const forecastDailyKmRate = forecastResult.dailyKmRate;
const isFallbackRate = forecastResult.isFallback;
```

**Same function as Home:**
- `estimateDailyKmRate()`: 14-day window, 20 entries max, anchored to newest entry's date

#### Status Calculation

**Lines 55-61:**
```typescript
const statusResult = calcServiceStatus({
  serviceItem: item,
  latestOdometerMileageKm: currentMileage, // From maxMileageEntry
  lastEvent,
  dailyKmRate: forecastDailyKmRate,
  now, // new Date() - real current time
});
```

**Same time sources as Home.**

---

## 6. Known Divergences

### Manual vs Dev Simulation

#### 1. Validation

**Manual Flow:**
- Location: `src/lib/actions/odometerActions.ts:183-201`
- Validates: `mileageKm > maxMileage` (application-level)
- Also enforced by DB trigger (database-level)

**Dev Simulation:**
- Location: `src/lib/actions/devActions.ts:308-318`
- Fetches MAX(mileage_km) entry
- Calculates `nextMileage = baseMileage + incrementKm`
- **No explicit validation** (relies on DB trigger)
- **Note:** Dev simulation always increments, so validation should pass

#### 2. Cache Invalidation

**Manual Flow:**
- Location: `src/lib/actions/odometerActions.ts:223-232`
- Invalidates: `TAGS.odometer`, `TAGS.odometerEntries`, `TAGS.home`, `TAGS.items`
- Revalidates: `/`, `/items` paths

**Dev Simulation:**
- Location: `src/lib/actions/devActions.ts:388-398`
- Invalidates: Same tags as manual flow
- Revalidates: Same paths as manual flow
- **Additional:** `router.replace(/?_t=${Date.now()})` in UI (line 99)

**Result:** Both flows invalidate the same cache tags/paths. No divergence.

#### 3. includeDevSim Parameter

**Current State:** There is **NO** `includeDevSim` parameter anywhere in the codebase.

**All queries include dev-simulated entries:**
- `listOdometerEntries()`: No filtering
- `getMaxMileageEntry()`: No filtering
- `getLatestOdometerEntry()`: No filtering

**Result:** Manual and dev-simulated entries are treated identically in all calculations.

#### 4. Time Anchor

**Manual Flow:**
- `occurred_at` comes from user input (defaults to browser time)
- No time anchor - user can set any date/time

**Dev Simulation:**
- `occurred_at` calculated from previous entry's date + day increment
- Time anchor: Previous entry's `occurred_at`

**Result:** Manual entries can have arbitrary dates. Dev simulation advances sequentially from the last entry's date.

---

## 7. Risks / Edge-Cases List

### Future Dates

**Risk:** Entries can have `occurred_at` in the future.

**Evidence:**
- Manual flow: User can set any date/time via datetime-local input
  - Location: `src/app/components/AddMileageForm.tsx:155-162`
- Dev simulation: Advances from base entry's date, which could be in the future
  - Location: `src/lib/actions/devActions.ts:352-354`

**Impact:**
- `estimateDailyKmRate()` uses `newestEntry.occurred_at` as window anchor
  - Location: `src/lib/service/odometerForecast.ts:48-53`
- If newest entry is in the future, window calculation may be incorrect
- `computeDailyRate()` uses `new Date()` (real time) as anchor
  - Location: `src/lib/prediction/dailyRate.ts:21-22`
- Divergence: `estimateDailyKmRate` uses entry date, `computeDailyRate` uses real time

### Mixing Manual + Simulated

**Risk:** Manual entries can be inserted between dev-simulated entries.

**Evidence:**
- No validation prevents manual entries from having dates between dev entries
- Manual flow validates only mileage monotonicity, not date ordering
  - Location: `src/lib/actions/odometerActions.ts:183-201`

**Impact:**
- Dev simulation advances from MAX(mileage_km) entry, not necessarily the latest by date
  - Location: `src/lib/actions/devActions.ts:308-318`
- If manual entry has higher mileage but earlier date, dev simulation will use it as base
- Date sequence can become non-monotonic while mileage remains monotonic

### Window Cutoff Behavior

**Risk:** Daily rate calculation window may exclude relevant entries.

**Evidence:**
- `estimateDailyKmRate()` uses 14-day window anchored to newest entry's date
  - Location: `src/lib/service/odometerForecast.ts:48-53`
- If entries are sparse (e.g., weekly), window may contain < 2 entries
- Falls back to 30 km/day if insufficient data
  - Location: `src/lib/service/odometerForecast.ts:37,44,62,74,82`

**Impact:**
- Sparse entry history → fallback rate → less accurate predictions
- Window cutoff is based on entry dates, not real time

### Timezone Assumptions

**Risk:** Timezone handling may be inconsistent.

**Evidence:**
- Database: `TIMESTAMPTZ` (timezone-aware)
  - Location: `supabase/migrations/20260101114456_init_milekeeper.sql:11`
- TypeScript: `occurred_at: string` (ISO timestamp)
  - Location: `src/lib/db/types.ts:9`
- Conversions: `new Date(occurredAt)` and `.toISOString()`
  - Locations: Multiple (e.g., `src/lib/actions/odometerActions.ts:207`)

**Impact:**
- Browser timezone vs server timezone vs database timezone
- Date calculations may shift by timezone offset
- No explicit timezone normalization in code

### No Source Tracking

**Risk:** Cannot distinguish manual vs dev-simulated entries programmatically.

**Evidence:**
- No `source` field in database schema
- Relies on note pattern: "DEV: simulate ..."
  - Location: `src/lib/actions/devActions.ts:334,340,346`

**Impact:**
- Cannot filter dev entries without parsing notes
- Cannot validate that dev entries are not used in production
- No way to exclude dev entries from calculations if needed

### Date vs Mileage Ordering Divergence

**Risk:** Entries can be ordered differently by date vs mileage.

**Evidence:**
- `getLatestOdometerEntry()`: Orders by `occurred_at DESC, mileage_km DESC`
  - Location: `src/lib/actions/odometerActions.ts:64-65`
- `getMaxMileageEntry()`: Orders by `mileage_km DESC`
  - Location: `src/lib/actions/odometerActions.ts:123`
- These can return different entries if date and mileage orderings diverge

**Impact:**
- "Latest by date" vs "Latest by mileage" can be different entries
- Dev simulation uses MAX(mileage), not latest by date
- Calculations may use different "current" entries depending on query

---

## Summary

### Key Findings

1. **No source field:** System distinguishes manual vs dev entries by note pattern only
2. **No test clock:** Dev simulation advances from previous entry's date, no global dev time
3. **No filtering:** All queries include dev-simulated entries (no `includeDevSim` parameter)
4. **Time sources:** Calculations use real `new Date()` for "now", entry dates for window anchors
5. **Validation:** Manual flow validates mileage monotonicity; dev simulation relies on DB trigger
6. **Future dates allowed:** No validation prevents entries with future `occurred_at`
7. **Date/mileage divergence:** Entries can be ordered differently by date vs mileage

### Call Chain Diagrams

#### Manual Add Mileage

```
AddMileageForm.tsx:handleSubmit()
  ↓
addOdometerEntry({ occurredAt: new Date(occurredAt), mileageKm, note })
  ↓
odometerActions.ts:addOdometerEntry()
  ├─ Validate: mileageKm > MAX(mileage_km)
  ├─ Insert: { occurred_at: occurredAt.toISOString(), mileage_km, note }
  └─ Invalidate cache + revalidatePath()
  ↓
DB trigger: enforce_odometer_monotonic()
  └─ Validate: NEW.mileage_km > MAX(mileage_km)
  ↓
Router refresh → UI updates
```

#### Simulate Trip

```
DevToolsPanel.tsx:handleSimulate(range)
  ↓
simulateTripRange(range)
  ↓
devActions.ts:simulateTripRange()
  ├─ Fetch: MAX(mileage_km) entry
  ├─ Calculate: nextMileage = baseMileage + incrementKm
  ├─ Calculate: nextDate = baseDate + dayIncrement
  ├─ Insert: { occurred_at: nextDate, mileage_km: nextMileage, note: "DEV: simulate ..." }
  └─ Invalidate cache + revalidatePath()
  ↓
DB trigger: enforce_odometer_monotonic()
  └─ Validate: NEW.mileage_km > MAX(mileage_km)
  ↓
Router.replace(/?_t=...) + router.refresh() → UI updates
```

---

**Document Status:** Complete audit of current implementation. No proposed solutions.

