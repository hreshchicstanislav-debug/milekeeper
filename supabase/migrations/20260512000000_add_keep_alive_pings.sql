-- Migration: add_keep_alive_pings
-- Purpose: служебная таблица для keep-alive пингов, не влияет на бизнес-данные

CREATE TABLE keep_alive_pings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pinged_at timestamptz NOT NULL DEFAULT now()
);
