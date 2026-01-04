-- Migration: Mileage Guardrails
-- Enforces strict monotonicity for odometer entries and service events at the database level

-- Function to enforce odometer entry monotonicity
-- Ensures new odometer entries have mileage_km strictly greater than the previous maximum
CREATE OR REPLACE FUNCTION enforce_odometer_monotonic()
RETURNS TRIGGER AS $$
DECLARE
  max_mileage INTEGER;
BEGIN
  -- Get the maximum mileage from existing odometer entries
  SELECT COALESCE(MAX(mileage_km), -1) INTO max_mileage
  FROM odometer_entries;
  
  -- Check if new mileage is strictly greater than the maximum
  IF NEW.mileage_km <= max_mileage THEN
    RAISE EXCEPTION 'Mileage must be greater than previous odometer value. Latest mileage: % km, provided: % km',
      max_mileage, NEW.mileage_km;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce odometer monotonicity before insert
CREATE TRIGGER trigger_enforce_odometer_monotonic
  BEFORE INSERT ON odometer_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_odometer_monotonic();

-- Function to enforce service event mileage constraint
-- Ensures service events have mileage_km >= the current maximum odometer mileage
CREATE OR REPLACE FUNCTION enforce_service_event_mileage()
RETURNS TRIGGER AS $$
DECLARE
  max_odometer_mileage INTEGER;
BEGIN
  -- Get the maximum mileage from odometer entries
  SELECT COALESCE(MAX(mileage_km), -1) INTO max_odometer_mileage
  FROM odometer_entries;
  
  -- Check if service event mileage is >= the maximum odometer mileage
  IF NEW.mileage_km < max_odometer_mileage THEN
    RAISE EXCEPTION 'Service mileage cannot be less than latest odometer value. Latest odometer: % km, provided: % km',
      max_odometer_mileage, NEW.mileage_km;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce service event mileage constraint before insert
CREATE TRIGGER trigger_enforce_service_event_mileage
  BEFORE INSERT ON service_events
  FOR EACH ROW
  EXECUTE FUNCTION enforce_service_event_mileage();

