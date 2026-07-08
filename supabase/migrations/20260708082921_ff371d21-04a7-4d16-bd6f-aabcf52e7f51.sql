
-- Replace ON DELETE CASCADE with a trigger-driven delete on the bucket side to avoid
-- the reverse trigger firing on a row that's mid-cascade (which blocks deletion).
ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_bucket_item_id_fkey;
ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_bucket_item_id_fkey
  FOREIGN KEY (bucket_item_id) REFERENCES public.bucket_items(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.sync_bucket_delete_to_calendar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  DELETE FROM public.calendar_events WHERE bucket_item_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bucket_delete_to_calendar ON public.bucket_items;
CREATE TRIGGER trg_sync_bucket_delete_to_calendar
  AFTER DELETE ON public.bucket_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_bucket_delete_to_calendar();
