-- Add notify thresholds to service_items
-- These fields control when an item appears in "Скоро замена" on Home page

-- Add columns (nullable initially for backfill)
ALTER TABLE public.service_items 
  ADD COLUMN IF NOT EXISTS notify_before_days integer,
  ADD COLUMN IF NOT EXISTS notify_before_km integer;

-- Backfill existing rows with safe defaults
UPDATE public.service_items
SET 
  notify_before_days = 30,
  notify_before_km = 1000
WHERE notify_before_days IS NULL OR notify_before_km IS NULL;

-- Set NOT NULL constraints
ALTER TABLE public.service_items
  ALTER COLUMN notify_before_days SET NOT NULL,
  ALTER COLUMN notify_before_km SET NOT NULL;

-- Add CHECK constraints to ensure positive values
ALTER TABLE public.service_items
  ADD CONSTRAINT service_items_notify_before_days_positive 
    CHECK (notify_before_days > 0),
  ADD CONSTRAINT service_items_notify_before_km_positive 
    CHECK (notify_before_km > 0);

-- Add comment for documentation
COMMENT ON COLUMN public.service_items.notify_before_days IS 
  'Days before replacement deadline to show item in "Скоро замена" block';
COMMENT ON COLUMN public.service_items.notify_before_km IS 
  'Kilometers before replacement deadline to show item in "Скоро замена" block';

