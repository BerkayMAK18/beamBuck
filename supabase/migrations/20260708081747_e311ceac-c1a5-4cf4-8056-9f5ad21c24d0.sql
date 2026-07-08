
-- Delete linked bucket item when its calendar event is deleted.
CREATE OR REPLACE FUNCTION public.sync_calendar_delete_to_bucket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF OLD.bucket_item_id IS NOT NULL THEN
    DELETE FROM public.bucket_items WHERE id = OLD.bucket_item_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_calendar_delete_to_bucket ON public.calendar_events;
CREATE TRIGGER trg_sync_calendar_delete_to_bucket
  AFTER DELETE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_calendar_delete_to_bucket();

-- Deleting a bucket item cascades to its calendar event via FK.
ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_bucket_item_id_fkey;
ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_bucket_item_id_fkey
  FOREIGN KEY (bucket_item_id) REFERENCES public.bucket_items(id) ON DELETE CASCADE;
