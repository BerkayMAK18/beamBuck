
ALTER TABLE public.bucket_items ADD COLUMN IF NOT EXISTS target_time time;

CREATE OR REPLACE FUNCTION public.sync_bucket_to_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_id UUID;
  ev_start timestamptz;
  ev_all_day boolean;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.target_date IS NULL OR NEW.status <> 'planned' THEN
    -- If date was cleared or item is done, drop any linked calendar event.
    DELETE FROM public.calendar_events WHERE bucket_item_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.target_time IS NOT NULL THEN
    ev_start := (NEW.target_date::text || ' ' || NEW.target_time::text)::timestamptz;
    ev_all_day := false;
  ELSE
    ev_start := NEW.target_date::timestamptz;
    ev_all_day := true;
  END IF;

  SELECT id INTO existing_id FROM public.calendar_events WHERE bucket_item_id = NEW.id LIMIT 1;

  IF existing_id IS NULL THEN
    INSERT INTO public.calendar_events (bucket_item_id, title, description, start_at, all_day, created_by)
    VALUES (NEW.id, NEW.title, NEW.notes, ev_start, ev_all_day, NEW.created_by);
  ELSE
    UPDATE public.calendar_events
      SET title = NEW.title,
          description = NEW.notes,
          start_at = ev_start,
          all_day = ev_all_day
      WHERE id = existing_id;
  END IF;

  RETURN NEW;
END;
$function$;
