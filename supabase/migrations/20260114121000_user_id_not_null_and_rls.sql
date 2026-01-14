-- Enforce user ownership + enable RLS policies (apply AFTER backfill)
--
-- Prerequisite:
-- - scripts/backfill_user_id.sql executed successfully (no NULL user_id remains)

ALTER TABLE odometer_entries
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE service_items
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE service_events
  ALTER COLUMN user_id SET NOT NULL;

-- Enable RLS
ALTER TABLE odometer_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_events ENABLE ROW LEVEL SECURITY;

-- Policies: owner-only access (no public/anon permissive access)

-- odometer_entries
DROP POLICY IF EXISTS "odometer_entries_select_own" ON odometer_entries;
DROP POLICY IF EXISTS "odometer_entries_insert_own" ON odometer_entries;
DROP POLICY IF EXISTS "odometer_entries_update_own" ON odometer_entries;
DROP POLICY IF EXISTS "odometer_entries_delete_own" ON odometer_entries;

CREATE POLICY "odometer_entries_select_own"
  ON odometer_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "odometer_entries_insert_own"
  ON odometer_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "odometer_entries_update_own"
  ON odometer_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "odometer_entries_delete_own"
  ON odometer_entries FOR DELETE
  USING (auth.uid() = user_id);

-- service_items
DROP POLICY IF EXISTS "service_items_select_own" ON service_items;
DROP POLICY IF EXISTS "service_items_insert_own" ON service_items;
DROP POLICY IF EXISTS "service_items_update_own" ON service_items;
DROP POLICY IF EXISTS "service_items_delete_own" ON service_items;

CREATE POLICY "service_items_select_own"
  ON service_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service_items_insert_own"
  ON service_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_items_update_own"
  ON service_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_items_delete_own"
  ON service_items FOR DELETE
  USING (auth.uid() = user_id);

-- service_events
DROP POLICY IF EXISTS "service_events_select_own" ON service_events;
DROP POLICY IF EXISTS "service_events_insert_own" ON service_events;
DROP POLICY IF EXISTS "service_events_update_own" ON service_events;
DROP POLICY IF EXISTS "service_events_delete_own" ON service_events;

CREATE POLICY "service_events_select_own"
  ON service_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service_events_insert_own"
  ON service_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_events_update_own"
  ON service_events FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_events_delete_own"
  ON service_events FOR DELETE
  USING (auth.uid() = user_id);

