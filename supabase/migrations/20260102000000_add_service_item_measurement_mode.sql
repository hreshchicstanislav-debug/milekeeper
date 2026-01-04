-- Add measurement_mode field to service_items
-- This field determines the primary measurement mode: 'km' (by mileage) or 'calendar' (by calendar days)

-- Add column with default 'km' for backward compatibility
ALTER TABLE public.service_items
ADD COLUMN measurement_mode TEXT NOT NULL DEFAULT 'km';

-- Add check constraint to ensure only valid values
ALTER TABLE public.service_items
ADD CONSTRAINT service_items_measurement_mode_check
CHECK (measurement_mode IN ('km', 'calendar'));

-- Add comment for documentation
COMMENT ON COLUMN public.service_items.measurement_mode IS 
'Primary measurement mode: "km" for mileage-based replacement, "calendar" for calendar-based replacement';

