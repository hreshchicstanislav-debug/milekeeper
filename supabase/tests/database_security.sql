-- Executed only in the isolated database created by test-db-security.py.
-- Real PostgreSQL constraints, grants and RLS; no SQL-pattern mocks or pgTAP.
BEGIN;
CREATE SCHEMA security_test;
GRANT USAGE ON SCHEMA security_test TO anon, authenticated, service_role;

CREATE FUNCTION security_test.assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

CREATE FUNCTION security_test.expect_error(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    actual_state := SQLSTATE;
  END;
  PERFORM security_test.assert(actual_state = expected_state,
    label || ' (SQLSTATE ' || coalesce(actual_state, 'none') || ')');
END $$;

CREATE FUNCTION security_test.client_keep_alive_denied()
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM security_test.expect_error('SELECT * FROM public.keep_alive_pings', '42501',
    current_user || ' cannot read pings');
  PERFORM security_test.expect_error('INSERT INTO public.keep_alive_pings DEFAULT VALUES', '42501',
    current_user || ' cannot insert pings');
  PERFORM security_test.expect_error('UPDATE public.keep_alive_pings SET pinged_at = now()', '42501',
    current_user || ' cannot update pings');
  PERFORM security_test.expect_error('DELETE FROM public.keep_alive_pings', '42501',
    current_user || ' cannot delete pings');
  PERFORM security_test.expect_error('TRUNCATE public.keep_alive_pings', '42501',
    current_user || ' cannot truncate pings');
  PERFORM security_test.assert(
    NOT has_sequence_privilege(current_user, 'public.keep_alive_pings_id_seq', 'USAGE')
    AND NOT has_sequence_privilege(current_user, 'public.keep_alive_pings_id_seq', 'SELECT')
    AND NOT has_sequence_privilege(current_user, 'public.keep_alive_pings_id_seq', 'UPDATE'),
    current_user || ' has no sequence privileges');
END $$;

SELECT security_test.assert((SELECT relrowsecurity FROM pg_class
  WHERE oid = 'public.keep_alive_pings'::regclass), 'ping RLS enabled');
SELECT security_test.assert((SELECT count(*) = 1 FROM public.keep_alive_pings),
  'existing ping preserved');
SELECT security_test.assert((SELECT count(*) = 1 FROM public.service_events
  WHERE note = 'Existing event'), 'existing service event preserved');
SELECT security_test.assert((SELECT convalidated FROM pg_constraint
  WHERE conrelid = 'public.service_events'::regclass
    AND conname = 'service_events_owner_item_fkey'), 'ownership FK validated');

SET LOCAL ROLE anon;
SELECT security_test.client_keep_alive_denied();
SELECT security_test.assert((SELECT count(*) = 0 FROM public.service_items),
  'anonymous cannot read service items');
SELECT security_test.assert((SELECT count(*) = 0 FROM public.service_events),
  'anonymous cannot read service events');
SELECT security_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km)
  VALUES ('00000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', now(), 100)
$sql$, 'P0001', 'anonymous insert blocked by existing mileage trigger (no visible odometer)');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT security_test.client_keep_alive_denied();
SELECT security_test.assert((SELECT count(*) = 1 FROM public.service_items),
  'user A sees only own item');
SELECT security_test.assert((SELECT count(*) = 1 FROM public.service_events),
  'user A sees only own event');

INSERT INTO public.service_events (id, user_id, service_item_id, occurred_at, mileage_km)
VALUES ('30000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', now(), 950);
SELECT security_test.assert((SELECT count(*) = 2 FROM public.service_events),
  'user A can add own replacement');
UPDATE public.service_events SET note = 'Updated own event'
WHERE id = '30000000-0000-0000-0000-000000000003';
SELECT security_test.assert((SELECT note = 'Updated own event' FROM public.service_events
  WHERE id = '30000000-0000-0000-0000-000000000003'), 'user A can edit own event');

SELECT security_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km)
  VALUES ('00000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000002', now(), 900)
$sql$, '23503', 'user A cannot attach new event to user B item');
SELECT security_test.expect_error($sql$
  UPDATE public.service_events SET service_item_id = '20000000-0000-0000-0000-000000000002'
  WHERE id = '30000000-0000-0000-0000-000000000001'
$sql$, '23503', 'user A cannot move existing event to user B item');
SELECT security_test.expect_error($sql$
  UPDATE public.service_events SET user_id = '00000000-0000-0000-0000-000000000002'
  WHERE id = '30000000-0000-0000-0000-000000000001'
$sql$, '42501', 'user A cannot reassign event ownership');
SELECT security_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km)
  VALUES ('00000000-0000-0000-0000-000000000002',
          '20000000-0000-0000-0000-000000000002', now(), 900)
$sql$, '42501', 'user A cannot create an event as user B');
WITH changed AS (DELETE FROM public.service_items
  WHERE id = '20000000-0000-0000-0000-000000000002' RETURNING *)
SELECT security_test.assert((SELECT count(*) = 0 FROM changed), 'user A cannot delete user B item');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SELECT security_test.assert((SELECT count(*) = 0 FROM public.service_events),
  'user B cannot read user A events');
-- First odometer reading must not be blocked by user A mileage.
INSERT INTO public.odometer_entries (user_id, occurred_at, mileage_km)
VALUES ('00000000-0000-0000-0000-000000000002', now(), 500);
INSERT INTO public.service_events (id, user_id, service_item_id, occurred_at, mileage_km)
VALUES ('30000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000002', now(), 400);
SELECT security_test.assert((SELECT count(*) = 1 FROM public.service_events),
  'user B can create own first replacement');
SELECT security_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km)
  VALUES ('00000000-0000-0000-0000-000000000002',
          '20000000-0000-0000-0000-000000000001', now(), 400)
$sql$, '23503', 'user B cannot attach event to user A item');
WITH changed AS (UPDATE public.service_events SET note = 'Attacker'
  WHERE id = '30000000-0000-0000-0000-000000000001' RETURNING *)
SELECT security_test.assert((SELECT count(*) = 0 FROM changed), 'user B cannot edit user A event');
WITH changed AS (DELETE FROM public.service_events
  WHERE id = '30000000-0000-0000-0000-000000000001' RETURNING *)
SELECT security_test.assert((SELECT count(*) = 0 FROM changed), 'user B cannot delete user A event');
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO public.keep_alive_pings DEFAULT VALUES;
DELETE FROM public.keep_alive_pings WHERE pinged_at < now() - interval '30 days';
SELECT security_test.assert((SELECT count(*) = 1 FROM public.keep_alive_pings),
  'server role can insert ping and clean up old rows under RLS');
SELECT security_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km)
  VALUES ('00000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000002', now(), 900)
$sql$, '23503', 'ownership FK enforced even with RLS bypass');
SELECT security_test.expect_error($sql$
  UPDATE public.service_events SET user_id = '00000000-0000-0000-0000-000000000002'
  WHERE id = '30000000-0000-0000-0000-000000000001'
$sql$, '23503', 'privileged event-owner change cannot break relationship');
SELECT security_test.expect_error($sql$
  UPDATE public.service_items SET user_id = '00000000-0000-0000-0000-000000000002'
  WHERE id = '20000000-0000-0000-0000-000000000001'
$sql$, '23503', 'privileged parent-owner change cannot break relationship');
RESET ROLE;

-- Prove RLS remains a second barrier if table privileges are later re-granted.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.keep_alive_pings TO anon, authenticated;
SET LOCAL ROLE authenticated;
SELECT security_test.assert((SELECT count(*) = 0 FROM public.keep_alive_pings),
  'ping RLS denies reads even with table grant');
SELECT security_test.expect_error('INSERT INTO public.keep_alive_pings DEFAULT VALUES', '42501',
  'ping RLS denies inserts even with table grant');
WITH changed AS (UPDATE public.keep_alive_pings SET pinged_at = now() RETURNING *)
SELECT security_test.assert((SELECT count(*) = 0 FROM changed), 'ping RLS denies updates');
WITH changed AS (DELETE FROM public.keep_alive_pings RETURNING *)
SELECT security_test.assert((SELECT count(*) = 0 FROM changed), 'ping RLS denies deletes');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DELETE FROM public.service_items WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT security_test.assert((SELECT count(*) = 0 FROM public.service_events),
  'deleting own item still cascades to own events');
RESET ROLE;
SELECT security_test.assert((SELECT count(*) = 1 FROM public.service_events
  WHERE user_id = '00000000-0000-0000-0000-000000000002'),
  'cascade deletion preserves user B event');
SELECT security_test.assert((SELECT count(*) = 1 FROM public.keep_alive_pings),
  'denied client operations did not change server ping');
ROLLBACK;
