# AppMode and AppNow Coverage Audit

**Date:** 2025-01-02  
**Type:** Coverage Audit Document  
**Goal:** Document current state of AppMode toggle and AppNow usage across the application  
**Commit:** `68f41c3`

**How to Reproduce:**
- **Dev build:** `npm run dev` - DevToolsPanel visible, diagnostics enabled
- **Prod build:** `npm run build && npm start` - DevToolsPanel hidden, no diagnostics

---

## 0. Snapshot

**Current Branch/Commit:** `68f41c3`  
**Build Type:** Next.js 16.1.1 with Turbopack  
**Dev vs Prod:** DevToolsPanel and diagnostics only visible in dev (`NODE_ENV !== 'production'`)

---

## 1. AppMode: Storage, Default, and Functions

### 1.1. Storage

**File:** `src/lib/appMode.ts`  
**Storage Key:** `'milekeeper_app_mode'` (line 27)  
**Storage Location:** `localStorage` (client-side only)  
**Default:** `AppMode.LIVE` (lines 38, 52)

### 1.2. Functions

**File:** `src/lib/appMode.ts`

- **`getAppMode(): AppMode`** (lines 34-53)
  - Server-side: Returns `AppMode.LIVE` (line 38)
  - Client-side: Reads from `localStorage.getItem('milekeeper_app_mode')`
  - Default: `AppMode.LIVE` if not set or invalid

- **`setAppMode(mode: AppMode): void`** (lines 61-78)
  - Server-side: No-op (line 70)
  - Client-side: Writes to `localStorage.setItem('milekeeper_app_mode', mode)`
  - Throws error if mode invalid or storage fails

- **`isTestMode(): boolean`** (lines 85-87)
  - Returns `getAppMode() === AppMode.TEST`

- **`isLiveMode(): boolean`** (lines 94-96)
  - Returns `getAppMode() === AppMode.LIVE`

### 1.3. Call-Sites

**`getAppMode()`:**
- `src/lib/appNow.ts:37` - Used to determine mode for AppNow behavior
- `src/app/components/DevToolsPanel.tsx:77` - Read on mount to initialize state
- `src/app/components/AddMileageForm.tsx:28` - Read when form opens to determine behavior
- `src/app/components/HomeSoonMaintenanceBlock.tsx:48` - Read for dev diagnostics (client-side only)

**`setAppMode()`:**
- `src/app/components/DevToolsPanel.tsx:182` - Called when toggle is switched

**`isTestMode()`:**
- `src/app/components/AddMileageForm.tsx:31,44,75,92,106` - Used to conditionally use AppNow vs browser time
- `src/app/components/DevToolsPanel.tsx:124` - Used to gate simulation buttons
- `src/lib/appNow.ts:39,74,112,139` - Used to determine AppNow behavior

**`isLiveMode()`:**
- No call-sites found (function exists but unused)

**`AppMode.TEST` / `AppMode.LIVE` (enum values):**
- `src/app/components/DevToolsPanel.tsx:70,82,92,124,180,185,284,285,287,298,387` - Used for UI state and conditional rendering
- `src/app/components/AddMileageForm.tsx:15,28,29` - Used for state management
- `src/app/components/HomeSoonMaintenanceBlock.tsx:48` - Used for dev diagnostics
- `src/lib/appNow.ts:39,74,112,139` - Used for mode checks

---

## 2. DevToolsPanel: Toggle UI Behavior

**File:** `src/app/components/DevToolsPanel.tsx`

### 2.1. Visibility

**Condition:** Dev-only component (not visible in production builds)  
**Location:** Lines 14-483 (entire component)

### 2.2. Mode Toggle UI

**Lines:** 270-295

**Behavior:**
- **Label:** "Режим тестирования" (line 277)
- **Switch State:** ON = `AppMode.TEST`, OFF = `AppMode.LIVE` (lines 284, 287)
- **Initialization:** Reads `getAppMode()` on mount (line 77)
- **Toggle Handler:** `handleModeToggle()` (lines 179-190)
  - Switches between TEST and LIVE
  - Calls `setAppMode(newMode)` (line 182)
  - Updates local state (line 183)
  - If switching to TEST, initializes AppNow from localStorage or real time (lines 185-188)

**Helper Text:** "Влияет только на поведение тестовых инструментов. В проде недоступно." (line 293)

### 2.3. Blocks Gated by AppMode

**Test Clock UI (lines 298-376):**
- **Visible when:** `appMode === AppMode.TEST` (line 298)
- **Shows:** Current AppNow, controls to set/advance/reset
- **Helper Text:** "AppNow используется только в TEST режиме и влияет на симуляции. В LIVE режиме игнорируется." (line 373)

**Simulation Buttons (lines 387-420):**
- **Visible when:** `appMode === AppMode.TEST` (line 387)
- **Hidden when:** `appMode === AppMode.LIVE` (line 414)
- **Replacement:** Shows message "Симуляция поездок доступна только в режиме тестирования. Переключите режим выше." (lines 415-419)

**Seed Data Button (lines 379-386):**
- **Not gated:** Always visible (no AppMode check)

---

## 3. AppNow: Storage, Functions, and Call-Sites

### 3.1. Storage

**File:** `src/lib/appNow.ts`  
**Storage Key:** `'milekeeper_app_now_iso'` (line 22)  
**Storage Location:** `localStorage` (client-side only)  
**Format:** ISO string (`date.toISOString()`)

### 3.2. Functions

**File:** `src/lib/appNow.ts`

- **`getAppNow(): Date`** (lines 36-65)
  - **LIVE mode:** Always returns `new Date()` (line 41)
  - **TEST mode (server):** Returns `new Date()` (line 47) - **⚠️ Cannot read localStorage**
  - **TEST mode (client):** Reads from `localStorage.getItem('milekeeper_app_now_iso')` (line 51)
  - **Default:** `new Date()` if not stored or invalid

- **`setAppNow(appNow: Date | string): void`** (lines 73-102)
  - **LIVE mode:** No-op (line 79)
  - **TEST mode (server):** No-op (line 85)
  - **TEST mode (client):** Writes to `localStorage.setItem('milekeeper_app_now_iso', date.toISOString())` (line 98)
  - Throws error if date invalid or storage fails

- **`advanceAppNow(days: number): Date`** (lines 111-129)
  - **LIVE mode:** Throws error (line 115)
  - **TEST mode:** Gets current AppNow, adds days, calls `setAppNow()`, returns new value

- **`resetAppNow(): void`** (lines 138-158)
  - **LIVE mode:** No-op (line 143)
  - **TEST mode (server):** No-op (line 149)
  - **TEST mode (client):** Removes `localStorage.removeItem('milekeeper_app_now_iso')` (line 154)

### 3.3. Call-Sites

**`getAppNow()`:**
- `src/app/page.tsx:85` - **Server component** - Used for Home calculations (⚠️ returns real time on server)
- `src/app/components/HomeSoonMaintenanceBlock.tsx:49` - **Client component** - Dev diagnostics only
- `src/app/components/AddMileageForm.tsx:33,46,76,94` - **Client component** - Used for TEST mode date handling
- `src/app/components/DevToolsPanel.tsx:83,97,133,186` - **Client component** - Test Clock UI display and updates
- `src/lib/appNow.ts:37,119` - Internal use (mode check, advanceAppNow)

**`setAppNow()`:**
- `src/app/components/AddMileageForm.tsx:97` - **Client component** - Advances AppNow after manual entry in TEST mode
- `src/app/components/DevToolsPanel.tsx:138,199,242` - **Client component** - Test Clock UI controls

**`advanceAppNow()`:**
- `src/app/components/DevToolsPanel.tsx:210` - **Client component** - Test Clock "+N дней" buttons

**`resetAppNow()`:**
- `src/app/components/DevToolsPanel.tsx:221` - **Client component** - Test Clock "Сброс" button

---

## 4. Canonical Now Matrix

| Screen/Feature | File | Line(s) | Now Source | Notes |
|----------------|------|---------|------------|-------|
| **Home Page** | `src/app/page.tsx` | 85 | `getAppNow()` | Server component - ⚠️ returns real time on server |
| **Home: calcServiceStatus** | `src/app/page.tsx` | 106-112 | `appNow` (from getAppNow) | Passed as `now` parameter |
| **Home: estimateDailyKmRateUnified** | `src/app/page.tsx` | 93 | `appNow` (from getAppNow) | Passed as `anchorNow` parameter |
| **Home: deadlineDate calculation** | `src/app/page.tsx` | 131,137,141 | `appNow` | Used for date arithmetic |
| **Items Page** | `src/app/items/page.tsx` | 45 | `new Date()` | ⚠️ Still uses browser time, not AppNow |
| **Items: calcServiceStatus** | `src/app/items/page.tsx` | 55-61 | `now` (from new Date()) | ⚠️ Not using AppNow |
| **Items: estimateDailyKmRate** | `src/app/items/page.tsx` | 49 | N/A | Uses default (newestEntry date) - ⚠️ Not using AppNow |
| **History Page** | `src/app/history/page.tsx` | 8-73 | N/A | No time calculations, only displays entries |
| **AddMileageForm (TEST)** | `src/app/components/AddMileageForm.tsx` | 33,76 | `getAppNow()` | Client component - reads from localStorage |
| **AddMileageForm (LIVE)** | `src/app/components/AddMileageForm.tsx` | 38,78 | `new Date()` | Uses browser time |
| **AddMileageForm: advance after submit** | `src/app/components/AddMileageForm.tsx` | 94-97 | `getAppNow()` + `setAppNow()` | TEST mode only |
| **simulateTripRange (TEST)** | `src/lib/actions/devActions.ts` | 328-336 | `baseNowIso` (from client) | Server action - receives AppNow ISO from client |
| **simulateTripRange (LIVE/legacy)** | `src/lib/actions/devActions.ts` | 336 | `new Date(baseEntry.occurred_at)` | Backward compatible fallback |
| **calcServiceStatus** | `src/lib/service/calcServiceStatus.ts` | 63 | `now = new Date()` (default) | ⚠️ Default parameter, can be overridden |
| **calcServiceStatus: lastServiceDate** | `src/lib/service/calcServiceStatus.ts` | 95,175 | `new Date(lastEvent.occurred_at)` | Parsing DB timestamp |
| **estimateDailyKmRateUnified** | `src/lib/service/odometerForecast.ts` | 33-34 | `anchorNow` (required param) | Always requires anchorNow (no default) |
| **computeConfidence** | `src/lib/prediction/dailyRate.ts` | 90-92 | `new Date()` | ⚠️ Uses real time, not AppNow |
| **computeDailyRate** | `src/lib/prediction/dailyRate.ts` | 21-22 | `new Date()` | ⚠️ Uses real time, not AppNow |
| **getDaysSinceLastEntry** | `src/lib/prediction/dailyRate.ts` | 74-75 | `new Date()` | ⚠️ Uses real time, not AppNow |

**Legend:**
- ✅ Uses AppNow correctly
- ⚠️ Uses `new Date()` (real time) instead of AppNow
- N/A No time calculations

---

## 5. Server vs Client Reality Check

### 5.1. Server Components (Cannot Access localStorage)

**Files:**
- `src/app/page.tsx:37` - `export default async function Home()` - **Server component**
- `src/app/items/page.tsx:15` - `export default async function ItemsPage()` - **Server component**
- `src/app/history/page.tsx:8` - `export default async function HistoryPage()` - **Server component**

**Impact:**
- `getAppMode()` returns `AppMode.LIVE` on server (line 38 in `appMode.ts`)
- `getAppNow()` returns `new Date()` on server in TEST mode (line 47 in `appNow.ts`)
- Cannot read `localStorage` on server

**Current Workarounds:**

1. **Home Page (server):**
   - Calls `getAppNow()` on server (line 85) - ⚠️ Returns real time even in TEST mode
   - Passes `appNow` to `estimateDailyKmRateUnified()` (line 93) - ⚠️ Uses real time on server
   - Passes `appNow` to `calcServiceStatus()` (line 111) - ⚠️ Uses real time on server

2. **simulateTripRange (server action):**
   - Receives `baseNowIso?: string` parameter from client (line 305 in `devActions.ts`)
   - Client passes `getAppNow().toISOString()` (line 133 in `DevToolsPanel.tsx`)
   - **Workaround:** Client reads AppNow and passes ISO string to server

3. **Items Page (server):**
   - Uses `new Date()` directly (line 45) - ⚠️ No AppNow usage
   - No workaround implemented

### 5.2. Client Components (Can Access localStorage)

**Files:**
- `src/app/components/DevToolsPanel.tsx` - Client component (`'use client'`)
- `src/app/components/AddMileageForm.tsx` - Client component (`'use client'`)
- `src/app/components/HomeSoonMaintenanceBlock.tsx` - Client component (`'use client'`)

**Behavior:**
- Can read/write `localStorage` directly
- `getAppMode()` and `getAppNow()` work correctly on client

### 5.3. Server Actions

**Files:**
- `src/lib/actions/devActions.ts` - `'use server'` (line 1)
- `src/lib/actions/odometerActions.ts` - `'use server'` (line 1)

**Impact:**
- Cannot access `localStorage`
- Must receive AppNow from client if needed (e.g., `baseNowIso` parameter)

---

## 6. Known Mismatches vs Target Spec

**Target Spec:** `docs/app-mode-and-time-target-spec.md`

### Mismatch 1: Items Page Uses new Date()

**Current:** `src/app/items/page.tsx:45` - Uses `new Date()`  
**Target:** Spec 2.3 - "All calculations that need 'current time' MUST use AppNow"  
**Severity:** P0  
**Evidence:** Items page not migrated to AppNow

### Mismatch 2: Server Components Cannot Read AppNow

**Current:** `src/app/page.tsx:85` - Calls `getAppNow()` on server, returns real time  
**Target:** Spec 2.1 - "AppNow MUST be accessible via a single function"  
**Severity:** P0  
**Evidence:** Server-side `getAppNow()` returns `new Date()` even in TEST mode (line 47 in `appNow.ts`)

### Mismatch 3: computeConfidence Uses Real Time

**Current:** `src/lib/prediction/dailyRate.ts:90-92` - Uses `new Date()`  
**Target:** Spec 2.3 - "All calculations that need 'current time' MUST use AppNow"  
**Severity:** P1  
**Evidence:** Confidence calculation not using AppNow

### Mismatch 4: computeDailyRate Uses Real Time

**Current:** `src/lib/prediction/dailyRate.ts:21-22` - Uses `new Date()`  
**Target:** Spec 2.3 - "All calculations that need 'current time' MUST use AppNow"  
**Severity:** P1  
**Evidence:** Daily rate calculation not using AppNow (note: `estimateDailyKmRateUnified` is used instead on Home)

### Mismatch 5: Manual Entry Default in TEST Mode

**Current:** `src/app/components/AddMileageForm.tsx:33` - Uses AppNow in TEST mode ✅  
**Target:** Spec 3.1 - "Default `occurred_at` SHOULD be AppNow (not real time)" (TEST)  
**Status:** ✅ **COMPLIANT** - Already implemented

### Mismatch 6: Simulation Advances AppNow

**Current:** `src/app/components/DevToolsPanel.tsx:138` - Advances AppNow after simulation ✅  
**Target:** Spec 4.2 - "Each simulated trip MUST advance AppNow by the specified time increment"  
**Status:** ✅ **COMPLIANT** - Already implemented

### Mismatch 7: Manual Entry Advances AppNow

**Current:** `src/app/components/AddMileageForm.tsx:97` - Advances AppNow after manual entry ✅  
**Target:** Spec 3.1 (implied) - Manual entries should advance AppNow in TEST mode  
**Status:** ✅ **COMPLIANT** - Already implemented (M1-2)

---

## 7. Risks / Edge Cases

### Risk 1: Hydration Mismatch

**Issue:** Server renders with `AppMode.LIVE` and `getAppNow() = real time`, but client may have `AppMode.TEST` and stored AppNow.

**Evidence:**
- `src/app/page.tsx:85` - Server calls `getAppNow()`, gets real time
- `src/lib/appNow.ts:45-47` - Server-side returns `new Date()`
- Client hydration may have different AppNow value

**Impact:** Initial server render may show incorrect data until client hydration completes.

### Risk 2: Test Mode on Server

**Issue:** Server components cannot detect TEST mode, so they always use real time.

**Evidence:**
- `src/lib/appMode.ts:36-38` - Server returns `AppMode.LIVE`
- `src/lib/appNow.ts:45-47` - Server returns `new Date()` in TEST mode
- `src/app/page.tsx:85` - Server component calls `getAppNow()`

**Impact:** Home page calculations use real time on server even when client is in TEST mode.

**Current Mitigation:** None - server always uses real time.

### Risk 3: Future Entries Relative to AppNow

**Issue:** Simulated entries may be dated in the future relative to AppNow if AppNow is not advanced.

**Evidence:**
- `src/lib/service/odometerForecast.ts:56-59` - Filters entries with `entryDate <= anchorNow`
- `src/lib/actions/devActions.ts:328-336` - Uses `baseNowIso` if provided, else uses entry date

**Impact:** Future entries are excluded from window calculations, causing fallback to 30 km/day.

**Current Mitigation:** `estimateDailyKmRateUnified` excludes future entries (correct behavior).

### Risk 4: Mixing Manual + Simulated Entries

**Issue:** Manual entries use AppNow, simulated entries may use different base date if AppNow not advanced.

**Evidence:**
- `src/app/components/AddMileageForm.tsx:76` - Manual entry uses `getAppNow()`
- `src/lib/actions/devActions.ts:328` - Simulation uses `baseNowIso` (AppNow) if provided
- `src/app/components/AddMileageForm.tsx:97` - Manual entry advances AppNow

**Impact:** If AppNow is not advanced after simulation, subsequent manual entries may have timestamps before simulated entries.

**Current Mitigation:** Manual entries advance AppNow (M1-2), simulations advance AppNow (M2-A).

### Risk 5: Production Safety

**Issue:** DevToolsPanel is dev-only, but if accidentally exposed, mode toggle could affect production.

**Evidence:**
- `src/app/components/DevToolsPanel.tsx` - No explicit production guard (relies on Next.js env)
- `src/lib/appMode.ts:34-53` - `getAppMode()` works in production (defaults to LIVE)

**Impact:** Low - defaults to LIVE mode, but mode could be set if DevToolsPanel exposed.

**Current Mitigation:** DevToolsPanel only visible in dev builds (Next.js environment check).

---

## 8. Call-Chain Diagrams

### Diagram A: AddMileageForm in TEST vs LIVE

```
TEST Mode Flow:
─────────────────────────────────────────────────────────────
User clicks "Добавить пробег"
  │
  ├─> AddMileageForm opens (client)
  │   ├─> getAppMode() → AppMode.TEST (localStorage)
  │   ├─> getAppNow() → stored AppNow (localStorage)
  │   └─> setOccurredAt(appNow.toISOString()) ✅
  │
  ├─> User enters mileage, submits
  │   ├─> isTestMode() → true
  │   ├─> submissionOccurredAt = getAppNow() ✅
  │   └─> addOdometerEntry({ occurredAt: submissionOccurredAt })
  │       │
  │       └─> Server action (cannot read localStorage)
  │           └─> Receives Date object from client ✅
  │
  └─> After success (client)
      ├─> insertedEntry.occurred_at
      ├─> newAppNow = max(AppNow, inserted.occurred_at) + 1min
      └─> setAppNow(newAppNow) ✅

LIVE Mode Flow:
─────────────────────────────────────────────────────────────
User clicks "Добавить пробег"
  │
  ├─> AddMileageForm opens (client)
  │   ├─> getAppMode() → AppMode.LIVE (localStorage or default)
  │   └─> setOccurredAt(new Date().toISOString()) ⚠️
  │
  ├─> User enters mileage, submits
  │   ├─> isTestMode() → false
  │   ├─> submissionOccurredAt = new Date(occurredAt) ⚠️
  │   └─> addOdometerEntry({ occurredAt: submissionOccurredAt })
  │       │
  │       └─> Server action
  │           └─> Receives Date object from client ⚠️
  │
  └─> After success (client)
      └─> No AppNow advancement (LIVE mode)
```

**File References:**
- `src/app/components/AddMileageForm.tsx:28-39` - Mode detection and initial date
- `src/app/components/AddMileageForm.tsx:75-79` - Submission date selection
- `src/app/components/AddMileageForm.tsx:92-100` - AppNow advancement (TEST only)

### Diagram B: simulateTripRange in TEST vs LIVE

```
TEST Mode Flow:
─────────────────────────────────────────────────────────────
User clicks "Поездил неделю" (DevToolsPanel)
  │
  ├─> handleSimulate('week') (client)
  │   ├─> isTestMode() → true
  │   ├─> baseNowIso = getAppNow().toISOString() ✅
  │   └─> simulateTripRange('week', baseNowIso)
  │       │
  │       └─> Server action (cannot read localStorage)
  │           ├─> Receives baseNowIso parameter ✅
  │           ├─> baseDate = new Date(baseNowIso) ✅
  │           ├─> nextDate = baseDate + 7 days ✅
  │           ├─> Inserts entry with occurred_at = nextDate ✅
  │           └─> Returns { newAppNowIso: inserted.occurred_at } ✅
  │
  └─> After success (client)
      ├─> setAppNow(result.newAppNowIso) ✅
      └─> Test Clock UI updates ✅

LIVE Mode Flow:
─────────────────────────────────────────────────────────────
User clicks "Поездил неделю" (DevToolsPanel)
  │
  ├─> handleSimulate('week') (client)
  │   ├─> isTestMode() → false
  │   └─> Early return with error message ⚠️
  │       "Симуляция доступна только в режиме тестирования"
  │
  └─> Simulation blocked (buttons hidden in UI)
```

**File References:**
- `src/app/components/DevToolsPanel.tsx:122-144` - Simulation handler
- `src/app/components/DevToolsPanel.tsx:133` - AppNow passed to server
- `src/lib/actions/devActions.ts:303-306` - Server action signature
- `src/lib/actions/devActions.ts:328-336` - baseNowIso handling

---

## 9. Summary

### AppMode Coverage

**✅ Implemented:**
- Storage in localStorage
- Toggle UI in DevToolsPanel
- Gating of Test Clock and simulation buttons
- Usage in AddMileageForm for conditional behavior

**⚠️ Limitations:**
- Server components cannot detect TEST mode (always return LIVE)
- No server-side mode detection

### AppNow Coverage

**✅ Implemented:**
- Storage in localStorage (TEST mode)
- Home page uses AppNow for calculations
- AddMileageForm uses AppNow in TEST mode
- Simulation uses AppNow via `baseNowIso` parameter
- Manual entry advances AppNow in TEST mode

**⚠️ Limitations:**
- Server components cannot read AppNow (return real time)
- Items page still uses `new Date()`
- `computeConfidence` and `computeDailyRate` use real time
- Server-side `getAppNow()` returns real time even in TEST mode

### Server vs Client Reality

**Server Components:**
- Cannot access localStorage
- Always see `AppMode.LIVE` and real time
- Must receive AppNow from client if needed (workaround: `baseNowIso` parameter)

**Client Components:**
- Can access localStorage
- Correctly read AppMode and AppNow
- Pass AppNow to server actions when needed

---

**End of Audit**

