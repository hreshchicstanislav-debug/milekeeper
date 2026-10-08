-- Synthetic existing rows; apply BEFORE the stage-1 migrations.
INSERT INTO public.odometer_entries (id, user_id, occurred_at, mileage_km)
VALUES ('10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001', '2026-01-01', 1000);
INSERT INTO public.service_items (id, user_id, title, interval_km, notify_before_days)
VALUES ('20000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001', 'Existing item A', 10000, 30),
       ('20000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000002', 'Existing item B', 10000, 30);
INSERT INTO public.service_events
  (id, user_id, service_item_id, occurred_at, mileage_km, note)
VALUES ('30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', '2026-01-01', 900, 'Existing event');
INSERT INTO public.keep_alive_pings (pinged_at)
VALUES ('2026-01-01');
