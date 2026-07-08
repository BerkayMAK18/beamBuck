
-- 1. user_roles + has_role
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

-- Seed existing users as admins (bootstrap for existing workspace)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM public.profiles
ON CONFLICT DO NOTHING;

-- 2. bucket_items: owner-only update/delete
DROP POLICY IF EXISTS "Signed-in users can update" ON public.bucket_items;
DROP POLICY IF EXISTS "Signed-in users can delete" ON public.bucket_items;

CREATE POLICY "Creators can update their bucket items"
  ON public.bucket_items FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creators can delete their bucket items"
  ON public.bucket_items FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

-- 3. calendar_events: owner-only update/delete
DROP POLICY IF EXISTS "Signed-in users can update" ON public.calendar_events;
DROP POLICY IF EXISTS "Signed-in users can delete" ON public.calendar_events;

CREATE POLICY "Creators can update their calendar events"
  ON public.calendar_events FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creators can delete their calendar events"
  ON public.calendar_events FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

-- 4. allowed_emails: admin-only writes
DROP POLICY IF EXISTS "Signed-in users can add invites" ON public.allowed_emails;
DROP POLICY IF EXISTS "Signed-in users can remove invites" ON public.allowed_emails;

CREATE POLICY "Admins can add invites"
  ON public.allowed_emails FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can remove invites"
  ON public.allowed_emails FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. storage.objects: ownership for bucket-photos (folder = user id)
DROP POLICY IF EXISTS "Signed-in users upload bucket photos" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users update bucket photos" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users delete bucket photos" ON storage.objects;

CREATE POLICY "Users upload own bucket photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'bucket-photos'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

CREATE POLICY "Users update own bucket photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'bucket-photos'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

CREATE POLICY "Users delete own bucket photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'bucket-photos'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- 6. Lock down SECURITY DEFINER functions from direct API execution.
-- These are trigger functions or invoked internally; end users must not call them via RPC.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_calendar_to_bucket() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_bucket_to_calendar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_bucket_delete_to_calendar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_calendar_delete_to_bucket() FROM PUBLIC, anon, authenticated;

-- is_email_allowed is used by the profiles insert policy at signup time.
-- Switch to SECURITY INVOKER (authenticated already has SELECT on allowed_emails) and restrict to authenticated.
CREATE OR REPLACE FUNCTION public.is_email_allowed(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.allowed_emails)
    OR EXISTS (SELECT 1 FROM public.allowed_emails WHERE lower(email) = lower(_email));
$$;

REVOKE ALL ON FUNCTION public.is_email_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_email_allowed(text) TO authenticated, service_role;
