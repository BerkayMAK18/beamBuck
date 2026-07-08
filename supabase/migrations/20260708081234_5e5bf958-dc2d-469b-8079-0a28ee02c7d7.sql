
-- Bucket -> Calendar
CREATE OR REPLACE FUNCTION public.sync_bucket_to_calendar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id UUID;
BEGIN
  IF NEW.target_date IS NULL OR NEW.status <> 'planned' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO existing_id FROM public.calendar_events WHERE bucket_item_id = NEW.id LIMIT 1;

  IF existing_id IS NULL THEN
    INSERT INTO public.calendar_events (bucket_item_id, title, description, start_at, all_day, created_by)
    VALUES (NEW.id, NEW.title, NEW.notes, NEW.target_date::timestamptz, true, NEW.created_by);
  ELSE
    UPDATE public.calendar_events
      SET title = NEW.title,
          description = NEW.notes,
          start_at = NEW.target_date::timestamptz,
          all_day = true
      WHERE id = existing_id
        AND (title IS DISTINCT FROM NEW.title
          OR description IS DISTINCT FROM NEW.notes
          OR start_at IS DISTINCT FROM NEW.target_date::timestamptz);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bucket_to_calendar ON public.bucket_items;
CREATE TRIGGER trg_sync_bucket_to_calendar
  AFTER INSERT OR UPDATE ON public.bucket_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_bucket_to_calendar();

-- Calendar -> Bucket
CREATE OR REPLACE FUNCTION public.sync_calendar_to_bucket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_bucket_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.bucket_item_id IS NULL THEN
      INSERT INTO public.bucket_items (title, notes, target_date, status, created_by)
      VALUES (NEW.title, NEW.description, NEW.start_at::date, 'planned', NEW.created_by)
      RETURNING id INTO new_bucket_id;

      UPDATE public.calendar_events SET bucket_item_id = new_bucket_id WHERE id = NEW.id;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.bucket_item_id IS NOT NULL THEN
    UPDATE public.bucket_items
      SET title = NEW.title,
          notes = NEW.description,
          target_date = NEW.start_at::date
      WHERE id = NEW.bucket_item_id
        AND (title IS DISTINCT FROM NEW.title
          OR notes IS DISTINCT FROM NEW.description
          OR target_date IS DISTINCT FROM NEW.start_at::date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_calendar_to_bucket ON public.calendar_events;
CREATE TRIGGER trg_sync_calendar_to_bucket
  AFTER INSERT OR UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_calendar_to_bucket();

-- Backfill: existing open bucket items with a target date but no calendar event
INSERT INTO public.calendar_events (bucket_item_id, title, description, start_at, all_day, created_by)
SELECT b.id, b.title, b.notes, b.target_date::timestamptz, true, b.created_by
FROM public.bucket_items b
LEFT JOIN public.calendar_events c ON c.bucket_item_id = b.id
WHERE b.target_date IS NOT NULL AND b.status = 'planned' AND c.id IS NULL;
