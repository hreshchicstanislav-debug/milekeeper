-- Server-only table: the keep-alive route uses service_role, which bypasses RLS.
-- No client policies are needed. Revoke privileges as well as enabling RLS so
-- clients cannot use operations such as TRUNCATE that are not governed by RLS.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.keep_alive_pings ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.keep_alive_pings
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.keep_alive_pings_id_seq
  FROM PUBLIC, anon, authenticated;

-- Preserve both insertion and the cron's cleanup of old pings.
GRANT SELECT, INSERT, DELETE ON TABLE public.keep_alive_pings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.keep_alive_pings_id_seq TO service_role;
COMMIT;
