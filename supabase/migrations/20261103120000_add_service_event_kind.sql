-- Stage 2: record kinds for service events — replacement, check, top-up.
--
-- Additive and data-preserving:
-- * Every existing row becomes 'replacement' through the constant DEFAULT. Since
--   PostgreSQL 11 this is a metadata-only change: no table rewrite, no UPDATE.
-- * The DEFAULT stays permanently, so an insert from an older deployment (which
--   does not know the column) keeps its original meaning: a replacement.
-- * No rows are updated or deleted; RLS policies, the ownership FK and the mileage
--   trigger are untouched and apply to the new kinds as well.
-- * One transaction with a short lock timeout: it applies completely or not at all.
--
-- Only kind = 'replacement' starts a new maintenance interval. The application reads
-- the last replacement with that filter; checks and top-ups never reset forecasts.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.service_events
  ADD COLUMN kind text NOT NULL DEFAULT 'replacement',
  ADD COLUMN amount_liters numeric(5, 2);

ALTER TABLE public.service_events
  ADD CONSTRAINT service_events_kind_check
    CHECK (kind IN ('replacement', 'check', 'top_up')),
  -- A volume is optional and only meaningful for a top-up.
  ADD CONSTRAINT service_events_amount_liters_check
    CHECK (amount_liters IS NULL
           OR (kind = 'top_up' AND amount_liters > 0 AND amount_liters <= 99.99));

COMMENT ON COLUMN public.service_events.kind IS
  'replacement starts a new interval; check and top_up are history records only';
COMMENT ON COLUMN public.service_events.amount_liters IS
  'Optional volume of a top_up, litres (0 < value <= 99.99)';

-- The application does not call this RPC, but it exists in the database. Keep its
-- signature and SECURITY INVOKER semantics (RLS applies) and make it return the last
-- *replacement*, so it can never report a check or top-up as the last service.
CREATE OR REPLACE FUNCTION public.get_last_service_events_for_items(item_ids UUID[])
RETURNS TABLE (
  id UUID,
  service_item_id UUID,
  occurred_at TIMESTAMPTZ,
  mileage_km INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (se.service_item_id)
    se.id,
    se.service_item_id,
    se.occurred_at,
    se.mileage_km,
    se.note,
    se.created_at
  FROM public.service_events se
  WHERE se.service_item_id = ANY(item_ids)
    AND se.kind = 'replacement'
  ORDER BY se.service_item_id, se.occurred_at DESC, se.mileage_km DESC, se.id DESC;
END;
$$ LANGUAGE plpgsql;

-- Ask PostgREST to pick up the new columns immediately.
NOTIFY pgrst, 'reload schema';
COMMIT;
