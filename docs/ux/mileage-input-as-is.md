# Mileage input on Home — AS-IS (mobile PWA)

**Target platform**: iOS Safari / iOS PWA (mobile-first)  
**Date**: Jan 8, 2025  
**Purpose**: Factual documentation of current implementation (no proposals)

---

## 1) Entry point (Home)

**UI control**: Button labeled "Добавить пробег" (`RU.home.addMileage`)

**Files/components**:
- `src/app/page.tsx` (server component) — renders `<AddMileageForm />`
- `src/app/components/AddMileageForm.tsx` — client component, manages form state and modal

**Trigger**: User taps the button → sets `isOpen` state to `true` → form sheet appears

---

## 2) Screen flow (tap → save)

1. **Tap "Добавить пробег"** → `setIsOpen(true)` in `AddMileageForm`
2. **Bottom sheet appears** (iOS-style):
   - Full-screen dimmed overlay (`rgba(0, 0, 0, 0.4)`)
   - White sheet slides up from bottom with rounded top corners (20px radius)
   - Grabber bar at top (iOS visual indicator)
   - Title "Добавить показания" + X close button
3. **Input field auto-focuses** (`mileageInputRef.current.focus()` on mount)
4. **iOS numeric keyboard opens** (`inputMode="numeric"`, `pattern="[0-9\s]*"`)
5. **User enters mileage** → auto-formatted with thousands separator (e.g., "7 000")
6. **Optional**: Toggle date picker or note field (collapsed by default)
7. **Tap "Сохранить"** → `handleSubmit()` → validation → server action → success → sheet closes → page refreshes

**Alternative exits**:
- Tap X button → `handleCancel()` → sheet closes, resets form
- Tap outside overlay (if supported) → closes
- Swipe down on sheet → `useSwipeToClose` hook → closes

---

## 3) UI layout notes (mobile viewport/keyboard)

### Container structure
- **Overlay**: `position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2000`
- **Sheet**: `max-height: 90dvh; border-radius: 20px 20px 0 0;`
- **Form**: `display: flex; flex-direction: column; overflow: hidden`

### Interior layout
- **Header** (sticky): grabber + title + close button
- **Content** (scrollable): `flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch`
- **Actions** (sticky footer): Cancel + Save buttons, `position: sticky; bottom: 0; background: #fff`

### iOS keyboard behavior
- When keyboard opens, it **reduces available viewport height** (`90dvh` adapts dynamically)
- **Sticky footer remains visible** above keyboard (iOS respects `position: sticky` + safe-area-inset-bottom)
- Content area becomes scrollable if fields exceed visible space
- **No explicit keyboard dismiss** — user must tap "Done" on iOS keyboard or tap Save/Cancel

### Safe area handling
- Form actions include `padding-bottom: calc(var(--sp-5, 1.5rem) + env(safe-area-inset-bottom, 0))`
- Container has `padding: env(safe-area-inset-bottom) env(safe-area-inset-right) env(safe-area-inset-left)`

### Swipe-to-close gesture
- Implemented via `useSwipeToClose` hook (touch + pointer events)
- Only triggers when form-content is scrolled to top (`scrollTop > 5` blocks swipe)
- Dragging >80px or fast swipe (velocity > 0.5 px/ms) closes sheet
- Rubber-band effect for downward drags

---

## 4) Validation rules

**Client-side** (`AddMileageForm.tsx`):
- Input must be numeric only (enforced via `formatMileageInput()` + `pattern="[0-9\s]*"`)
- Input cannot be empty (`disabled={isSubmitting || !mileageKm}` on Save button)
- Value must be `> 0` (checked in `handleSubmit`)
- Parsed via `parseMileageInput()` (strips spaces, converts to integer)

**Server-side** (`src/lib/actions/odometerActions.ts` → `addOdometerEntry`):
- Fetches current max mileage: `SELECT mileage_km FROM odometer_entries ORDER BY mileage_km DESC LIMIT 1`
- **Strict monotonicity**: new mileage must be `> maxMileage` (not `>=`)
- Throws error if validation fails: `"Mileage must be greater than previous entry. Latest mileage: X km, provided: Y km"`
- Database trigger also enforces this constraint (redundant safety)

**Edge cases handled**:
- **Empty input**: Save button disabled
- **Same value as previous**: Rejected by server (not strictly greater)
- **Lower value**: Rejected by server
- **Zero or negative**: Rejected client-side before submission
- **Non-numeric input**: Stripped by `formatMileageInput()` (only digits + spaces allowed)

**Error display**: Red error message appears above input field if validation fails

---

## 5) Data persistence path

**Client call**:
```typescript
// AddMileageForm.tsx line 83
const insertedEntry = await addOdometerEntry({
  occurredAt: submissionOccurredAt,
  mileageKm: mileage,
  note: note ? trimWhitespace(note) : null,
});
```

**Server action** (`src/lib/actions/odometerActions.ts`):
1. Validates mileage against max (lines 183-201)
2. Inserts into `odometer_entries` table via Supabase admin client:
   ```typescript
   supabase.from('odometer_entries').insert({
     occurred_at: input.occurredAt.toISOString(),
     mileage_km: input.mileageKm,
     note: input.note || null,
   }).select().single()
   ```
3. Revalidates cache tags: `TAGS.odometer`, `TAGS.odometerEntries`, `TAGS.home`, `TAGS.items`
4. Revalidates paths: `'/'`, `'/items'` (page + layout)
5. Returns inserted entry

**Database**:
- Table: `odometer_entries` (columns: `id`, `occurred_at`, `mileage_km`, `note`, `created_at`)
- Trigger: `check_mileage_monotonic` (redundant server-side validation)

---

## 6) UI refresh after save

**Immediate actions** (lines 104-123 in `AddMileageForm.tsx`):
1. Resets form state: `setMileageKm('')`, `setNote('')`, `setShowDate(false)`, `setShowNote(false)`
2. Closes sheet: `setIsOpen(false)`
3. **Cache-busting navigation**:
   ```typescript
   startTransition(() => {
     const url = new URL(window.location.href);
     url.searchParams.set('_t', Date.now().toString());
     router.replace(url.pathname + url.search);
     router.refresh();
   });
   ```

**Result**:
- Home page re-renders (server component re-executes)
- `getMaxMileageEntry('Home')` fetches new max mileage (bypasses cache in dev)
- Mileage card updates with new value + timestamp
- Service items recalculate status based on new current mileage

**Note**: `startTransition` defers refresh for smoother UI (non-blocking)

---

## 7) UX friction points (observed)

### Mobile keyboard interactions
1. **Keyboard covers part of sheet** — On iOS, when numeric keyboard opens, the sheet height adapts (`90dvh`), but user cannot see full form content without scrolling if optional fields (date/note) are expanded.

2. **No auto-dismiss keyboard** — After entering mileage, user must manually dismiss iOS keyboard by tapping "Done" or tapping Save button. There's no explicit "tap outside input to dismiss" behavior.

3. **Save button always visible** — Footer is sticky, so Save button stays above keyboard. However, if user expands date picker + note field, they may need to scroll down to see it (content area scrolls, footer stays).

4. **Swipe-to-close conflicts with scroll** — If form content is scrollable (e.g., date/note expanded), swipe-down gesture only works when scrolled to top. User must scroll up first before swiping to close, which adds friction.

### Input & validation
5. **Validation error after submission** — If user enters a mileage ≤ previous value, error only appears AFTER tapping Save and waiting for server response. No client-side pre-check against current max mileage (client doesn't know max value until server rejects).

6. **No intermediate feedback** — While saving (`isSubmitting: true`), Save button shows "Сохранение..." text but no spinner or progress indicator. User may wonder if tap registered on slow connections.

### Optional field toggles
7. **Date picker hidden in TEST mode** — In TEST mode (dev), date field shows read-only AppNow value with explanation text. In LIVE mode, user must toggle "Изменить дату" to pick a different date. Default is current time, which is correct for most use cases, but toggle is an extra step if user needs to backdate entry.

8. **Note field collapsed by default** — To add a note, user must toggle "Добавить заметку" button, which reveals textarea. This is appropriate (notes are rare), but adds a tap for users who always want to add notes.

---

## Files reference

**Components**:
- `src/app/components/AddMileageForm.tsx` (289 lines) — main form logic
- `src/app/components/useSwipeToClose.ts` (195 lines) — swipe gesture hook
- `src/app/page.tsx` (502 lines) — Home page, renders form

**Actions**:
- `src/lib/actions/odometerActions.ts` — `addOdometerEntry()` (lines 175-235)
- `src/lib/actions/odometerActions.ts` — `getMaxMileageEntry()` (lines 117-167)

**Utils**:
- `src/lib/utils/numberFormat.ts` — `formatMileageInput()`, `parseMileageInput()`
- `src/lib/time/datetimeLocal.ts` — `toDateTimeLocalValue()`, `fromDateTimeLocalValue()`

**Styles**:
- `src/app/globals.css` — `.add-mileage-form-container`, `.add-mileage-form`, `.form-content`, `.form-actions` (lines 1052-1469)
- Safe area handling (line 1443): `padding-bottom: calc(var(--sp-5, 1.5rem) + env(safe-area-inset-bottom, 0))`
- Keyboard handling (line 1451): `max-height: calc(100dvh - env(keyboard-inset-height, 0px))`

**Database**:
- Table: `odometer_entries` (schema in `supabase/migrations/20260101114456_init_milekeeper.sql`)
- Trigger: `check_mileage_monotonic` (lines in `20260101120354_mileage_guardrails.sql`)

---

**End of AS-IS documentation** — 120 lines (excl. headers/separators)
