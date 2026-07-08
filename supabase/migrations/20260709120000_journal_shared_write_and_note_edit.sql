-- Follow-up to 20260709090000 based on real usage:
--
-- 1. journal_photos never got an UPDATE policy, so the caption editor in the
--    Journal UI was silently a no-op (RLS denies with no matching policy).
-- 2. Photos backfilled from the old gallery are attributed to the bucket
--    item's original creator, not whoever actually wants to delete a "wrong"
--    photo -- and the old owner-only DELETE policy blocked the other person
--    from removing photos their partner added too. Both photo write policies
--    are widened to any signed-in user, matching the existing shared-read /
--    shared-INSERT policy instead of fighting it.
-- 3. Notes needed to be editable, not just deletable -- kept owner-only
--    since a note is attributed to a specific person by name.

DROP POLICY IF EXISTS "Owners can delete their own photo" ON public.journal_photos;
CREATE POLICY "Signed-in users can delete any photo" ON public.journal_photos
  FOR DELETE TO authenticated USING (true);
CREATE POLICY "Signed-in users can update any photo" ON public.journal_photos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.journal_notes ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER set_journal_notes_updated_at BEFORE UPDATE ON public.journal_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Owners can update their own note" ON public.journal_notes
  FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
