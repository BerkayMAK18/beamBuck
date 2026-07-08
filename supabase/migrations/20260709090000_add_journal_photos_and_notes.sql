-- Journal feature: replaces the flat bucket_items.image_urls array with a
-- proper table so photos can carry an optional caption + who/when added it,
-- and adds a notes/comments thread per completed item.
--
-- Unlike bucket_items itself (owner-only UPDATE, see migration
-- 20260708095929), both new tables allow ANY signed-in user to add their
-- own photo/note to ANY item, not just ones they created -- a shared
-- journal only makes sense if both people can add memories to it.
-- Deleting your own contribution is allowed; editing someone else's isn't.

CREATE TABLE public.journal_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_item_id UUID NOT NULL REFERENCES public.bucket_items(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.journal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_item_id UUID NOT NULL REFERENCES public.bucket_items(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_photos_item ON public.journal_photos(bucket_item_id);
CREATE INDEX idx_journal_notes_item ON public.journal_notes(bucket_item_id);

GRANT SELECT, INSERT, DELETE ON public.journal_photos TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.journal_notes TO authenticated;
GRANT ALL ON public.journal_photos, public.journal_notes TO service_role;

ALTER TABLE public.journal_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shared read for signed-in users" ON public.journal_photos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in users can add their own photo" ON public.journal_photos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Owners can delete their own photo" ON public.journal_photos
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Shared read for signed-in users" ON public.journal_notes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in users can add their own note" ON public.journal_notes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Owners can delete their own note" ON public.journal_notes
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Backfill: carry over existing gallery photos so nothing already uploaded
-- disappears from the new Journal view. Attributed to the item's creator
-- and timestamped at completion, since the old column tracked neither
-- per-photo.
INSERT INTO public.journal_photos (bucket_item_id, url, created_by, created_at)
SELECT id, unnest(image_urls), created_by, COALESCE(completed_at, created_at)
FROM public.bucket_items
WHERE image_urls IS NOT NULL AND array_length(image_urls, 1) > 0;

ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_photos, public.journal_notes;
