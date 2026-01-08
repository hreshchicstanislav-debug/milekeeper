# App Mode and Time Target Specification

**Date:** 2025-01-02  
**Type:** Target Behavior Specification  
**Goal:** Define how the system SHOULD behave for testing and real usage  
**Scope:** App modes, canonical time, mileage entry flows, forecasting, and transitions

**Note:** This document describes **desired behavior**, not current implementation. It serves as a target for future development.

---

## 1. App Modes: Definitions and Intent

### 1.1. Mode Definitions

**TEST Mode:**
- **Purpose:** Development, testing, and demonstration
- **Intent:** Allow developers and testers to simulate time progression and mileage accumulation without waiting for real-world time to pass
- **Characteristics:**
  - App time can be advanced independently of real time
  - Simulated trips create entries that advance app time
  - Manual entries can use any date/time (past, present, or future relative to app time)
  - All entries are marked with their source (manual vs simulated)

**LIVE Mode:**
- **Purpose:** Real-world usage by end users
- **Intent:** Track actual vehicle mileage with real timestamps
- **Characteristics:**
  - App time is always synchronized with real time
  - Only manual entries are allowed (no simulation)
  - Manual entries must use real current time or past dates (future dates not allowed)
  - All entries are from real user input

### 1.2. Mode Selection

**MUST:**
- System MUST operate in exactly one mode at a time
- Mode MUST be persistent across sessions (stored in user preferences or configuration)
- Mode MUST be clearly indicated to the user in the UI

**SHOULD:**
- Mode selection SHOULD be available only to developers/testers (not visible to end users in production)
- Mode transition SHOULD require explicit user confirmation when switching from LIVE to TEST

### 1.3. Mode Intent

**TEST Mode Intent:**
- Enable rapid testing of service item calculations
- Allow simulation of long time periods (weeks, months) in minutes
- Support demonstration of app features with realistic data
- Enable testing of edge cases (future dates, sparse entries, etc.)

**LIVE Mode Intent:**
- Provide accurate tracking of real vehicle maintenance
- Ensure all timestamps reflect actual events
- Prevent accidental time manipulation
- Maintain data integrity for real-world decisions

---

## 2. Canonical App Time (AppNow)

### 2.1. Definition

**AppNow:** The canonical "current time" used by the application for all calculations, forecasting, and status determinations.

**MUST:**
- AppNow MUST be a single, consistent time value used throughout the application
- AppNow MUST be accessible via a single function or mechanism (e.g., `getAppNow()`)
- All calculations that need "current time" MUST use AppNow, not `new Date()` directly

**Implementation Status:**
- ✅ `getAppNow()` function exists (`src/lib/appNow.ts`)
- ✅ Home page uses `getAppNow()` for all time-based calculations (M2-B)
- ✅ `estimateDailyKmRate` accepts optional `anchorNow` parameter for AppNow-based window anchoring (M2-B)
- ⏳ Items page still uses `new Date()` (pending migration)

**Implementation Status:**
- ✅ `getAppNow()` function exists (`src/lib/appNow.ts`)
- ✅ Home page uses `getAppNow()` for all time-based calculations (M2-B)
- ⏳ Items page still uses `new Date()` (pending migration)

### 2.2. Source Rules

**In TEST Mode:**
- AppNow MUST be stored separately from real time (e.g., in localStorage or app state)
- AppNow MUST advance when simulated trips are created
- AppNow MUST be manually adjustable by developers/testers
- AppNow MAY be in the past, present, or future relative to real time
- AppNow MUST persist across page reloads and app restarts

**In LIVE Mode:**
- AppNow MUST always equal real current time (`new Date()`)
- AppNow MUST NOT be adjustable by users
- AppNow MUST NOT be stored separately (always computed from real time)

### 2.3. Usage Rules

**MUST:**
- All status calculations MUST use AppNow as the reference time
- All forecasting windows MUST be anchored relative to AppNow
- All "days since" calculations MUST use AppNow
- All "days until" predictions MUST use AppNow

**MUST NOT:**
- Calculations MUST NOT use `new Date()` directly when AppNow is available
- Calculations MUST NOT use entry dates as time anchors when AppNow should be used
- Different parts of the application MUST NOT use different time sources

### 2.4. Display Rules

**SHOULD:**
- AppNow SHOULD be displayed to users in TEST mode (for debugging/awareness)
- AppNow SHOULD NOT be displayed to users in LIVE mode (always matches real time)
- When AppNow differs from real time, the difference SHOULD be clearly indicated

---

## 3. Manual Mileage Entry: Expected Behavior

### 3.1. In TEST Mode

**MUST:**
- User MUST be able to set `occurred_at` to any date/time (past, present, or future)
- Default `occurred_at` SHOULD be AppNow (not real time)
- User MUST be able to enter mileage values that are strictly greater than previous maximum
- Entry MUST be marked with source = "manual"

**SHOULD:**
- UI SHOULD indicate that dates can be set to any value
- UI SHOULD show AppNow as the default date suggestion
- UI SHOULD allow easy selection of AppNow as the entry date

**MUST NOT:**
- System MUST NOT restrict `occurred_at` to real time constraints
- System MUST NOT prevent future dates

### 3.2. In LIVE Mode

**MUST:**
- Default `occurred_at` MUST be real current time
- User MUST be able to set `occurred_at` to past dates (for backdating entries)
- User MUST NOT be able to set `occurred_at` to future dates
- Entry MUST be marked with source = "manual"
- System MUST validate that `occurred_at` is not in the future

**SHOULD:**
- UI SHOULD default to current real time
- UI SHOULD allow easy backdating (common use case: entering yesterday's mileage today)
- UI SHOULD prevent future date selection (disable or hide future dates in date picker)

**MUST NOT:**
- System MUST NOT allow future dates
- System MUST NOT use AppNow (always uses real time)

### 3.3. Validation Rules (Both Modes)

**MUST:**
- Mileage MUST be strictly greater than previous maximum mileage
- Mileage MUST be a positive integer
- `occurred_at` MUST be a valid timestamp

**SHOULD:**
- System SHOULD provide clear error messages when validation fails
- System SHOULD suggest the minimum valid mileage value

---

## 4. Simulated Trips: Expected Behavior

### 4.1. Availability

**MUST:**
- Simulated trips MUST be available only in TEST mode
- Simulated trips MUST NOT be available in LIVE mode
- UI for simulated trips MUST be hidden or disabled in LIVE mode

### 4.2. Time Advancement

**MUST:**
- Each simulated trip MUST advance AppNow by the specified time increment (1 day, 7 days, 30 days)
- AppNow advancement MUST happen atomically with entry creation
- AppNow MUST NOT advance beyond the simulated entry's `occurred_at` date

**SHOULD:**
- Simulated trips SHOULD create entries with `occurred_at` equal to the new AppNow value
- If AppNow is in the future, simulated trips SHOULD continue advancing from that future date

### 4.3. Mileage Calculation

**MUST:**
- Simulated mileage increment MUST be calculated based on the time range (day/week/month)
- Mileage increment MUST be realistic but variable (not fixed)
- New mileage MUST be strictly greater than previous maximum

**SHOULD:**
- Mileage increments SHOULD be randomized within reasonable ranges
- Ranges SHOULD reflect typical driving patterns (e.g., 60-150 km/day, 420-680 km/week)

### 4.4. Entry Marking

**MUST:**
- Simulated entries MUST be marked with source = "simulated"
- Simulated entries MUST be distinguishable from manual entries in the database
- Simulated entries MUST be filterable/queriesable by source

**SHOULD:**
- Simulated entries SHOULD include metadata about the simulation (range, increment, etc.)
- Simulated entries SHOULD be visually distinct in History page (optional, but recommended)

### 4.5. Relationship to Manual Entries

**MUST:**
- Manual entries MUST be allowed in TEST mode alongside simulated entries
- Manual entries MUST NOT advance AppNow (only simulated trips advance AppNow)
- If a manual entry has `occurred_at` in the future relative to AppNow, AppNow MUST NOT change
- If a manual entry has `occurred_at` in the past relative to AppNow, AppNow MUST NOT change

**SHOULD:**
- System SHOULD allow mixing manual and simulated entries
- System SHOULD handle cases where manual entries have dates that don't align with AppNow progression

---

## 5. History Page: Entry Display and Interpretation

### 5.1. Entry Display

**MUST:**
- History page MUST display all entries (manual and simulated) by default
- Entries MUST be sorted by `occurred_at` descending (newest first)
- Each entry MUST display: mileage, date/time, delta from previous entry, source indicator

**SHOULD:**
- History page SHOULD allow filtering by source (manual vs simulated)
- History page SHOULD allow filtering by date range
- Simulated entries SHOULD be visually distinct (e.g., different color, icon, or label)
- Source indicator SHOULD be clear and unambiguous

### 5.2. Source Indication

**MUST:**
- Each entry MUST clearly indicate its source (manual or simulated)
- Source indication MUST be visible without requiring user interaction
- Source indication MUST be consistent across all views (History, Home, Items)

**SHOULD:**
- Source indication SHOULD use clear labels (e.g., "Manual" or "Simulated")
- Source indication SHOULD use visual cues (icons, colors) in addition to text

### 5.3. User Interpretation

**MUST:**
- Users MUST be able to distinguish real entries from simulated entries
- Users MUST understand that simulated entries are for testing only
- Users in LIVE mode MUST NOT see simulated entries (they don't exist in LIVE mode)

**SHOULD:**
- UI SHOULD provide tooltips or help text explaining what simulated entries are
- UI SHOULD make it clear when viewing TEST mode data vs LIVE mode data

---

## 6. Forecasting Windows (14/60 Days): Behavior Relative to AppNow

### 6.1. Window Anchor

**MUST:**
- All forecasting windows MUST be anchored relative to AppNow, not entry dates
- 14-day window MUST be: `[AppNow - 14 days, AppNow]`
- 60-day window MUST be: `[AppNow - 60 days, AppNow]`
- Windows MUST NOT be anchored to newest entry's date

**SHOULD:**
- Window calculations SHOULD use AppNow consistently across all forecasting functions
- Window boundaries SHOULD be clearly defined and documented

### 6.2. Entry Selection

**MUST:**
- Forecasting functions MUST select entries within the time window relative to AppNow
- Entries with `occurred_at` outside the window MUST be excluded
- Entry selection MUST be independent of entry source (manual vs simulated)

**SHOULD:**
- Forecasting functions SHOULD use all entries within the window (up to reasonable limits)
- Forecasting functions SHOULD handle sparse entry histories gracefully

### 6.3. Behavior in TEST Mode

**MUST:**
- When AppNow is in the future, windows MUST extend into the future
- When AppNow is in the past, windows MUST extend into the past
- Forecasting MUST work correctly regardless of AppNow's relationship to real time

**SHOULD:**
- System SHOULD handle edge cases (e.g., AppNow far in future, no entries in window)
- System SHOULD provide fallback values when windows are empty

### 6.4. Behavior in LIVE Mode

**MUST:**
- Windows MUST be anchored to real current time (AppNow = real time)
- Windows MUST only include past entries (no future entries in LIVE mode)
- Forecasting MUST reflect actual driving patterns from recent history

**SHOULD:**
- System SHOULD adapt to sparse entry histories
- System SHOULD provide confidence indicators when data is limited

### 6.5. Fallback Behavior

**MUST:**
- When insufficient entries exist in the window, system MUST use fallback daily rate
- Fallback daily rate MUST be reasonable (e.g., 30 km/day)
- Fallback MUST be clearly indicated to users (e.g., "estimated" or "fallback" label)

**SHOULD:**
- System SHOULD indicate when fallback is being used
- System SHOULD explain why fallback is needed (e.g., "insufficient recent entries")

---

## 7. Transition Rules: Switching Modes and Wiping Data

### 7.1. Switching from LIVE to TEST

**MUST:**
- System MUST initialize AppNow to real current time when entering TEST mode
- System MUST preserve all existing entries (manual entries remain)
- System MUST allow creation of simulated entries
- System MUST allow manual entries with any date/time

**SHOULD:**
- System SHOULD warn user that TEST mode allows time manipulation
- System SHOULD explain that simulated entries will be created
- System SHOULD provide option to start with clean data (wipe) or keep existing data

### 7.2. Switching from TEST to LIVE

**MUST:**
- System MUST remove all simulated entries (entries with source = "simulated")
- System MUST keep all manual entries
- System MUST validate that remaining manual entries have valid dates (no future dates)
- System MUST set AppNow to real current time (AppNow becomes read-only)

**SHOULD:**
- System SHOULD warn user that simulated entries will be deleted
- System SHOULD require user confirmation before deleting simulated entries
- System SHOULD validate data integrity after transition (e.g., no future dates, monotonic mileage)

**MUST NOT:**
- System MUST NOT allow transition if manual entries have future dates
- System MUST NOT allow transition if data integrity would be violated

### 7.3. Wiping All Data

**MUST:**
- Wipe operation MUST delete all entries (manual and simulated)
- Wipe operation MUST reset AppNow to real current time
- Wipe operation MUST reset all service items and service events
- Wipe operation MUST require explicit user confirmation

**SHOULD:**
- Wipe operation SHOULD be available only in TEST mode (or with special developer access)
- Wipe operation SHOULD provide clear warning about data loss
- Wipe operation SHOULD be irreversible (no undo)

**MUST NOT:**
- Wipe operation MUST NOT be available to regular users in LIVE mode
- Wipe operation MUST NOT proceed without explicit confirmation

### 7.4. Data Integrity After Transitions

**MUST:**
- After any transition, system MUST validate data integrity:
  - Mileage monotonicity
  - Date validity (no future dates in LIVE mode)
  - Service event consistency
- System MUST NOT allow transitions that would violate integrity constraints

**SHOULD:**
- System SHOULD provide clear error messages if transition would violate integrity
- System SHOULD suggest fixes (e.g., "remove entries with future dates")

---

## 8. Non-Goals and Explicit Exclusions

### 8.1. Multi-User Support (Future)

**Explicitly Out of Scope (for now):**
- User authentication and authorization
- Per-user data isolation
- Shared data between users
- User-specific app modes

**Note:** Specification assumes single-user operation today, but data structures SHOULD be designed to support multi-user in the future without breaking changes.

### 8.2. Time Travel for Manual Entries

**Explicitly Out of Scope:**
- Manual entries MUST NOT affect AppNow in TEST mode
- AppNow advancement MUST be controlled only by simulated trips
- Manual entries with past dates MUST NOT rewind AppNow
- Manual entries with future dates MUST NOT fast-forward AppNow

**Rationale:** AppNow represents simulated time progression. Manual entries represent user-recorded events at specific times, independent of AppNow.

### 8.3. Automatic Time Synchronization

**Explicitly Out of Scope:**
- System MUST NOT automatically sync AppNow with real time in TEST mode
- System MUST NOT automatically sync AppNow with entry dates
- AppNow advancement MUST be explicit and user-controlled

**Rationale:** TEST mode requires explicit control over time progression for testing scenarios.

### 8.4. Historical Data Migration

**Explicitly Out of Scope:**
- Converting existing entries to new source-based system
- Backfilling source information for legacy entries
- Migrating from note-based to source-column distinction

**Note:** This specification assumes a clean implementation with source column from the start. Migration strategies are out of scope.

### 8.5. Timezone Handling

**Explicitly Out of Scope (for this spec):**
- Detailed timezone conversion rules
- Timezone-aware date pickers
- Timezone display preferences
- Daylight saving time handling

**Note:** Timezone handling is important but is a separate concern from app modes and AppNow. It should be addressed in a separate specification.

### 8.6. Offline Mode

**Explicitly Out of Scope:**
- AppNow synchronization across devices
- Offline AppNow storage
- Conflict resolution for AppNow updates

**Note:** This specification assumes online operation. Offline mode considerations are out of scope.

### 8.7. Performance Optimization

**Explicitly Out of Scope:**
- Caching strategies for AppNow
- Query optimization for source filtering
- Indexing strategies for time-based queries

**Note:** Performance is important but is an implementation detail, not a behavioral specification.

---

## Summary

### Core Principles

1. **Single Source of Truth:** AppNow is the canonical time used throughout the application
2. **Mode Separation:** TEST and LIVE modes have distinct behaviors and constraints
3. **Source Tracking:** All entries must be marked with their source (manual vs simulated)
4. **Time Anchoring:** All forecasting windows are anchored to AppNow, not entry dates
5. **Data Integrity:** Transitions between modes must preserve or enforce data integrity

### Key Behaviors

- **TEST Mode:** AppNow is adjustable, simulated trips advance AppNow, manual entries can have any date
- **LIVE Mode:** AppNow equals real time, only manual entries allowed, no future dates
- **Forecasting:** Windows anchored to AppNow, consistent across all functions
- **Transitions:** Simulated entries removed when switching to LIVE, data validated after transition

---

**Document Status:** Target specification for future implementation. Defines desired behavior, not current state.

