-- Migration: Fix Service Event Mileage Guardrail
-- Allows service events with mileage <= current max odometer mileage
-- Only blocks service events with mileage > current max odometer mileage

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_enforce_service_event_mileage ON service_events;
DROP FUNCTION IF EXISTS enforce_service_event_mileage();

-- Create new function that only blocks future mileage (greater than current max)
CREATE OR REPLACE FUNCTION milekeeper_enforce_service_event_mileage_not_future()
RETURNS TRIGGER AS $$
DECLARE
  max_mileage INTEGER;
BEGIN
  -- Get the maximum mileage from odometer entries
  SELECT COALESCE(MAX(mileage_km), -1) INTO max_mileage
  FROM odometer_entries;
  
  -- If no odometer entries exist, block the insert
  IF max_mileage < 0 THEN
    RAISE EXCEPTION 'Сначала добавьте пробег (одометр).';
  END IF;
  
  -- Block only if service event mileage exceeds current max (future mileage)
  IF NEW.mileage_km > max_mileage THEN
    RAISE EXCEPTION 'Пробег события обслуживания не может быть больше текущего пробега (% км).',
      max_mileage;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce service event mileage constraint before insert
CREATE TRIGGER trg_service_event_mileage
  BEFORE INSERT ON service_events
  FOR EACH ROW
  EXECUTE FUNCTION milekeeper_enforce_service_event_mileage_not_future();

