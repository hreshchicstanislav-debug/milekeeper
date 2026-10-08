-- Enforce ownership even for direct Data API writes and privileged maintenance.
-- RLS continues to control access to rows; this FK controls their relationship.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.service_items
  ADD CONSTRAINT service_items_user_id_id_key UNIQUE (user_id, id);

-- The existing (user_id, service_item_id, occurred_at) index covers the child
-- columns, so no additional service_events index is needed.
ALTER TABLE public.service_events
  ADD CONSTRAINT service_events_owner_item_fkey
  FOREIGN KEY (user_id, service_item_id)
  REFERENCES public.service_items (user_id, id)
  ON DELETE CASCADE
  NOT VALID;

-- Abort without changing/deleting user data if legacy mismatches exist.
ALTER TABLE public.service_events
  VALIDATE CONSTRAINT service_events_owner_item_fkey;

-- Replace the old single-column FK only after the new one has been validated.
ALTER TABLE public.service_events
  DROP CONSTRAINT service_events_service_item_id_fkey;
COMMIT;
