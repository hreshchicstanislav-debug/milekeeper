# Timezone Display Audit

**Date:** 2025-01-02  
**Type:** Audit Document  
**Goal:** Document where time is displayed and where datetime-local is generated/parsed to identify UTC/local mismatches  
**Scope:** All `occurred_at` formatting, datetime-local conversions, and time display functions

---

## 1. Where `occurred_at` is Displayed

### 1.1. History Page

**File:** `src/app/history/page.tsx`

- **Line 41:** `formatDateTimeRu(entry.occurred_at)` - Formats each entry's `occurred_at` for display
- **Format used:** `formatDateTimeRu()` function (see section 4.1)
- **Input:** `entry.occurred_at` (ISO string from database)
- **Display:** DD.MM.YYYY HH:MM format

### 1.2. Home Page

**File:** `src/app/page.tsx`

- **Line 476:** `formatDateTimeRu(maxMileageEntry.occurred_at)` - Displays latest odometer entry date
- **Format used:** `formatDateTimeRu()` function
- **Input:** `maxMileageEntry.occurred_at` (ISO string from database)
- **Display:** DD.MM.YYYY HH:MM format

### 1.3. Items Detail Page

**File:** `src/app/items/[id]/ItemDetailsPageClient.tsx`

- **Line 248:** `formatDateTimeRu(event.occurred_at)` - Formats service event dates
- **Line 285:** `formatDateTimeRu(lastEvent.occurred_at)` - Formats last service event date
- **Format used:** `formatDateTimeRu()` function
- **Input:** `event.occurred_at` / `lastEvent.occurred_at` (ISO strings from database)
- **Display:** DD.MM.YYYY HH:MM format

### 1.4. Item Details Sheet (Client Component)

**File:** `src/app/components/ItemDetailsSheet.tsx`

- **Line 512:** `formatDateTimeRu(event.occurred_at)` - Formats service event dates
- **Line 549:** `formatDateTimeRu(lastEvent.occurred_at)` - Formats last service event date
- **Line 651:** `formatDateTimeRu(new Date(statusResult.primary.dueValue))` - Formats predicted due date (⚠️ converts number to Date)
- **Format used:** `formatDateTimeRu()` function
- **Input:** ISO strings from database, or Date object for predictions
- **Display:** DD.MM.YYYY HH:MM format

### 1.5. Odometer Preview Component

**File:** `src/app/components/OdometerPreview.tsx`

- **Line 23:** `formatDateTimeRu(entry.occurred_at)` - Formats odometer entry dates
- **Format used:** `formatDateTimeRu()` function
- **Input:** `entry.occurred_at` (ISO string from database)
- **Display:** DD.MM.YYYY HH:MM format

---

## 2. Where `occurred_at` is Edited or Prefilled

### 2.1. AddMileageForm (Manual Entry)

**File:** `src/app/components/AddMileageForm.tsx`

**Initial Value (TEST mode):**
- **Line 34:** `appNow.toISOString().slice(0, 16)` - Uses AppNow, converts to ISO, slices to datetime-local format
- **Line 47:** `appNow.toISOString().slice(0, 16)` - Updates every second in TEST mode

**Initial Value (LIVE mode):**
- **Line 16:** `new Date().toISOString().slice(0, 16)` - Uses browser time, converts to ISO, slices to datetime-local format
- **Line 38:** `new Date().toISOString().slice(0, 16)` - Resets on form open

**Display (TEST mode, read-only):**
- **Line 206:** `new Date(occurredAt).toLocaleString('ru-RU', {...})` - ⚠️ Parses datetime-local string as if it were UTC, then formats in local timezone

**Input Field (LIVE mode):**
- **Line 232:** `<input type="datetime-local" value={occurredAt} />` - Uses datetime-local input
- **Line 234:** `setOccurredAt(e.target.value)` - Stores user input directly (local time string)

**Submission:**
- **Line 76 (TEST):** `submissionOccurredAt = getAppNow()` - Uses AppNow directly (Date object)
- **Line 78 (LIVE):** `submissionOccurredAt = new Date(occurredAt)` - ⚠️ Parses datetime-local string as if it were UTC

### 2.2. EditLatestMileage (Edit Existing Entry)

**File:** `src/app/components/EditLatestMileage.tsx`

**Initial Value:**
- **Line 26:** `new Date(latestEntry.occurred_at).toISOString().slice(0, 16)` - Parses ISO string from DB, converts to ISO, slices to datetime-local format
- **Line 41:** Same on form open

**Input Field:**
- **Line 152:** `<input type="datetime-local" value={occurredAt} />` - Uses datetime-local input
- **Line 154:** `setOccurredAt(e.target.value)` - Stores user input directly (local time string)

**Submission:**
- **Line 66:** `occurredAt: new Date(occurredAt)` - ⚠️ Parses datetime-local string as if it were UTC

### 2.3. AddServiceEventForm (Service Event Entry)

**File:** `src/app/components/AddServiceEventForm.tsx`

**Initial Value:**
- **Line 213:** `new Date().toISOString().slice(0, 16)` - Uses browser time, converts to ISO, slices to datetime-local format
- **Line 244:** Same on form open

**Input Field:**
- **Line 385:** `<input type="datetime-local" value={occurredAt} />` - Uses datetime-local input
- **Line 387:** `setOccurredAt(e.target.value)` - Stores user input directly (local time string)

**Submission:**
- **Line 275:** `occurredAt: new Date(occurredAt)` - ⚠️ Parses datetime-local string as if it were UTC

### 2.4. DevToolsPanel (Test Clock AppNow)

**File:** `src/app/components/DevToolsPanel.tsx`

**Initial Value:**
- **Line 86:** `current.toISOString().slice(0, 16)` - Formats AppNow for datetime-local input
- **Line 99:** Same on AppNow update

**Input Field:**
- **Line 356:** `<input type="datetime-local" value={appNowInput} />` - Uses datetime-local input
- **Line 359:** `handleAppNowInputChange(e.target.value)` - Stores user input directly (local time string)

**Submission:**
- **Line 237:** `const date = new Date(appNowInput)` - ⚠️ Parses datetime-local string as if it were UTC

---

## 3. Where datetime-local Value is Parsed/Sent to Server

### 3.1. AddMileageForm Submission

**File:** `src/app/components/AddMileageForm.tsx`

- **Line 78 (LIVE mode):** `submissionOccurredAt = new Date(occurredAt)` - Parses datetime-local string
- **Line 82:** `addOdometerEntry({ occurredAt: submissionOccurredAt })` - Sends Date object to server action
- **Server action:** `src/lib/actions/odometerActions.ts:207` - `occurred_at: input.occurredAt.toISOString()` - Converts Date to ISO string for DB

**Issue:** `new Date(occurredAt)` where `occurredAt` is a datetime-local string (e.g., "2025-01-02T14:30") is parsed as if it were UTC, not local time.

### 3.2. EditLatestMileage Submission

**File:** `src/app/components/EditLatestMileage.tsx`

- **Line 66:** `occurredAt: new Date(occurredAt)` - Parses datetime-local string
- **Line 64:** `updateLatestOdometerEntry({ occurredAt: new Date(occurredAt), ... })` - Sends Date object to server action
- **Server action:** `src/lib/actions/odometerActions.ts:329` - `occurred_at: input.occurredAt.toISOString()` - Converts Date to ISO string for DB

**Issue:** Same as 3.1 - datetime-local string parsed as UTC.

### 3.3. AddServiceEventForm Submission

**File:** `src/app/components/AddServiceEventForm.tsx`

- **Line 275:** `occurredAt: new Date(occurredAt)` - Parses datetime-local string
- **Line 273:** `addServiceEvent({ occurredAt: new Date(occurredAt), ... })` - Sends Date object to server action
- **Server action:** `src/lib/actions/serviceActions.ts:364` - `occurred_at: input.occurredAt.toISOString()` - Converts Date to ISO string for DB

**Issue:** Same as 3.1 - datetime-local string parsed as UTC.

### 3.4. DevToolsPanel AppNow Input

**File:** `src/app/components/DevToolsPanel.tsx`

- **Line 237:** `const date = new Date(appNowInput)` - Parses datetime-local string
- **Line 242:** `setAppNow(date)` - Stores Date object (converts to ISO in `appNow.ts:125`)

**Issue:** Same as 3.1 - datetime-local string parsed as UTC.

---

## 4. Inventory of Time Formatting Functions

### 4.1. formatDateTimeRu()

**File:** `src/lib/ui/formatDateTimeRu.ts`

**Function signature:**
- **Line 6:** `export function formatDateTimeRu(input: string | Date | null | undefined): string`

**Implementation:**
- **Line 13:** `const date = typeof input === 'string' ? new Date(input) : input` - Parses ISO string or uses Date object
- **Lines 21-27:** Formats using `date.getDate()`, `date.getMonth()`, `date.getFullYear()`, `date.getHours()`, `date.getMinutes()` - ⚠️ Uses local timezone methods

**Behavior:**
- Parses ISO string (UTC) using `new Date(input)` - interprets as UTC
- Formats using local timezone methods (`getDate()`, `getHours()`, etc.) - converts to local time for display
- **Result:** UTC time displayed in local timezone (correct behavior for display)

**Usage locations:**
- `src/app/history/page.tsx:41`
- `src/app/page.tsx:476`
- `src/app/items/[id]/ItemDetailsPageClient.tsx:248,285`
- `src/app/components/ItemDetailsSheet.tsx:512,549,651`
- `src/app/components/OdometerPreview.tsx:23`

### 4.2. toISOString() Calls

**Purpose:** Convert Date to ISO string (UTC) for storage/transmission

**Locations:**
- `src/lib/actions/odometerActions.ts:207` - Store `occurred_at` in DB
- `src/lib/actions/odometerActions.ts:329` - Update `occurred_at` in DB
- `src/lib/actions/serviceActions.ts:364` - Store service event `occurred_at` in DB
- `src/lib/actions/devActions.ts:160,247,375` - Store simulated entry `occurred_at` in DB
- `src/lib/appNow.ts:125` - Store AppNow in localStorage/cookie
- `src/app/components/AddMileageForm.tsx:34,38,47,99,107` - Format for datetime-local input
- `src/app/components/EditLatestMileage.tsx:26,41` - Format for datetime-local input
- `src/app/components/AddServiceEventForm.tsx:213,244,283` - Format for datetime-local input
- `src/app/components/DevToolsPanel.tsx:86,99,141,188,201,212,224` - Format AppNow for datetime-local input

### 4.3. toLocaleString() Calls

**Purpose:** Format Date in local timezone for display

**Locations:**
- `src/app/components/AddMileageForm.tsx:206` - Display AppNow in TEST mode (read-only)
  - **Line 206:** `new Date(occurredAt).toLocaleString('ru-RU', {...})` - ⚠️ Parses datetime-local as UTC, then formats in local timezone
- `src/app/components/DevToolsPanel.tsx:251` - Display AppNow in Test Clock UI
  - **Line 251:** `date.toLocaleString('ru-RU', {...})` - Formats Date object in local timezone (correct)

### 4.4. Intl.DateTimeFormat() Calls

**Purpose:** Format Date using Intl API

**Locations:**
- `src/lib/copy/ru.ts:263` - `formatDateTime()` function (unused in current codebase)
- `src/lib/copy/ru.ts:275` - `formatDate()` function (unused in current codebase)

### 4.5. Date() Parsing Calls

**Purpose:** Parse strings or create Date objects

**Locations:**
- `src/lib/ui/formatDateTimeRu.ts:13` - Parse ISO string: `new Date(input)` - interprets as UTC
- `src/app/components/AddMileageForm.tsx:78` - Parse datetime-local: `new Date(occurredAt)` - ⚠️ interprets as UTC (should be local)
- `src/app/components/AddMileageForm.tsx:206` - Parse datetime-local: `new Date(occurredAt)` - ⚠️ interprets as UTC (should be local)
- `src/app/components/EditLatestMileage.tsx:26,41,66` - Parse ISO or datetime-local: `new Date(...)` - ⚠️ interprets datetime-local as UTC
- `src/app/components/AddServiceEventForm.tsx:275` - Parse datetime-local: `new Date(occurredAt)` - ⚠️ interprets as UTC (should be local)
- `src/app/components/DevToolsPanel.tsx:237` - Parse datetime-local: `new Date(appNowInput)` - ⚠️ interprets as UTC (should be local)
- `src/lib/service/odometerForecast.ts:57,68,78` - Parse ISO strings: `new Date(entry.occurred_at)` - interprets as UTC (correct)
- `src/lib/prediction/dailyRate.ts:26,28,40,74` - Parse ISO strings: `new Date(entry.occurred_at)` - interprets as UTC (correct)

---

## 5. Suspected Mismatch Points

### 5.1. datetime-local Input → Date Parsing (CRITICAL)

**Issue:** When a user enters a datetime-local value (e.g., "2025-01-02T14:30"), `new Date("2025-01-02T14:30")` interprets it as UTC, not local time.

**Affected locations:**
- `src/app/components/AddMileageForm.tsx:78` - LIVE mode submission
- `src/app/components/AddMileageForm.tsx:206` - TEST mode display (read-only, but still wrong)
- `src/app/components/EditLatestMileage.tsx:66` - Edit submission
- `src/app/components/AddServiceEventForm.tsx:275` - Service event submission
- `src/app/components/DevToolsPanel.tsx:237` - AppNow manual input

**Example:**
- User in timezone UTC+3 enters "2025-01-02T14:30" (intending local time 14:30)
- `new Date("2025-01-02T14:30")` creates Date object for UTC 14:30
- Stored in DB as `2025-01-02T14:30:00.000Z` (UTC)
- Displayed as `02.01.2025 17:30` (UTC+3 local time) - **3 hours off**

### 5.2. datetime-local Prefill from ISO String

**Issue:** When prefilling datetime-local input from ISO string, the conversion may lose timezone information.

**Affected locations:**
- `src/app/components/EditLatestMileage.tsx:26,41` - `new Date(latestEntry.occurred_at).toISOString().slice(0, 16)`
  - ISO string (UTC) → Date (UTC) → ISO string (UTC) → datetime-local format
  - If DB has `2025-01-02T14:30:00.000Z` (UTC), datetime-local shows `2025-01-02T14:30` (user expects local time equivalent)

**Example:**
- DB stores `2025-01-02T11:30:00.000Z` (UTC, which is 14:30 in UTC+3)
- `new Date("2025-01-02T11:30:00.000Z")` creates Date for UTC 11:30
- `.toISOString().slice(0, 16)` produces `"2025-01-02T11:30"`
- datetime-local input shows `2025-01-02T11:30` (user expects `2025-01-02T14:30`)

### 5.3. TEST Mode Display in AddMileageForm

**Issue:** In TEST mode, `occurredAt` is a datetime-local format string (from `appNow.toISOString().slice(0, 16)`), but it's displayed using `new Date(occurredAt).toLocaleString()` which parses it as UTC.

**Affected location:**
- `src/app/components/AddMileageForm.tsx:206` - `new Date(occurredAt).toLocaleString('ru-RU', {...})`

**Example:**
- AppNow is `2025-01-02T11:30:00.000Z` (UTC)
- `appNow.toISOString().slice(0, 16)` produces `"2025-01-02T11:30"`
- `new Date("2025-01-02T11:30")` creates Date for UTC 11:30 (correct)
- `.toLocaleString()` displays in local timezone (e.g., `02.01.2025, 14:30` in UTC+3) - **may be correct if AppNow is stored in UTC**

### 5.4. formatDateTimeRu() Behavior

**Issue:** `formatDateTimeRu()` parses ISO strings (UTC) and formats using local timezone methods. This is **correct behavior** for display, but the conversion happens implicitly.

**Affected location:**
- `src/lib/ui/formatDateTimeRu.ts:13,21-27`

**Behavior:**
- Input: `"2025-01-02T11:30:00.000Z"` (UTC)
- `new Date("2025-01-02T11:30:00.000Z")` creates Date for UTC 11:30
- `date.getHours()` returns local time (e.g., 14 in UTC+3)
- Output: `"02.01.2025 14:30"` (local time) - **correct for display**

**Note:** This is not a bug, but the UTC→local conversion is implicit and may cause confusion.

---

## 6. Concrete Examples

### Example 1: Manual Entry in LIVE Mode (UTC+3 timezone)

**Flow:**
1. User opens AddMileageForm (LIVE mode)
2. **Line 38:** `setOccurredAt(new Date().toISOString().slice(0, 16))` - Sets to current browser time in datetime-local format
   - Current time: `2025-01-02T14:30:00+03:00` (local)
   - `new Date()` creates Date for local time
   - `.toISOString()` converts to UTC: `"2025-01-02T11:30:00.000Z"`
   - `.slice(0, 16)` produces: `"2025-01-02T11:30"`
3. User sees datetime-local input showing `2025-01-02T11:30` (⚠️ wrong - should show `14:30`)
4. User changes to `2025-01-02T15:00` (intending local time 15:00)
5. **Line 78:** `submissionOccurredAt = new Date("2025-01-02T15:00")` - Parses as UTC 15:00
6. **Line 207 (odometerActions.ts):** `occurred_at: input.occurredAt.toISOString()` - Stores `"2025-01-02T15:00:00.000Z"` (UTC)
7. **History page:** `formatDateTimeRu("2025-01-02T15:00:00.000Z")` - Displays as `02.01.2025 18:00` (UTC+3) - **3 hours off**

**Problem:** User intended 15:00 local time, but system stored 15:00 UTC (18:00 local), and displays 18:00.

### Example 2: Edit Entry in UTC+3 timezone

**Flow:**
1. DB has entry: `occurred_at: "2025-01-02T11:30:00.000Z"` (UTC, which is 14:30 local in UTC+3)
2. User opens EditLatestMileage
3. **Line 26:** `new Date("2025-01-02T11:30:00.000Z").toISOString().slice(0, 16)` - Produces `"2025-01-02T11:30"`
4. datetime-local input shows `2025-01-02T11:30` (⚠️ user expects `14:30` to match what they see in History)
5. User changes to `2025-01-02T15:00` (intending local time 15:00)
6. **Line 66:** `occurredAt: new Date("2025-01-02T15:00")` - Parses as UTC 15:00
7. **Line 329 (odometerActions.ts):** `occurred_at: input.occurredAt.toISOString()` - Stores `"2025-01-02T15:00:00.000Z"` (UTC)
8. **History page:** Displays as `02.01.2025 18:00` (UTC+3) - **3 hours off from user's intent**

**Problem:** User sees `14:30` in History, but edit form shows `11:30`, and saving `15:00` results in `18:00` display.

### Example 3: TEST Mode Entry

**Flow:**
1. AppNow is set to `2025-01-02T11:30:00.000Z` (UTC) via Test Clock
2. User opens AddMileageForm (TEST mode)
3. **Line 34:** `setOccurredAt(appNow.toISOString().slice(0, 16))` - Produces `"2025-01-02T11:30"`
4. **Line 206:** Display shows `new Date("2025-01-02T11:30").toLocaleString('ru-RU', {...})` - Shows `02.01.2025, 14:30` (UTC+3) - **may be correct if AppNow is meant to be UTC**
5. User submits
6. **Line 76:** `submissionOccurredAt = getAppNow()` - Gets Date object directly (UTC 11:30)
7. **Line 207 (odometerActions.ts):** Stores `"2025-01-02T11:30:00.000Z"` (UTC)
8. **History page:** Displays as `02.01.2025 14:30` (UTC+3) - **consistent with display in form**

**Note:** TEST mode may work correctly because it uses Date object directly, not datetime-local string parsing.

---

## 7. Summary of Issues

### Critical Issues (UTC/Local Mismatch)

1. **datetime-local → Date parsing:** `new Date("2025-01-02T14:30")` interprets as UTC, not local time
   - Affects: AddMileageForm (LIVE), EditLatestMileage, AddServiceEventForm, DevToolsPanel
   - Impact: User-entered local time is stored as UTC, causing display offset

2. **ISO → datetime-local prefill:** Converting UTC ISO string to datetime-local format loses timezone context
   - Affects: EditLatestMileage, AddMileageForm (initial value)
   - Impact: User sees UTC time in input, expects local time equivalent

### Minor Issues (Potential Confusion)

3. **TEST mode display:** Uses `new Date(occurredAt).toLocaleString()` where `occurredAt` is datetime-local string
   - May work correctly if AppNow is stored in UTC, but parsing datetime-local as UTC is inconsistent

4. **Implicit UTC→local conversion:** `formatDateTimeRu()` converts UTC to local time implicitly
   - Not a bug, but conversion is not explicit in code

---

**End of Audit**

