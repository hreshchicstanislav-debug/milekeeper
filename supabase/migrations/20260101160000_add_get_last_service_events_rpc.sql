-- Migration: Add RPC function to get last service events for multiple items
-- Uses DISTINCT ON for efficient SQL-side filtering

-- Create function to get the last service event per service_item_id
CREATE OR REPLACE FUNCTION get_last_service_events_for_items(item_ids UUID[])
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
  SELECT DISTINCT ON (service_item_id)
    se.id,
    se.service_item_id,
    se.occurred_at,
    se.mileage_km,
    se.note,
    se.created_at
  FROM service_events se
  WHERE se.service_item_id = ANY(item_ids)
  ORDER BY se.service_item_id, se.occurred_at DESC, se.mileage_km DESC;
END;
$$ LANGUAGE plpgsql;

