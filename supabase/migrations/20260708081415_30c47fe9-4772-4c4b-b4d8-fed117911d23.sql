
CREATE OR REPLACE FUNCTION public.sync_bucket_to_calendar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id UUID;
BEGIN
  -- If this insert was itself triggered from calendar_events sync, skip to avoid a duplicate.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

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

-- Clean up any duplicates already created: keep the earliest calendar_event per bucket_item_id,
-- and delete unlinked events whose (title, start_at::date, created_by) also match a linked one.
WITH linked AS (
  SELECT DISTINCT ON (bucket_item_id) id, bucket_item_id, title, start_at::date AS d, created_by
  FROM public.calendar_events
  WHERE bucket_item_id IS NOT NULL
  ORDER BY bucket_item_id, created_at ASC
),
dupes AS (
  SELECT c.id
  FROM public.calendar_events c
  JOIN linked l
    ON c.bucket_item_id IS NULL
   AND c.title = l.title
   AND c.start_at::date = l.d
   AND c.created_by = l.created_by
)
DELETE FROM public.calendar_events WHERE id IN (SELECT id FROM dupes);
