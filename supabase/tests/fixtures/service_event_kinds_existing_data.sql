-- Synthetic existing rows for the stage-2 migration; apply BEFORE it.
-- User C is separate from the stage-1 users A and B, so database_security.sql keeps
-- its exact row counts. Equal dates and mileages are deliberate (pagination ties).
INSERT INTO public.odometer_entries (id, user_id, occurred_at, mileage_km)
VALUES ('10000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000003', '2026-06-01 08:00+00', 5000);
INSERT INTO public.service_items (id, user_id, title, interval_km, notify_before_days)
VALUES ('20000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000003', 'Engine oil C', 10000, 30),
       ('20000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000003', 'Coolant C', 30000, 30);
INSERT INTO public.service_events
  (id, user_id, service_item_id, occurred_at, mileage_km, note, created_at)
VALUES
  ('30000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000003', '2025-01-10 09:00+00', 1000, 'Old oil change', '2025-01-10 09:00+00'),
  ('30000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000003', '2026-01-10 09:00+00', 3000, NULL, '2026-01-10 09:00+00'),
  ('30000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000003', '2026-01-10 09:00+00', 3000, 'Same date and mileage', '2026-01-10 09:05+00'),
  ('30000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000004', '2026-03-01 12:00+00', 4000, 'Coolant', '2026-03-01 12:00+00');

-- Fingerprint of the pre-migration rows; compared after the migration.
CREATE SCHEMA migration_check;
CREATE TABLE migration_check.service_events_before AS
SELECT count(*) AS row_count,
       md5(string_agg(concat_ws('|', id, user_id, service_item_id, occurred_at, mileage_km,
                                coalesce(note, '<null>'), created_at), ',' ORDER BY id)) AS fingerprint
FROM public.service_events;
