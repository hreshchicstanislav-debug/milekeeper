-- Add user_id columns (nullable) + indexes for multi-user RLS MVP
-- IMPORTANT: Do NOT set NOT NULL here. Backfill first using scripts/backfill_user_id.sql

ALTER TABLE odometer_entries ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE service_items ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS user_id UUID;

-- Indexes to support user-scoped queries
CREATE INDEX IF NOT EXISTS idx_odometer_entries_user_id ON odometer_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_odometer_entries_user_id_occurred_at ON odometer_entries(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_odometer_entries_user_id_mileage_km ON odometer_entries(user_id, mileage_km DESC);

CREATE INDEX IF NOT EXISTS idx_service_items_user_id ON service_items(user_id);
CREATE INDEX IF NOT EXISTS idx_service_items_user_id_title ON service_items(user_id, title);

CREATE INDEX IF NOT EXISTS idx_service_events_user_id ON service_events(user_id);
CREATE INDEX IF NOT EXISTS idx_service_events_user_id_item_occurred ON service_events(user_id, service_item_id, occurred_at DESC);

