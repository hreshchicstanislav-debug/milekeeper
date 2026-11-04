-- Stage 2 (service event kinds). Executed only in the isolated database created by
-- test-db-security.py, after 20261103120000_add_service_event_kind.sql.
-- Real PostgreSQL constraints, grants and RLS; everything is rolled back at the end.
BEGIN;
CREATE SCHEMA kinds_test;
GRANT USAGE ON SCHEMA kinds_test TO anon, authenticated, service_role;

CREATE FUNCTION kinds_test.assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

CREATE FUNCTION kinds_test.expect_error(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    actual_state := SQLSTATE;
  END;
  PERFORM kinds_test.assert(actual_state = expected_state,
    label || ' (SQLSTATE ' || coalesce(actual_state, 'none') || ')');
END $$;

-- The query the application uses for "last replacement" (serviceActions.ts).
CREATE FUNCTION kinds_test.last_replacement(item uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.service_events
  WHERE service_item_id = item AND kind = 'replacement'
  ORDER BY occurred_at DESC, mileage_km DESC, id DESC LIMIT 1
$$;

-- 1. Existing rows: same content, all replacements, no volume.
SELECT kinds_test.assert((
  SELECT b.row_count = a.row_count AND b.fingerprint = a.fingerprint
  FROM migration_check.service_events_before b,
       (SELECT count(*) AS row_count,
               md5(string_agg(concat_ws('|', id, user_id, service_item_id, occurred_at, mileage_km,
                                        coalesce(note, '<null>'), created_at), ',' ORDER BY id)) AS fingerprint
        FROM public.service_events) a), 'existing rows unchanged (count and md5)');
SELECT kinds_test.assert((SELECT count(*) > 0 AND bool_and(kind = 'replacement' AND amount_liters IS NULL)
  FROM public.service_events), 'existing rows became replacements without a volume');

-- 2. Schema shape.
SELECT kinds_test.assert((SELECT attnotnull FROM pg_attribute
  WHERE attrelid = 'public.service_events'::regclass AND attname = 'kind'), 'kind is NOT NULL');
SELECT kinds_test.assert((SELECT pg_get_expr(adbin, adrelid) = '''replacement''::text' FROM pg_attrdef
  WHERE adrelid = 'public.service_events'::regclass
    AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.service_events'::regclass AND attname = 'kind')),
  'kind defaults to replacement');
SELECT kinds_test.assert((SELECT count(*) = 2 FROM pg_constraint
  WHERE conrelid = 'public.service_events'::regclass AND convalidated
    AND conname IN ('service_events_kind_check', 'service_events_amount_liters_check')), 'new checks validated');
SELECT kinds_test.assert((SELECT count(*) = 1 FROM pg_constraint
  WHERE conrelid = 'public.service_events'::regclass AND conname = 'service_events_owner_item_fkey' AND convalidated),
  'stage-1 ownership FK still present');
SELECT kinds_test.assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.service_events'::regclass),
  'service_events RLS still enabled');
SELECT kinds_test.assert((SELECT count(*) = 4 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'service_events'), 'four owner policies still present');

-- 3. Constraints reject invalid kinds and volumes (as the table owner, no RLS).
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'oil_change')
$sql$, '23514', 'unknown kind rejected');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, NULL)
$sql$, '23502', 'NULL kind rejected');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'check', 1)
$sql$, '23514', 'volume on a check rejected');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'replacement', 4.5)
$sql$, '23514', 'volume on a replacement rejected');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'top_up', 0)
$sql$, '23514', 'zero volume rejected');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'top_up', -0.5)
$sql$, '23514', 'negative volume rejected');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'top_up', 1000)
$sql$, '22003', 'volume beyond numeric(5,2) is rejected by the column type');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'top_up', 0.001)
$sql$, '23514', 'volume that rounds to zero is rejected');
-- No arbitrary product limit: 100 and the type maximum 999.99 are accepted (rolled back below).
SAVEPOINT large_volumes;
INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'top_up', 100),
       ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 4000, 'top_up', 999.99);
SELECT kinds_test.assert((SELECT count(*) = 2 FROM public.service_events
  WHERE kind = 'top_up' AND amount_liters IN (100, 999.99) AND mileage_km = 4000
    AND service_item_id = '20000000-0000-0000-0000-000000000003'), '100 and 999.99 L accepted');
ROLLBACK TO SAVEPOINT large_volumes;
SELECT kinds_test.expect_error($sql$
  UPDATE public.service_events SET kind = 'check', amount_liters = 1
  WHERE id = '30000000-0000-0000-0000-000000000012'
$sql$, '23514', 'cannot attach a volume to an existing row by changing its kind');

-- 4. Owner (user C) records a check and top-ups under RLS.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
SELECT kinds_test.assert(
  kinds_test.last_replacement('20000000-0000-0000-0000-000000000003') = '30000000-0000-0000-0000-000000000013',
  'last replacement before new kinds (tie broken by id)');
INSERT INTO public.service_events (id, user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters, note)
VALUES ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000003', '2026-04-01 10:00+00', 4200, 'top_up', 0.5, 'Topped up to max'),
       ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000003', '2026-05-01 10:00+00', 4600, 'check', NULL, 'Level fine'),
       ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000003', '2026-05-02 10:00+00', 4700, 'top_up', NULL, NULL);
SELECT kinds_test.assert((SELECT count(*) = 3 FROM public.service_events WHERE id::text LIKE '40000000%'),
  'owner can add a check and top-ups (with and without volume)');
SELECT kinds_test.assert((SELECT amount_liters = 0.50 FROM public.service_events
  WHERE id = '40000000-0000-0000-0000-000000000001'), 'volume stored as numeric');
SELECT kinds_test.assert(
  kinds_test.last_replacement('20000000-0000-0000-0000-000000000003') = '30000000-0000-0000-0000-000000000013',
  'replacement → top-up → check: last replacement unchanged');
SELECT kinds_test.assert((SELECT id = '30000000-0000-0000-0000-000000000013'
  FROM public.get_last_service_events_for_items(ARRAY['20000000-0000-0000-0000-000000000003'::uuid])),
  'unused RPC returns the last replacement, not the newer check');
INSERT INTO public.service_events (id, user_id, service_item_id, occurred_at, mileage_km)
VALUES ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000004', '2026-05-03 10:00+00', 4800);
SELECT kinds_test.assert((SELECT kind = 'replacement' FROM public.service_events
  WHERE id = '40000000-0000-0000-0000-000000000004'), 'insert without kind (older app version) is a replacement');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 5001, 'check')
$sql$, 'P0001', 'mileage trigger applies to checks');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 5001, 'top_up', 1)
$sql$, 'P0001', 'mileage trigger applies to top-ups');

-- 5. Keyset pagination (occurred_at, mileage_km, id DESC) visits every row exactly once,
--    including rows with equal date and mileage.
CREATE TEMP TABLE seen (id uuid);
DO $$
DECLARE c_at timestamptz; c_km integer; c_id uuid; page_count int := 0; fetched int;
BEGIN
  LOOP
    WITH page AS (
      SELECT id FROM public.service_events
      WHERE service_item_id = '20000000-0000-0000-0000-000000000003'
        AND (c_id IS NULL OR (occurred_at, mileage_km, id) < (c_at, c_km, c_id))
      ORDER BY occurred_at DESC, mileage_km DESC, id DESC LIMIT 2
    ), ins AS (INSERT INTO seen SELECT id FROM page RETURNING id)
    SELECT count(*) INTO fetched FROM ins;
    EXIT WHEN fetched = 0;
    -- The cursor is the oldest row seen so far (the last row of this page).
    SELECT e.occurred_at, e.mileage_km, e.id INTO c_at, c_km, c_id FROM public.service_events e
    WHERE e.id IN (SELECT id FROM seen)
    ORDER BY e.occurred_at, e.mileage_km, e.id LIMIT 1;
    page_count := page_count + 1;
    IF page_count > 20 THEN RAISE EXCEPTION 'pagination did not terminate'; END IF;
  END LOOP;
END $$;
SELECT kinds_test.assert((SELECT count(*) = count(DISTINCT id) AND count(*) = (
  SELECT count(*) FROM public.service_events WHERE service_item_id = '20000000-0000-0000-0000-000000000003')
  FROM seen), 'keyset pages cover every record once');
RESET ROLE;

-- 6. Another user (B) cannot read, create, change or delete user C records.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SELECT kinds_test.assert((SELECT count(*) = 0 FROM public.service_events
  WHERE user_id = '00000000-0000-0000-0000-000000000003'), 'user B cannot read user C records');
-- B needs an own odometer reading, otherwise the mileage trigger rejects first.
INSERT INTO public.odometer_entries (user_id, occurred_at, mileage_km)
VALUES ('00000000-0000-0000-0000-000000000002', now(), 500);
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind, amount_liters)
  VALUES ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', now(), 400, 'top_up', 1)
$sql$, '23503', 'user B cannot attach a top-up to user C item');
SELECT kinds_test.expect_error($sql$
  INSERT INTO public.service_events (user_id, service_item_id, occurred_at, mileage_km, kind)
  VALUES ('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', now(), 400, 'check')
$sql$, '42501', 'user B cannot create a check as user C');
WITH changed AS (UPDATE public.service_events SET kind = 'replacement', amount_liters = NULL
  WHERE id = '40000000-0000-0000-0000-000000000001' RETURNING *)
SELECT kinds_test.assert((SELECT count(*) = 0 FROM changed), 'user B cannot change the kind of a user C record');
WITH changed AS (DELETE FROM public.service_events
  WHERE id IN ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000013') RETURNING *)
SELECT kinds_test.assert((SELECT count(*) = 0 FROM changed), 'user B cannot delete user C records');
SELECT kinds_test.assert((SELECT count(*) = 0
  FROM public.get_last_service_events_for_items(ARRAY['20000000-0000-0000-0000-000000000003'::uuid])),
  'RPC stays under RLS for another user');
RESET ROLE;
SELECT kinds_test.assert((SELECT kind = 'top_up' AND amount_liters = 0.5 FROM public.service_events
  WHERE id = '40000000-0000-0000-0000-000000000001'), 'user C top-up unchanged after user B attempts');

-- 7. Owner deletes: a check (forecast unchanged), then the last replacement (recomputed).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
CREATE TEMP TABLE odometer_before AS SELECT * FROM public.odometer_entries;
WITH changed AS (DELETE FROM public.service_events
  WHERE id = '40000000-0000-0000-0000-000000000002' AND user_id = '00000000-0000-0000-0000-000000000003' RETURNING *)
SELECT kinds_test.assert((SELECT count(*) = 1 FROM changed), 'owner can delete own check');
SELECT kinds_test.assert(
  kinds_test.last_replacement('20000000-0000-0000-0000-000000000003') = '30000000-0000-0000-0000-000000000013',
  'deleting a check keeps the last replacement');
WITH changed AS (DELETE FROM public.service_events
  WHERE id = '30000000-0000-0000-0000-000000000013' AND user_id = '00000000-0000-0000-0000-000000000003' RETURNING *)
SELECT kinds_test.assert((SELECT count(*) = 1 FROM changed), 'owner can delete own last replacement');
SELECT kinds_test.assert(
  kinds_test.last_replacement('20000000-0000-0000-0000-000000000003') = '30000000-0000-0000-0000-000000000012',
  'deleting the last replacement falls back to the previous replacement');
SELECT kinds_test.assert((SELECT count(*) = (SELECT count(*) FROM odometer_before)
  AND NOT EXISTS (SELECT * FROM public.odometer_entries EXCEPT SELECT * FROM odometer_before)
  FROM public.odometer_entries), 'deleting service records leaves the odometer unchanged');
RESET ROLE;

-- 8. Anonymous clients (no JWT subject) see nothing.
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT kinds_test.assert((SELECT count(*) = 0 FROM public.service_events), 'anonymous cannot read records');
WITH changed AS (DELETE FROM public.service_events RETURNING *)
SELECT kinds_test.assert((SELECT count(*) = 0 FROM changed), 'anonymous cannot delete records');
RESET ROLE;
ROLLBACK;
