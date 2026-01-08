# App Mode and Time Gap Analysis

**Date:** 2025-01-02  
**Type:** Gap Analysis Document  
**Goal:** Identify precise gaps between current implementation and target specification  
**Scope:** AppNow, TEST/LIVE modes, manual entries, simulation, history, forecasting, and transitions

**Input Documents:**
- Current Implementation: `docs/app-mode-and-time-audit-current-v2.md`
- Target Specification: `docs/app-mode-and-time-target-spec.md`

---

## 1. Executive Summary

**What prevents the target behavior today:**

1. **No AppNow mechanism:** All calculations use `new Date()` directly instead of canonical AppNow
2. **No mode system:** System operates in single mode (no TEST/LIVE distinction)
3. **No source column:** Entries distinguished by note prefix, not database column
4. **No AppNow storage:** No persistent test clock or dev time state
5. **No mode persistence:** No way to store or retrieve current mode
6. **No mode switching:** No UI or logic for transitioning between modes
7. **No future date validation:** Manual entries can have future dates in all contexts
8. **Simulation doesn't advance AppNow:** Simulated trips advance entry dates but not AppNow
9. **Forecast windows use entry dates:** Windows anchored to newest entry, not AppNow
10. **History shows all entries:** No source indication or filtering capabilities

---

## 2. Gap Table

| ID | Area | Current (Evidence) | Target Requirement (Spec Section) | Severity | User Impact |
|----|------|-------------------|-----------------------------------|----------|-------------|
| GAP-001 | AppNow | No `getAppNow()` function exists | 2.1: "AppNow MUST be accessible via a single function" | P0 | All calculations use inconsistent time sources |
| GAP-002 | AppNow | All calculations use `new Date()` directly | 2.3: "All calculations MUST use AppNow, not `new Date()` directly" | P0 | Time sources diverge, windows incorrect |
| GAP-003 | AppNow | No AppNow storage mechanism | 2.2: "AppNow MUST be stored separately from real time" (TEST mode) | P0 | Cannot persist test time across sessions |
| GAP-004 | Modes | No mode system exists | 1.2: "System MUST operate in exactly one mode at a time" | P0 | Cannot distinguish TEST vs LIVE behavior |
| GAP-005 | Modes | No mode persistence | 1.2: "Mode MUST be persistent across sessions" | P0 | Mode resets on every page load |
| GAP-006 | Modes | No mode indication in UI | 1.2: "Mode MUST be clearly indicated to the user in the UI" | P1 | Users cannot see current mode |
| GAP-007 | Source | No `source` column in database | 4.4: "Simulated entries MUST be marked with source = 'simulated'" | P0 | Cannot distinguish entries programmatically |
| GAP-008 | Source | No `source` field in TypeScript types | 4.4: "Simulated entries MUST be distinguishable from manual entries" | P0 | Type system doesn't support source |
| GAP-009 | Source | Queries cannot filter by source | 4.4: "Simulated entries MUST be filterable/queriesable by source" | P1 | Cannot exclude simulated entries from queries |
| GAP-010 | Manual Entry | Default uses real time, not AppNow | 3.1: "Default `occurred_at` SHOULD be AppNow (not real time)" (TEST) | P1 | TEST mode defaults incorrect |
| GAP-011 | Manual Entry | No future date validation | 3.2: "User MUST NOT be able to set `occurred_at` to future dates" (LIVE) | P1 | LIVE mode allows invalid future dates |
| GAP-012 | Manual Entry | No source marking on insert | 3.1/3.2: "Entry MUST be marked with source = 'manual'" | P0 | Manual entries not marked with source |
| GAP-013 | Simulation | Available in all contexts | 4.1: "Simulated trips MUST be available only in TEST mode" | P0 | Simulation available when it shouldn't be |
| GAP-014 | Simulation | Doesn't advance AppNow | 4.2: "Each simulated trip MUST advance AppNow by the specified time increment" | P0 | Time doesn't advance with simulation |
| GAP-015 | Simulation | Uses note prefix, not source column | 4.4: "Simulated entries MUST be marked with source = 'simulated'" | P0 | Simulation entries not properly marked |
| GAP-016 | History | No source indication | 5.2: "Each entry MUST clearly indicate its source (manual or simulated)" | P1 | Users cannot distinguish entry types |
| GAP-017 | History | No filtering by source | 5.1: "History page SHOULD allow filtering by source (manual vs simulated)" | P2 | Cannot filter simulated entries |
| GAP-018 | Forecast | Window anchored to entry date | 6.1: "All forecasting windows MUST be anchored relative to AppNow, not entry dates" | P0 | Windows use wrong anchor, incorrect calculations |
| GAP-019 | Forecast | `estimateDailyKmRate` uses entry date | 6.1: "Windows MUST NOT be anchored to newest entry's date" | P0 | Primary forecast function violates spec |
| GAP-020 | Forecast | `computeDailyRate` uses real time | 6.1: "All forecasting windows MUST be anchored relative to AppNow" | P1 | Unused function still violates spec |
| GAP-021 | Transition | No mode switching logic | 7.1/7.2: "Switching from LIVE to TEST" / "Switching from TEST to LIVE" | P0 | Cannot transition between modes |
| GAP-022 | Transition | No simulated entry removal | 7.2: "System MUST remove all simulated entries" (TEST→LIVE) | P0 | Cannot clean up simulated entries |
| GAP-023 | Transition | No future date validation | 7.2: "System MUST validate that remaining manual entries have valid dates (no future dates)" | P1 | Transition doesn't validate data |
| GAP-024 | Wipe | Available in all contexts | 7.3: "Wipe operation SHOULD be available only in TEST mode" | P1 | Wipe available when it shouldn't be |
| GAP-025 | Wipe | Doesn't reset AppNow | 7.3: "Wipe operation MUST reset AppNow to real current time" | P0 | Wipe doesn't reset test time |

---

## 3. AppNow Gaps

### GAP-001: No getAppNow() Function

**Current:**
- No `getAppNow()` or equivalent function exists
- Evidence: `docs/app-mode-and-time-audit-current-v2.md:64-69` - "There is **NO** canonical `getAppNow()` or `getAppMode()` function"

**Target:**
- Spec 2.1: "AppNow MUST be accessible via a single function or mechanism (e.g., `getAppNow()`)"

**Severity:** P0  
**Impact:** Cannot centralize time source, all code uses `new Date()` directly

---

### GAP-002: Direct new Date() Usage

**Current:**
- Most calculations use `new Date()` directly:
  - ~~`src/app/page.tsx:82` - `const now = new Date();`~~ **RESOLVED (M2-B): Now uses `getAppNow()`**
  - `src/app/items/page.tsx:45` - `const now = new Date();` **PENDING (Items page not yet migrated)**
  - `src/lib/service/calcServiceStatus.ts:63` - `now = new Date()` (default) **PENDING (default parameter)**
  - `src/lib/prediction/dailyRate.ts:21` - `const now = new Date();` **PENDING (unused function)**
  - `src/lib/prediction/dailyRate.ts:90` - `const now = new Date();` **PENDING (unused function)**
  - `src/lib/prediction/dailyRate.ts:75` - `const now = new Date();` **PENDING (unused function)**

**Target:**
- Spec 2.3: "All calculations that need 'current time' MUST use AppNow, not `new Date()` directly"

**Severity:** P0  
**Impact:** Time sources diverge, cannot control time in TEST mode, calculations inconsistent

**Status:** **PARTIALLY RESOLVED** - Home page (M2-B) now uses `getAppNow()`. Items page and other functions still pending.

---

### GAP-003: No AppNow Storage

**Current:**
- No localStorage, sessionStorage, or other storage for AppNow
- Evidence: `docs/app-mode-and-time-audit-current-v2.md:269-271` - "No matches for `localStorage`, `sessionStorage`, `devNow`, `test.*clock`"

**Target:**
- Spec 2.2: "AppNow MUST be stored separately from real time (e.g., in localStorage or app state)" (TEST mode)
- Spec 2.2: "AppNow MUST persist across page reloads and app restarts" (TEST mode)

**Severity:** P0  
**Impact:** Cannot persist test time, AppNow resets on every page load in TEST mode

---

## 4. TEST/LIVE Mode Gaps

### GAP-004: No Mode System

**Current:**
- No mode concept exists in codebase
- No TEST/LIVE distinction
- Evidence: No grep matches for mode-related code

**Target:**
- Spec 1.2: "System MUST operate in exactly one mode at a time"
- Spec 1.1: Defines TEST and LIVE modes with distinct characteristics

**Severity:** P0  
**Impact:** Cannot implement mode-specific behavior, system always behaves the same way

---

### GAP-005: No Mode Persistence

**Current:**
- No storage mechanism for current mode
- No way to retrieve mode on page load

**Target:**
- Spec 1.2: "Mode MUST be persistent across sessions (stored in user preferences or configuration)"

**Severity:** P0  
**Impact:** Mode resets on every page load, cannot maintain mode state

---

### GAP-006: No Mode Indication in UI

**Current:**
- No UI elements showing current mode
- No visual indication of TEST vs LIVE

**Target:**
- Spec 1.2: "Mode MUST be clearly indicated to the user in the UI"

**Severity:** P1  
**Impact:** Users cannot see which mode they're in, may be confused about behavior

---

## 5. Manual Entry Gaps

### GAP-010: Default Uses Real Time, Not AppNow

**Current:**
- `src/app/components/AddMileageForm.tsx:13` - `new Date().toISOString().slice(0, 16)`
- Defaults to real browser time, not AppNow

**Target:**
- Spec 3.1: "Default `occurred_at` SHOULD be AppNow (not real time)" (TEST mode)
- Spec 3.2: "Default `occurred_at` MUST be real current time" (LIVE mode)

**Severity:** P1  
**Impact:** TEST mode defaults incorrect, doesn't use AppNow

---

### GAP-011: No Future Date Validation

**Current:**
- `src/app/components/AddMileageForm.tsx:155-162` - `datetime-local` input allows any date
- No validation prevents future dates
- Evidence: `docs/app-mode-and-time-audit-current-v2.md:488-492` - "No validation: No code prevents future dates"

**Target:**
- Spec 3.2: "User MUST NOT be able to set `occurred_at` to future dates" (LIVE mode)
- Spec 3.2: "System MUST validate that `occurred_at` is not in the future" (LIVE mode)

**Severity:** P1  
**Impact:** LIVE mode allows invalid future dates, violates data integrity

---

### GAP-012: No Source Marking on Insert

**Current:**
- `src/lib/actions/odometerActions.ts:207` - Inserts without source field
- No source column exists to mark entries

**Target:**
- Spec 3.1: "Entry MUST be marked with source = 'manual'" (TEST mode)
- Spec 3.2: "Entry MUST be marked with source = 'manual'" (LIVE mode)

**Severity:** P0  
**Impact:** Cannot distinguish manual entries from simulated entries

---

## 6. Simulation Gaps

### GAP-013: Available in All Contexts

**Current:**
- `src/app/components/DevToolsPanel.tsx` - Always visible (only hidden in production build)
- No mode-based availability check

**Target:**
- Spec 4.1: "Simulated trips MUST be available only in TEST mode"
- Spec 4.1: "UI for simulated trips MUST be hidden or disabled in LIVE mode"

**Severity:** P0  
**Impact:** Simulation available when it shouldn't be, violates mode separation

---

### GAP-014: Doesn't Advance AppNow

**Current:**
- `src/lib/actions/devActions.ts:352-354` - Advances entry date only
- No AppNow storage or advancement
- Evidence: `docs/app-mode-and-time-audit-current-v2.md:290-293` - "No test clock: Uses previous entry's `occurred_at` as baseline"

**Target:**
- Spec 4.2: "Each simulated trip MUST advance AppNow by the specified time increment (1 day, 7 days, 30 days)"
- Spec 4.2: "AppNow advancement MUST happen atomically with entry creation"

**Severity:** P0  
**Impact:** Time doesn't advance with simulation, AppNow concept not implemented

---

### GAP-015: Uses Note Prefix, Not Source Column

**Current:**
- `src/lib/actions/devActions.ts:334,340,346` - Uses note prefixes "DEV: simulate day/week/month"
- No source column to mark entries

**Target:**
- Spec 4.4: "Simulated entries MUST be marked with source = 'simulated'"
- Spec 4.4: "Simulated entries MUST be distinguishable from manual entries in the database"

**Severity:** P0  
**Impact:** Cannot distinguish simulated entries programmatically, relies on note parsing

---

## 7. History Gaps

### GAP-016: No Source Indication

**Current:**
- `src/app/history/page.tsx:35-65` - Renders entries without source indication
- No visual distinction between manual and simulated entries
- Evidence: `docs/app-mode-and-time-audit-current-v2.md:467` - "No visual distinction: Manual and dev-simulated entries look identical"

**Target:**
- Spec 5.2: "Each entry MUST clearly indicate its source (manual or simulated)"
- Spec 5.2: "Source indication MUST be visible without requiring user interaction"

**Severity:** P1  
**Impact:** Users cannot distinguish entry types, may confuse simulated entries with real data

---

### GAP-017: No Filtering by Source

**Current:**
- `src/app/history/page.tsx:9` - `listOdometerEntries(50)` with no filtering
- No UI for filtering by source
- Evidence: `docs/app-mode-and-time-audit-current-v2.md:473-475` - "No toggle UI elements", "No filter state or logic"

**Target:**
- Spec 5.1: "History page SHOULD allow filtering by source (manual vs simulated)"

**Severity:** P2  
**Impact:** Cannot filter simulated entries, all entries always visible

---

## 8. Forecast Window Gaps

### GAP-018: Window Anchored to Entry Date

**Current:**
- `src/lib/service/odometerForecast.ts:47-53` - Uses `newestEntry.occurred_at` as anchor
- Window: `[newestDate - 14 days, newestDate]`
- Evidence: `docs/app-mode-and-time-audit-current-v2.md:400-410` - "Anchor: `newestEntry.occurred_at` (newest entry's date)"

**Target:**
- Spec 6.1: "All forecasting windows MUST be anchored relative to AppNow, not entry dates"
- Spec 6.1: "Windows MUST NOT be anchored to newest entry's date"

**Severity:** P0  
**Impact:** Windows use wrong anchor, calculations incorrect when entries have future dates

---

### GAP-019: estimateDailyKmRate Uses Entry Date

**Current:**
- ~~`src/lib/service/odometerForecast.ts:48-53` - Primary forecast function uses entry date anchor~~ **RESOLVED (M2-B): Now accepts optional `anchorNow` parameter**
- ~~Used in: `src/app/page.tsx:90`~~ **RESOLVED: Home page now passes `appNow` as `anchorNow`**
- `src/app/items/page.tsx:49` **PENDING: Items page still uses default behavior (backward compatible)**

**Target:**
- Spec 6.1: "All forecasting windows MUST be anchored relative to AppNow, not entry dates"
- Spec 6.1: "14-day window MUST be: `[AppNow - 14 days, AppNow]`"

**Severity:** P0  
**Impact:** Primary forecast function violates spec, all status calculations affected

**Status:** **PARTIALLY RESOLVED (M2-B)** - `estimateDailyKmRate` now accepts optional `anchorNow` parameter. Home page passes `appNow`. Items page still uses default behavior (backward compatible, will be migrated in future step).

---

### GAP-020: computeDailyRate Uses Real Time

**Current:**
- `src/lib/prediction/dailyRate.ts:21-22` - Uses `new Date()` as anchor
- Window: `[now - 60 days, now]` where `now = new Date()`
- Note: Function is computed but not used

**Target:**
- Spec 6.1: "All forecasting windows MUST be anchored relative to AppNow"

**Severity:** P1  
**Impact:** Unused function still violates spec, would be incorrect if used

---

## 9. Risks if We Implement Modes Without Addressing Certain Gaps

### Risk 1: Inconsistent Time Sources

**Gap:** GAP-002 (Direct `new Date()` usage)

**Risk:** If modes are implemented but calculations still use `new Date()`, TEST mode will not work correctly. AppNow will exist but be ignored, leading to:
- Windows anchored to real time instead of AppNow
- Status calculations using wrong time reference
- Simulation advancing AppNow but calculations using real time

**Severity:** P0 - Blocks TEST mode functionality

---

### Risk 2: Data Integrity Violations

**Gap:** GAP-011 (No future date validation), GAP-023 (No transition validation)

**Risk:** If modes are implemented without validation:
- LIVE mode may contain future dates from previous TEST mode usage
- Transitions may leave invalid data (future dates, simulated entries)
- Service calculations may use invalid timestamps

**Severity:** P0 - Data corruption risk

---

### Risk 3: Source Confusion

**Gap:** GAP-007 (No source column), GAP-016 (No source indication)

**Risk:** If modes are implemented but source is not tracked:
- Cannot distinguish manual vs simulated entries
- Cannot filter simulated entries when switching to LIVE
- Users may confuse simulated entries with real data
- History page shows mixed data without distinction

**Severity:** P0 - Blocks mode transitions and data cleanup

---

### Risk 4: Window Calculation Errors

**Gap:** GAP-018 (Window anchored to entry date)

**Risk:** If modes are implemented but windows still use entry dates:
- TEST mode windows will be incorrect (should use AppNow)
- Future entries will create incorrect windows
- Calculations will diverge from spec requirements

**Severity:** P0 - Core functionality broken

---

### Risk 5: AppNow Not Persisted

**Gap:** GAP-003 (No AppNow storage)

**Risk:** If AppNow is implemented but not persisted:
- TEST mode time resets on every page load
- Simulation progress lost on refresh
- Cannot maintain test state across sessions

**Severity:** P0 - TEST mode unusable

---

## 10. Acceptance Checklist for Next Phase

**To claim "modes implemented", the following MUST be true:**

### AppNow Requirements

- [ ] `getAppNow()` function exists and is used by all calculations
- [ ] No direct `new Date()` usage in calculations (all use AppNow)
- [ ] AppNow is stored persistently in TEST mode (localStorage or equivalent)
- [ ] AppNow equals real time in LIVE mode
- [ ] AppNow persists across page reloads in TEST mode

### Mode System Requirements

- [ ] Mode system exists (TEST/LIVE modes defined)
- [ ] Current mode is stored persistently
- [ ] Mode is indicated in UI (visible to users)
- [ ] Mode selection/switching UI exists (for developers/testers)

### Source Tracking Requirements

- [ ] `source` column exists in database schema
- [ ] `source` field exists in TypeScript `OdometerEntry` interface
- [ ] Manual entries are marked with `source = 'manual'` on insert
- [ ] Simulated entries are marked with `source = 'simulated'` on insert
- [ ] Queries can filter by source

### Manual Entry Requirements

- [ ] Default `occurred_at` uses AppNow in TEST mode
- [ ] Default `occurred_at` uses real time in LIVE mode
- [ ] Future dates are prevented in LIVE mode (validation + UI)
- [ ] Past dates are allowed in both modes (for backdating)

### Simulation Requirements

- [ ] Simulation UI is hidden/disabled in LIVE mode
- [ ] Simulation advances AppNow when creating entries
- [ ] Simulated entries are marked with `source = 'simulated'`
- [ ] Simulation works correctly in TEST mode

### History Requirements

- [ ] Each entry displays source indication (manual/simulated)
- [ ] Source indication is visible without interaction
- [ ] Filtering by source is available (UI + query support)
- [ ] Simulated entries are visually distinct

### Forecast Requirements

- [ ] `estimateDailyKmRate()` uses AppNow as window anchor
- [ ] All forecast functions use AppNow consistently
- [ ] Windows are `[AppNow - N days, AppNow]`, not `[newestEntry - N days, newestEntry]`
- [ ] Windows work correctly in both TEST and LIVE modes

### Transition Requirements

- [ ] Mode switching logic exists (TEST ↔ LIVE)
- [ ] Switching to LIVE removes simulated entries
- [ ] Switching validates data integrity (no future dates, monotonic mileage)
- [ ] Switching initializes AppNow correctly (real time for LIVE, preserved for TEST)

### Wipe Requirements

- [ ] Wipe operation resets AppNow to real time
- [ ] Wipe is available only in TEST mode (or with special access)
- [ ] Wipe requires explicit confirmation

---

**Document Status:** Complete gap analysis. All gaps identified with evidence and target requirements. No solutions proposed.

