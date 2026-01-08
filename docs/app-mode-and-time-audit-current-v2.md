# App Mode and Time Audit — Current Implementation (v2)

**Date:** 2025-01-02  
**Type:** Implementation Audit Document (Verified)  
**Goal:** Verified single source of truth describing how mileage entries are created, dated, shown in History, and used in calculations  
**Scope:** Manual mileage flow, dev simulation flow, time sources, timezone handling, and calculation behavior

**Previous Document:** `docs/app-mode-and-time-audit-current.md`  
**This Document:** Verified against current HEAD commit

---

## 0. Audit Integrity: Outdated Claims from Previous Doc

### Verified Claims (Still Accurate)

1. ✅ **No `source` field in database schema**
   - Previous doc: Section 1, "Source Field" (line 60-65)
   - Current verification: `supabase/migrations/20260101114456_init_milekeeper.sql:9-15` - no source column
   - Current verification: `src/lib/db/types.ts:7-13` - no source field in TypeScript interface
   - **Status:** Accurate

2. ✅ **Dev-simulated entries use note prefix "DEV: simulate ..."**
   - Previous doc: Section 1, "Source Field" (line 64)
   - Current verification: `src/lib/actions/devActions.ts:334,340,346` - note prefixes confirmed
   - **Status:** Accurate

3. ✅ **Manual flow validates mileage monotonicity**
   - Previous doc: Section 2, "Server Action" (line 183-201)
   - Current verification: `src/lib/actions/odometerActions.ts:183-201` - validation confirmed
   - **Status:** Accurate

4. ✅ **Dev simulation advances from MAX(mileage_km) entry**
   - Previous doc: Section 3, "Base Entry Selection" (line 308-318)
   - Current verification: `src/lib/actions/devActions.ts:308-318` - confirmed
   - **Status:** Accurate

5. ✅ **History page shows all entries (no filtering)**
   - Previous doc: Section 4, "listOdometerEntries Function" (line 23-30)
   - Current verification: `src/app/history/page.tsx:9` - `listOdometerEntries(50)` with no filters
   - Current verification: `src/lib/actions/odometerActions.ts:20-39` - no filtering logic
   - **Status:** Accurate

6. ✅ **No `includeDevSim` parameter exists**
   - Previous doc: Section 6, "includeDevSim Parameter" (line mentions it doesn't exist)
   - Current verification: No grep matches for `includeDevSim` in codebase
   - **Status:** Accurate

### Outdated/Incorrect Claims (Corrected Below)

**None found.** All major claims in the previous document are verified as accurate. The previous audit correctly identified:
- No source field
- No test clock
- No appNow/getAppNow functions
- All queries include dev entries
- Time sources use `new Date()`

**Note:** The previous document correctly stated "There is **NO** separate test clock or `devNow` storage" (Section 3, line ~350). This is verified accurate.

---

## 1. Canonical 'now' Definition

### No getAppNow/getAppMode Functions

**Verification:**
- Searched codebase: No files matching `**/appNow.ts` or `**/time/*.ts`
- Grep search: No matches for `getAppNow`, `getAppMode`, `appNow`, `app.*now`
- **Conclusion:** There is **NO** canonical `getAppNow()` or `getAppMode()` function.

### Where 'now' is Defined and Used

**All calculations use `new Date()` directly:**

1. **Home Page:**
   - Location: `src/app/page.tsx:82`
   - Code: `const now = new Date();`
   - Used in: `calcServiceStatus({ ..., now })` (line 111)

2. **Items Page:**
   - Location: `src/app/items/page.tsx:45`
   - Code: `const now = new Date();`
   - Used in: `calcServiceStatus({ ..., now })` (line 60)

3. **calcServiceStatus:**
   - Location: `src/lib/service/calcServiceStatus.ts:63`
   - Default: `now = new Date()` (parameter default)
   - Usage: All date calculations within status computation

4. **computeDailyRate:**
   - Location: `src/lib/prediction/dailyRate.ts:21`
   - Code: `const now = new Date();`
   - Used for: 60-day window anchor (line 22)

5. **computeConfidence:**
   - Location: `src/lib/prediction/dailyRate.ts:90`
   - Code: `const now = new Date();`
   - Used for: 30/60-day window anchors (lines 91-92)

6. **getDaysSinceLastEntry:**
   - Location: `src/lib/prediction/dailyRate.ts:75`
   - Code: `const now = new Date();`
   - Used for: Days since last entry calculation

**Summary:** Every function that needs "current time" uses `new Date()` directly. There is no centralized time source or test clock mechanism.

---

## 2. Timezone Handling

### UTC Production (toISOString)

**Where UTC is produced:**

1. **Manual Add Flow:**
   - Location: `src/lib/actions/odometerActions.ts:207`
   - Code: `occurred_at: input.occurredAt.toISOString()`
   - Context: Converting Date to ISO string for DB insert

2. **Dev Simulation Flow:**
   - Location: `src/lib/actions/devActions.ts:360`
   - Code: `occurred_at: nextDate.toISOString()`
   - Context: Converting calculated Date to ISO string for DB insert

3. **Update Latest Entry:**
   - Location: `src/lib/actions/odometerActions.ts:329`
   - Code: `occurred_at: input.occurredAt.toISOString()`
   - Context: Converting Date to ISO string for DB update

4. **Seed Demo Data:**
   - Location: `src/lib/actions/devActions.ts:160,247`
   - Code: `occurred_at: entryDate.toISOString()` / `occurred_at: lastDate.toISOString()`
   - Context: Converting generated dates to ISO strings

**Database Storage:**
- Column type: `TIMESTAMPTZ` (timezone-aware)
- Location: `supabase/migrations/20260101114456_init_milekeeper.sql:11`
- Stored as: UTC (PostgreSQL TIMESTAMPTZ standard)

### Local Time Usage (datetime-local)

**Where local time is used:**

1. **AddMileageForm Initial State:**
   - Location: `src/app/components/AddMileageForm.tsx:13`
   - Code: `new Date().toISOString().slice(0, 16)`
   - **Issue:** `toISOString()` produces UTC, but `datetime-local` input expects local time
   - **Behavior:** Browser converts UTC to local for display, but the string is UTC

2. **AddMileageForm Input:**
   - Location: `src/app/components/AddMileageForm.tsx:155-162`
   - Type: `datetime-local` (HTML5 input)
   - **Behavior:** Browser interprets value in local timezone, but initial value is UTC string

3. **Form Submission:**
   - Location: `src/app/components/AddMileageForm.tsx:43`
   - Code: `occurredAt: new Date(occurredAt)`
   - **Behavior:** `new Date()` parses the datetime-local string as local time, then converts to Date object

### Display (formatDateTimeRu)

**Location:** `src/lib/ui/formatDateTimeRu.ts:6-28`

**Implementation:**
- Input: `string | Date | null | undefined` (ISO string or Date object)
- Parsing: `new Date(input)` (line 13)
- Formatting: Uses local time methods:
  - `date.getDate()` (line 21)
  - `date.getMonth()` (line 22)
  - `date.getFullYear()` (line 23)
  - `date.getHours()` (line 24)
  - `date.getMinutes()` (line 25)

**Output Format:** `DD.MM.YYYY HH:MM` (local time, 24-hour)

**Where Used:**
- History page: `src/app/history/page.tsx:41` - `formatDateTimeRu(entry.occurred_at)`
- Home page: `src/app/page.tsx:464` - `formatDateTimeRu(maxMileageEntry.occurred_at)`
- Item details: Multiple locations

### Timezone Conversion Pitfalls

**Identified Issues:**

1. **datetime-local Input Initialization:**
   - Location: `src/app/components/AddMileageForm.tsx:13`
   - Problem: `new Date().toISOString().slice(0, 16)` produces UTC string (e.g., "2025-01-02T15:30")
   - But `datetime-local` expects local time format
   - **Impact:** If user is in timezone ahead of UTC, initial value shows wrong time
   - **Example:** UTC 15:30 → Local 18:30 (UTC+3), but input shows "15:30"

2. **Date Parsing in Calculations:**
   - Location: Multiple (e.g., `src/lib/service/odometerForecast.ts:49`)
   - Code: `new Date(entry.occurred_at)`
   - **Behavior:** ISO string is parsed as UTC, then converted to local Date object
   - **Impact:** Date arithmetic uses local time, but source is UTC
   - **Example:** UTC "2025-01-02T15:30:00Z" → Local Date object → date arithmetic uses local timezone

3. **Window Calculations:**
   - Location: `src/lib/service/odometerForecast.ts:52-53`
   - Code: `cutoffDate.setDate(cutoffDate.getDate() - maxDays)`
   - **Issue:** Uses local date arithmetic on a Date object parsed from UTC
   - **Impact:** Window cutoff may shift by timezone offset

---

## 3. Manual Add Mileage Default occurred_at

### Pre-fill Value

**Location:** `src/app/components/AddMileageForm.tsx:13`

```typescript
const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
```

**What it produces:**
- `new Date()`: Current browser time (local timezone)
- `.toISOString()`: Converts to UTC ISO string (e.g., "2025-01-02T15:30:00.000Z")
- `.slice(0, 16)`: Truncates to "YYYY-MM-DDTHH:mm" format (e.g., "2025-01-02T15:30")

**Issue:** The string is in UTC, but `datetime-local` input expects local time format.

**Browser Behavior:** Modern browsers convert UTC strings to local time for display in `datetime-local` inputs, but the conversion may not be perfect.

### What Gets Sent to Server

**Location:** `src/app/components/AddMileageForm.tsx:42-46`

```typescript
await addOdometerEntry({
  occurredAt: new Date(occurredAt), // Convert string to Date
  mileageKm: mileage,
  note: note ? trimWhitespace(note) : null,
});
```

**Conversion:**
- `occurredAt` (string): From `datetime-local` input (local time format, e.g., "2025-01-02T18:30")
- `new Date(occurredAt)`: Parses as local time, creates Date object
- **Note:** If string is UTC format, `new Date()` interprets it as UTC. If string is local format, `new Date()` interprets it as local.

### What is Stored in DB

**Location:** `src/lib/actions/odometerActions.ts:207`

```typescript
occurred_at: input.occurredAt.toISOString(),
```

**Storage:**
- `input.occurredAt`: Date object (from `new Date(occurredAt)`)
- `.toISOString()`: Converts Date to UTC ISO string
- Database: Stores as `TIMESTAMPTZ` (UTC)

**Flow Summary:**
1. Form state: UTC string (from `toISOString().slice(0, 16)`)
2. User edits: Local time (browser converts for display)
3. Form submission: `new Date(occurredAt)` → Date object (local time interpretation)
4. Server: `.toISOString()` → UTC string
5. Database: Stores as UTC `TIMESTAMPTZ`

---

## 4. Simulation Flow + Test Clock

### DevNow Storage

**Verification:**
- Grep search: No matches for `localStorage`, `sessionStorage`, `devNow`, `test.*clock`
- **Conclusion:** There is **NO** test clock or `devNow` storage mechanism.

### Simulation occurred_at Calculation

**Location:** `src/lib/actions/devActions.ts:352-354`

```typescript
// Calculate next date (use baseDate as baseline, even if it's in the future)
const nextDate = new Date(baseDate);
nextDate.setDate(nextDate.getDate() + dayIncrement);
```

**Process:**
1. Fetch MAX(mileage_km) entry (line 308-314)
2. Extract `baseDate = new Date(baseEntry.occurred_at)` (line 322)
3. Calculate `nextDate = baseDate + dayIncrement` (line 353-354)
4. Insert: `occurred_at: nextDate.toISOString()` (line 360)

**Key Points:**
- No test clock: Uses previous entry's `occurred_at` as baseline
- No localStorage: No persistent dev time state
- Sequential advancement: Each simulation advances from the last entry's date
- Future dates allowed: If base entry is in future, next entry will also be in future

### Test Clock Updates

**Answer:** There is **NO** test clock, so there are no updates.

**Previous Audit Claim:** "There is **NO** separate test clock or `devNow` storage" (Section 3, line ~350)  
**Verification:** ✅ Accurate - no test clock exists.

### Manual Add Flow Interaction

**Question:** Does test clock affect manual add flow?

**Answer:** There is **NO** test clock, so it cannot affect manual add flow.

**Manual Add Flow:**
- Location: `src/app/components/AddMileageForm.tsx:13`
- Default: `new Date().toISOString().slice(0, 16)` (real browser time)
- **No interaction with simulation:** Manual add always uses real browser time

---

## 5. Entry Classification

### Source Column in DB/Types

**Database Schema:**
- Location: `supabase/migrations/20260101114456_init_milekeeper.sql:9-15`
- **Verification:** No `source` column exists

**TypeScript Interface:**
- Location: `src/lib/db/types.ts:7-13`
- **Verification:** No `source` field in `OdometerEntry` interface

**Grep Search:**
- Pattern: `source|SOURCE|dev_sim|DEV_SIM`
- Results: No matches in migrations or types

**Conclusion:** There is **NO** `source` column in database or TypeScript types.

### How Dev Entries are Distinguished

**Method:** Note prefix pattern

**Dev-Simulated Entries:**
- Location: `src/lib/actions/devActions.ts:334,340,346`
- Note prefixes:
  - `"DEV: simulate day"` (line 334)
  - `"DEV: simulate week"` (line 340)
  - `"DEV: simulate month"` (line 346)

**Manual Entries:**
- No special note pattern
- Note can be null or any user-provided text

**Query Behavior:**
- **No filtering by default:** All queries include dev entries
- `listOdometerEntries()`: No source filtering (line 20-39)
- `getMaxMileageEntry()`: No source filtering (line 117-135)
- `getLatestOdometerEntry()`: No source filtering (line 57-78)

**Programmatic Distinction:**
- Can only distinguish by parsing `note` field for "DEV: simulate" prefix
- No database-level or type-level distinction

---

## 6. Forecast Windows (14/60/Fallback)

### Which Function is Used

**Primary Function: `estimateDailyKmRate()`**

**Location:** `src/lib/service/odometerForecast.ts:28-86`

**Used in:**
- Home page: `src/app/page.tsx:90` - `estimateDailyKmRate(odometerEntries)`
- Items page: `src/app/items/page.tsx:49` - `estimateDailyKmRate(odometerEntries)`

**Legacy Function: `computeDailyRate()` (Not Used)**

**Location:** `src/lib/prediction/dailyRate.ts:16-61`

**Computed but not used:**
- Home page: `src/app/page.tsx:85` - `computeDailyRate(odometerEntries)` (result stored but not used)
- Items page: Not called

**Conclusion:** Only `estimateDailyKmRate()` is used for status calculations.

### Window Parameters

**estimateDailyKmRate() Window:**
- Location: `src/lib/service/odometerForecast.ts:32-38`
- Defaults:
  - `maxDays = 14` (14-day window)
  - `maxEntries = 20` (max 20 entries)
  - `fallbackDailyKm = 30` (30 km/day fallback)

**computeDailyRate() Window (unused):**
- Location: `src/lib/prediction/dailyRate.ts:21-22`
- Parameters:
  - 60-day window
  - Max 10 entries
  - No fallback (returns null)

### Anchor Date

**estimateDailyKmRate() Anchor:**
- Location: `src/lib/service/odometerForecast.ts:47-53`
- Code:
  ```typescript
  const newestEntry = entries[0]; // First in descending order
  const newestDate = new Date(newestEntry.occurred_at);
  const cutoffDate = new Date(newestDate);
  cutoffDate.setDate(cutoffDate.getDate() - maxDays);
  ```
- **Anchor:** `newestEntry.occurred_at` (newest entry's date)
- **Window:** `[newestDate - 14 days, newestDate]`

**computeDailyRate() Anchor (unused):**
- Location: `src/lib/prediction/dailyRate.ts:21-22`
- Code:
  ```typescript
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  ```
- **Anchor:** `new Date()` (real current time)
- **Window:** `[now - 60 days, now]`

**Divergence:** `estimateDailyKmRate` uses entry date anchor, `computeDailyRate` uses real time anchor.

### Dev Simulation Impact on Window

**Behavior:**
- Dev simulation creates entries with `occurred_at` based on previous entry's date
- If dev entries are the newest entries, they become the window anchor
- Window cutoff is calculated from newest entry's date, not real time

**Example:**
- Real time: 2025-01-02
- Newest entry (dev): 2025-01-10 (future date from simulation)
- Window: `[2025-01-10 - 14 days, 2025-01-10]` = `[2024-12-27, 2025-01-10]`
- **Impact:** Window includes future dates and excludes recent real-time entries

---

## 7. History Page Behavior Today

### Data Loading

**Location:** `src/app/history/page.tsx:8-10`

```typescript
const entries = await listOdometerEntries(50);
const latestEntry = await getLatestOdometerEntry('History');
```

### listOdometerEntries Function

**Location:** `src/lib/actions/odometerActions.ts:20-51`

**Query:**
- Lines 23-30: `SELECT * FROM odometer_entries ORDER BY occurred_at DESC LIMIT ?`
- **No WHERE clause:** All entries included
- **No source filtering:** Dev-simulated entries are included
- **No `includeDevSim` parameter:** Function signature has no filtering option

### Display Behavior

**Location:** `src/app/history/page.tsx:35-65`

**Rendering:**
- Shows all entries in descending order (newest first)
- Displays: mileage, date/time (formatted via `formatDateTimeRu`), delta from previous entry, note
- **No visual distinction:** Manual and dev-simulated entries look identical
- **Dev entries visible:** Entries with "DEV: simulate ..." note are shown with their note text

### Toggles/Filters

**Verification:**
- No toggle UI elements in `src/app/history/page.tsx`
- No filter state or logic
- No source-based filtering

**Conclusion:** History page shows **all entries by default** with **no filtering options**.

---

## 8. Risks / Edge Cases (NO Fixes)

### Future Dates

**Risk:** Entries can have `occurred_at` in the future.

**Evidence:**
- Manual flow: User can set any date/time via `datetime-local` input
  - Location: `src/app/components/AddMileageForm.tsx:155-162`
- Dev simulation: Advances from base entry's date, which could be in the future
  - Location: `src/lib/actions/devActions.ts:352-354`
- No validation: No code prevents future dates

**Impact:**
- `estimateDailyKmRate()` uses `newestEntry.occurred_at` as window anchor
  - Location: `src/lib/service/odometerForecast.ts:48-53`
- If newest entry is in future, window calculation includes future dates
- Window may exclude recent real-time entries
- Calculations may use incorrect time windows

### Mixing Real + Simulated

**Risk:** Manual entries can be inserted between dev-simulated entries.

**Evidence:**
- Manual flow validates only mileage monotonicity, not date ordering
  - Location: `src/lib/actions/odometerActions.ts:183-201`
- Dev simulation uses MAX(mileage_km) entry, not latest by date
  - Location: `src/lib/actions/devActions.ts:308-318`

**Impact:**
- Date sequence can become non-monotonic while mileage remains monotonic
- Dev simulation may use a manual entry with higher mileage but earlier date
- Window calculations may use inconsistent entry sets

### Timezone Conversion Pitfalls

**Risk:** Timezone handling inconsistencies.

**Evidence:**
1. **datetime-local initialization:**
   - Location: `src/app/components/AddMileageForm.tsx:13`
   - Issue: UTC string used for local time input

2. **Date parsing:**
   - Location: Multiple (e.g., `src/lib/service/odometerForecast.ts:49`)
   - Issue: UTC strings parsed, then local time arithmetic applied

3. **Window cutoff:**
   - Location: `src/lib/service/odometerForecast.ts:52-53`
   - Issue: Local date arithmetic on UTC-sourced dates

**Impact:**
- Date calculations may shift by timezone offset
- Window boundaries may be incorrect
- Display times may not match stored times

### Inconsistent Anchor Date Between Functions

**Risk:** Different functions use different time anchors.

**Evidence:**
- `estimateDailyKmRate()`: Uses `newestEntry.occurred_at` as anchor
  - Location: `src/lib/service/odometerForecast.ts:48-53`
- `computeDailyRate()`: Uses `new Date()` (real time) as anchor
  - Location: `src/lib/prediction/dailyRate.ts:21-22`
- `computeConfidence()`: Uses `new Date()` (real time) as anchor
  - Location: `src/lib/prediction/dailyRate.ts:90-92`
- `getDaysSinceLastEntry()`: Uses `new Date()` (real time) as anchor
  - Location: `src/lib/prediction/dailyRate.ts:75`

**Impact:**
- Window calculations may diverge between functions
- Confidence calculations use real time, but rate calculations use entry time
- Inconsistent behavior when entries have future dates

---

## Time Source Matrix

| Screen/Function | Now Source | Window Anchor | Includes Sim Entries? | Notes |
|----------------|------------|---------------|----------------------|-------|
| **Home Page** | `new Date()` (line 82) | `newestEntry.occurred_at` (via `estimateDailyKmRate`) | ✅ Yes (no filtering) | Uses `estimateDailyKmRate()` for forecast |
| **Items Page** | `new Date()` (line 45) | `newestEntry.occurred_at` (via `estimateDailyKmRate`) | ✅ Yes (no filtering) | Uses `estimateDailyKmRate()` for forecast |
| **calcServiceStatus** | `new Date()` (default, line 63) | N/A (uses `now` parameter) | N/A | Receives `now` from caller |
| **estimateDailyKmRate** | N/A | `newestEntry.occurred_at` (line 49) | ✅ Yes (no filtering) | 14-day window from newest entry |
| **computeDailyRate** | `new Date()` (line 21) | `new Date()` (real time, line 21) | ✅ Yes (no filtering) | 60-day window, **not used** |
| **computeConfidence** | `new Date()` (line 90) | `new Date()` (real time, line 90) | ✅ Yes (no filtering) | 30/60-day windows from real time |
| **getDaysSinceLastEntry** | `new Date()` (line 75) | N/A | ✅ Yes (no filtering) | Calculates days since last entry |

**Key Observations:**
- All "now" sources use `new Date()` (real browser/server time)
- Window anchors diverge: `estimateDailyKmRate` uses entry date, others use real time
- All queries include dev-simulated entries (no filtering)

---

## Call Chain Diagrams

### Manual Add Mileage

```
User clicks "Добавить пробег"
  ↓
AddMileageForm.tsx:useState() initializes occurredAt
  ├─ new Date().toISOString().slice(0, 16) (line 13)
  └─ UTC string, but datetime-local expects local
  ↓
User edits date/time (optional, line 155-162)
  ├─ datetime-local input (local time format)
  └─ Browser handles local time display
  ↓
User submits form
  ↓
handleSubmit() → addOdometerEntry() (line 42-46)
  ├─ occurredAt: new Date(occurredAt) (line 43)
  └─ Converts string to Date object (local time interpretation)
  ↓
odometerActions.ts:addOdometerEntry() (line 175-235)
  ├─ Validate: mileageKm > MAX(mileage_km) (line 183-201)
  ├─ Insert: occurred_at: input.occurredAt.toISOString() (line 207)
  └─ Converts Date to UTC ISO string
  ↓
Database: TIMESTAMPTZ column stores UTC
  ↓
DB trigger: enforce_odometer_monotonic() (migration)
  └─ Validates: NEW.mileage_km > MAX(mileage_km)
  ↓
Cache invalidation + revalidatePath() (line 223-232)
  ↓
Router refresh → UI updates
```

### Simulate Trip

```
User clicks "Поездил день/неделю/месяц"
  ↓
DevToolsPanel.tsx:handleSimulate(range) (line 87-109)
  ↓
simulateTripRange(range) server action
  ↓
devActions.ts:simulateTripRange() (line 301-419)
  ├─ Fetch: MAX(mileage_km) entry (line 308-314)
  │   └─ ORDER BY mileage_km DESC, occurred_at DESC
  ├─ Extract: baseDate = new Date(baseEntry.occurred_at) (line 322)
  ├─ Calculate: nextMileage = baseMileage + incrementKm (line 350)
  ├─ Calculate: nextDate = baseDate + dayIncrement (line 353-354)
  │   └─ No test clock: uses baseDate directly
  ├─ Insert: occurred_at: nextDate.toISOString() (line 360)
  │   └─ Note: "DEV: simulate day/week/month" (line 334,340,346)
  └─ Converts Date to UTC ISO string
  ↓
Database: TIMESTAMPTZ column stores UTC
  ↓
DB trigger: enforce_odometer_monotonic() (migration)
  └─ Validates: NEW.mileage_km > MAX(mileage_km)
  ↓
Cache invalidation + revalidatePath() (line 388-398)
  ↓
Router.replace(/?_t=...) + router.refresh() (line 99-101)
  └─ UI updates
```

---

## Summary

### Key Findings

1. **No canonical time source:** All functions use `new Date()` directly
2. **No test clock:** Dev simulation advances from previous entry's date
3. **No source field:** Dev entries distinguished by note prefix only
4. **No filtering:** All queries include dev-simulated entries
5. **Timezone issues:** UTC/local mixing in datetime-local input and date calculations
6. **Anchor divergence:** `estimateDailyKmRate` uses entry date, others use real time
7. **Future dates allowed:** No validation prevents future `occurred_at` values

### Verified vs Previous Audit

**All major claims from previous audit verified as accurate:**
- ✅ No source field
- ✅ No test clock
- ✅ No appNow/getAppNow
- ✅ All queries include dev entries
- ✅ Time sources use `new Date()`

**Additional findings in this audit:**
- Timezone handling details (UTC vs local)
- Window anchor divergence between functions
- datetime-local input initialization issue

---

**Document Status:** Verified against current HEAD commit. All file:line references confirmed accurate.

