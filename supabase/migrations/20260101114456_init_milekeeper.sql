-- Initial migration for MileKeeper PWA
-- Creates tables for odometer entries and service tracking

-- TODO: Add Row Level Security (RLS) policies when authentication is implemented
-- TODO: Consider adding RLS policies to restrict access based on user context

-- Table: odometer_entries
-- Stores actual odometer readings (facts)
CREATE TABLE odometer_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL,
  mileage_km INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for odometer_entries
CREATE INDEX idx_odometer_entries_occurred_at ON odometer_entries(occurred_at);
CREATE INDEX idx_odometer_entries_mileage_km ON odometer_entries(mileage_km);

-- Table: service_items
-- Stores service items (oil, filter, etc.) with their intervals
CREATE TABLE service_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  interval_km INTEGER NULL,
  interval_days INTEGER NULL,
  note TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Constraint: must have at least one interval defined
  CONSTRAINT service_items_must_have_interval CHECK (
    interval_km IS NOT NULL OR interval_days IS NOT NULL
  )
);

-- Table: service_events
-- Stores actual service events (replacements)
CREATE TABLE service_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id UUID NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  mileage_km INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for service_events
-- Composite index for efficient queries by service item and date
CREATE INDEX idx_service_events_service_item_occurred ON service_events(service_item_id, occurred_at DESC);
-- Index on occurred_at for date-based queries
CREATE INDEX idx_service_events_occurred_at ON service_events(occurred_at);
-- Index on mileage_km for mileage-based queries
CREATE INDEX idx_service_events_mileage_km ON service_events(mileage_km);

