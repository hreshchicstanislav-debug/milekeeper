-- Make notify_before_km nullable (removed from UI)
-- This migration is safe and idempotent

-- Drop NOT NULL constraint if it exists
ALTER TABLE public.service_items
  ALTER COLUMN notify_before_km DROP NOT NULL;

-- Update CHECK constraint to allow NULL
-- Drop existing constraint if it exists
ALTER TABLE public.service_items
  DROP CONSTRAINT IF EXISTS service_items_notify_before_km_positive;

-- Add new constraint that allows NULL or positive value
ALTER TABLE public.service_items
  ADD CONSTRAINT service_items_notify_before_km_positive 
    CHECK (notify_before_km IS NULL OR notify_before_km > 0);

-- Update comment
COMMENT ON COLUMN public.service_items.notify_before_km IS 
  'Kilometers before replacement deadline to show item in "Скоро замена" block (nullable, removed from UI)';

