-- Backfill user_id for existing rows (one-time manual script)
--
-- How to get OWNER_USER_ID:
-- 1) Supabase Dashboard → Authentication → Users → copy the user's UUID
--    (or run: SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 20;)
--
-- How to run:
-- 1) Open Supabase SQL Editor
-- 2) Replace the placeholder below with the real UUID (OWNER_USER_ID)
-- 3) Run this script once
--
-- IMPORTANT:
-- - This sets user_id ONLY for rows where user_id IS NULL.
-- - Run this AFTER migration `20260114120000_add_user_id_columns.sql`
-- - Run this BEFORE migration that makes user_id NOT NULL + enables RLS.

-- >>> REPLACE THIS VALUE <<<
-- Example: 11111111-2222-3333-4444-555555555555
DO $$
DECLARE
  owner_user_id uuid := 'OWNER_USER_ID_HERE';
BEGIN
  UPDATE odometer_entries
  SET user_id = owner_user_id
  WHERE user_id IS NULL;

  UPDATE service_items
  SET user_id = owner_user_id
  WHERE user_id IS NULL;

  UPDATE service_events
  SET user_id = owner_user_id
  WHERE user_id IS NULL;
END $$;

