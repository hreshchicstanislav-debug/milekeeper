DO $$ BEGIN
  IF (SELECT count(*) FROM public.service_events) <> 1
     OR (SELECT user_id FROM public.service_events) <>
        '00000000-0000-0000-0000-000000000002'::uuid THEN
    RAISE EXCEPTION 'Migration failure must preserve the existing event';
  END IF;
  IF EXISTS (SELECT FROM pg_constraint
             WHERE conname IN ('service_events_owner_item_fkey', 'service_items_user_id_id_key'))
     OR NOT EXISTS (SELECT FROM pg_constraint
                    WHERE conname = 'service_events_service_item_id_fkey') THEN
    RAISE EXCEPTION 'Migration failure must roll back all constraint changes';
  END IF;
  RAISE NOTICE 'PASS: legacy mismatch aborts migration atomically without deleting data';
END $$;
