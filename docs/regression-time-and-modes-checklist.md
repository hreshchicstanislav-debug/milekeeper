# Regression Checklist: Time and App Modes

**Date:** 2025-01-02  
**Purpose:** Manual regression testing for timezone handling, AppMode (TEST/LIVE), and AppNow functionality  
**Scope:** Critical time-related features that must work correctly after any changes

**Note:** Database stores all timestamps in UTC. UI displays them in local timezone. This is expected behavior.

---

## Pre-Test Setup

1. **Clear browser data:**
   - Open DevTools → Application → Local Storage
   - Delete `milekeeper_app_mode` and `milekeeper_app_now_iso` keys
   - Refresh page

2. **Verify initial state:**
   - AppMode should default to LIVE
   - AppNow should equal real current time

---

## TEST Mode Regression Tests

### T1: Add Mileage in TEST Mode Uses AppNow

**Steps:**
1. Open DevToolsPanel (dev mode only)
2. Toggle "Режим тестирования" to ON (TEST mode)
3. Set Test Clock to `2026-06-15 14:30` (use datetime-local input)
4. Click "Добавить пробег" on Home
5. Enter mileage: `150000`
6. Submit form

**Expected Results:**
- ✅ Form shows "Дата (тестовое время): 15.06.2026, 14:30" (read-only, matches Test Clock)
- ✅ Date picker is hidden (not editable in TEST mode)
- ✅ After submit, entry appears in History with `15.06.2026 14:30` (local time display)
- ✅ Test Clock still shows `2026-06-15 14:30` (AppNow unchanged by manual entry)
- ✅ After successful submit, AppNow advances to `2026-06-15 14:31` (1 minute after entry)

**Failure Indicators:**
- ❌ Form shows different time than Test Clock
- ❌ Date picker is visible/editable
- ❌ History shows wrong time (timezone shift)
- ❌ AppNow doesn't advance after submit

---

### T2: Simulate Trip Advances AppNow

**Steps:**
1. Ensure TEST mode is ON
2. Set Test Clock to `2026-01-01 10:00`
3. Click "Поездил неделю" in DevToolsPanel
4. Wait for completion
5. Check Test Clock display

**Expected Results:**
- ✅ Test Clock shows `2026-01-08 10:00` (or similar, 7 days later)
- ✅ AppNow advanced automatically after simulation
- ✅ New entries appear in History dated from `2026-01-01` to `2026-01-08`
- ✅ Home "Скоро обслуживание" block updates based on new AppNow

**Failure Indicators:**
- ❌ Test Clock doesn't update after simulation
- ❌ AppNow remains at original time
- ❌ Home calculations don't reflect new AppNow

---

### T3: Manual Entry After Simulation

**Steps:**
1. Ensure TEST mode is ON
2. Set Test Clock to `2026-06-20 12:00`
3. Click "Поездил день" (simulate one day)
4. After simulation completes, click "Добавить пробег"
5. Enter mileage: `151000`
6. Submit

**Expected Results:**
- ✅ Form shows current AppNow time (after simulation, e.g., `2026-06-21 12:00`)
- ✅ Entry is created with AppNow timestamp
- ✅ AppNow advances by 1 minute after submit
- ✅ Timeline remains monotonic (no entries "in the future")

**Failure Indicators:**
- ❌ Form shows stale time (before simulation)
- ❌ Entry timestamp is before simulated entries
- ❌ AppNow doesn't advance

---

### T4: Home Uses AppNow for Calculations

**Steps:**
1. Ensure TEST mode is ON
2. Set Test Clock to `2027-01-15 00:00` (far future)
3. Ensure you have calendar-based service items (interval_days > 0)
4. Reload Home page
5. Check "Скоро обслуживание" block

**Expected Results:**
- ✅ Calendar-based items show correct `daysToReplace` relative to AppNow (2027-01-15)
- ✅ Items that would be overdue in real time are shown as overdue if AppNow is past their due date
- ✅ Daily rate calculation uses entries within `[AppNow-14d, AppNow]` window
- ✅ No entries dated after AppNow are used in calculations

**Failure Indicators:**
- ❌ Items show days based on real browser time instead of AppNow
- ❌ Future-dated entries affect daily rate calculation
- ❌ Home doesn't reflect TEST mode AppNow

---

### T5: Items Page Uses AppNow

**Steps:**
1. Ensure TEST mode is ON
2. Set Test Clock to `2027-01-15 00:00`
3. Navigate to Items page (`/items`)
4. Check service item statuses

**Expected Results:**
- ✅ All items show statuses calculated relative to AppNow (2027-01-15)
- ✅ Calendar-based items show correct days until replacement
- ✅ Daily rate uses AppNow-anchored window
- ✅ Prediction reliability is evaluated relative to AppNow

**Failure Indicators:**
- ❌ Items show statuses based on real browser time
- ❌ Daily rate calculation ignores AppNow
- ❌ Statuses don't match Home page (inconsistent AppNow usage)

---

## LIVE Mode Regression Tests

### L1: Add Mileage in LIVE Mode Uses Browser Time

**Steps:**
1. Ensure TEST mode is OFF (LIVE mode)
2. Note current browser time (e.g., `2025-01-02 15:30`)
3. Click "Добавить пробег" on Home
4. Click toggle to show date picker
5. Verify date/time shown
6. Enter mileage: `150000`
7. Submit

**Expected Results:**
- ✅ Date picker is visible and editable
- ✅ Date picker shows current browser time (local timezone)
- ✅ User can change date/time if needed
- ✅ After submit, entry appears in History with entered time (displayed in local timezone)
- ✅ DB stores UTC equivalent of entered local time

**Failure Indicators:**
- ❌ Date picker shows UTC time instead of local time
- ❌ History shows different time than entered (timezone shift)
- ❌ Date picker is hidden/disabled

---

### L2: Edit Entry Preserves Local Time

**Steps:**
1. Ensure LIVE mode is active
2. Go to History page
3. Find an entry showing `15.06.2025 14:30` (example)
4. Click "Редактировать" on latest entry
5. Change date/time to `15.06.2025 16:00`
6. Submit

**Expected Results:**
- ✅ Edit form shows original time as `2025-06-15T14:30` (datetime-local format, local time)
- ✅ After changing to `16:00` and submitting, History shows `15.06.2025 16:00`
- ✅ No timezone shift occurs (entered time = displayed time)

**Failure Indicators:**
- ❌ Edit form shows UTC time (e.g., `11:30` instead of `14:30`)
- ❌ After save, displayed time doesn't match entered time
- ❌ Timezone shift occurs (e.g., enter `16:00`, see `19:00`)

---

### L3: LIVE Mode Ignores Stored AppNow

**Steps:**
1. Switch to TEST mode
2. Set Test Clock to `2027-01-01 00:00`
3. Switch back to LIVE mode
4. Reload page
5. Check Home and Items pages

**Expected Results:**
- ✅ Home shows calculations based on real current time (not stored AppNow)
- ✅ Items page shows calculations based on real current time
- ✅ Test Clock UI is hidden in LIVE mode
- ✅ Simulation buttons are hidden/disabled in LIVE mode

**Failure Indicators:**
- ❌ Home/Items use stored AppNow from TEST mode
- ❌ Test Clock is visible in LIVE mode
- ❌ Calculations show future dates when in LIVE mode

---

## Cross-Mode Tests

### C1: Timezone Display Consistency

**Steps:**
1. Add entry in LIVE mode at local time `14:30` (e.g., UTC+3 timezone)
2. Check History page
3. Check Home page (latest entry display)
4. Switch to TEST mode
5. Check same entry displays

**Expected Results:**
- ✅ Entry shows `14:30` in History (local time, consistent)
- ✅ Entry shows `14:30` on Home (local time, consistent)
- ✅ Display doesn't change when switching modes
- ✅ DB stores UTC equivalent (e.g., `11:30:00Z` for UTC+3)

**Failure Indicators:**
- ❌ Displayed time changes when switching modes
- ❌ Different pages show different times for same entry
- ❌ Timezone shift visible to user

---

### C2: AppNow Persistence

**Steps:**
1. Switch to TEST mode
2. Set Test Clock to `2026-12-25 12:00`
3. Reload page
4. Check Test Clock display

**Expected Results:**
- ✅ Test Clock still shows `2026-12-25 12:00` after reload
- ✅ AppNow persisted in localStorage and cookie
- ✅ Home/Items calculations use persisted AppNow

**Failure Indicators:**
- ❌ Test Clock resets to current time after reload
- ❌ AppNow not persisted
- ❌ Calculations use real time instead of persisted AppNow

---

## Critical Edge Cases

### E1: Manual Entry Timezone Roundtrip

**Steps:**
1. In LIVE mode, add entry at `2025-06-15 14:30` (local time)
2. Edit the same entry
3. Verify edit form shows `2025-06-15T14:30` (not shifted)
4. Save without changes
5. Verify History still shows `15.06.2025 14:30`

**Expected Results:**
- ✅ Edit form prefill matches original display
- ✅ No timezone shift on roundtrip
- ✅ Displayed time remains consistent

**Failure Indicators:**
- ❌ Edit form shows different time than original
- ❌ Time shifts after edit (even without changes)

---

### E2: Future Dates in TEST Mode

**Steps:**
1. Switch to TEST mode
2. Set Test Clock to `2030-01-01 00:00`
3. Add mileage entry
4. Check Home calculations

**Expected Results:**
- ✅ Entry is created with AppNow timestamp (2030-01-01)
- ✅ Home calculations use AppNow (2030-01-01) as anchor
- ✅ No errors or warnings about future dates
- ✅ Daily rate calculation excludes entries after AppNow

**Failure Indicators:**
- ❌ Errors about future dates
- ❌ Calculations ignore AppNow and use real time
- ❌ Future entries included in rate calculation

---

## Summary

**Critical Checks:**
- ✅ TEST mode: Add mileage uses AppNow, not browser time
- ✅ TEST mode: Simulation advances AppNow
- ✅ TEST mode: Home/Items use AppNow for all calculations
- ✅ LIVE mode: Add mileage uses browser time (local)
- ✅ LIVE mode: Edit preserves local time (no shift)
- ✅ LIVE mode: Ignores stored AppNow
- ✅ Display: All times shown in local timezone consistently
- ✅ Persistence: AppNow survives page reload in TEST mode

**Key Principle:**
- **DB stores UTC, UI displays local time** - This is correct and expected behavior.

---

**End of Checklist**

