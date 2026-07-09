-- Bugfix: migration 20260709120000 added UPDATE RLS policies on
-- journal_photos (caption edits) and journal_notes (note edits) but never
-- granted the underlying UPDATE table privilege. RLS policies only apply on
-- top of a GRANT that already permits the operation -- without this, both
-- policies are unreachable and every caption/note edit fails with
-- "permission denied for table journal_photos/journal_notes" (42501),
-- confirmed by testing against a local Supabase instance.

GRANT UPDATE ON public.journal_photos TO authenticated;
GRANT UPDATE ON public.journal_notes TO authenticated;
