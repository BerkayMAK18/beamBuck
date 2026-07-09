-- journal_photos rows can be deleted (removePhoto) or have their url
-- replaced (repairPhoto, when a raw-HEIC upload gets re-encoded to JPEG),
-- but neither path ever deleted the underlying bucket-photos storage
-- object -- only the DB row/url changed. Confirmed live: two raw-HEIC
-- uploads from 2026-07-08 are still sitting in storage today with no
-- journal_photos row pointing at them anymore.
--
-- This trigger deletes the storage object whenever a journal_photos row
-- is deleted, or its url is replaced with a different one, so photo
-- removal/repair stops leaking storage.
CREATE OR REPLACE FUNCTION public.cleanup_journal_photo_storage_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _path text;
BEGIN
  -- OLD.url is a signed URL, e.g.
  -- https://<host>/storage/v1/object/sign/bucket-photos/<user_id>/<file>?token=...
  -- Pull out the path after "bucket-photos/" and before the "?".
  _path := substring(OLD.url FROM 'bucket-photos/([^?]+)');
  IF _path IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id = 'bucket-photos' AND name = _path;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER journal_photos_cleanup_storage_on_delete
AFTER DELETE ON public.journal_photos
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_journal_photo_storage_object();

CREATE TRIGGER journal_photos_cleanup_storage_on_url_change
AFTER UPDATE OF url ON public.journal_photos
FOR EACH ROW
WHEN (OLD.url IS DISTINCT FROM NEW.url)
EXECUTE FUNCTION public.cleanup_journal_photo_storage_object();
