-- Enforce the invite allowlist at the auth layer, not just in the frontend.
--
-- Previously, "invite-only" signup was only a client-side pre-check
-- (src/routes/auth.tsx calling the is_email_allowed RPC before signUp).
-- handle_new_user() creates a profiles row for ANY auth.users insert
-- unconditionally, so anyone who calls the public Supabase Auth signup
-- endpoint directly (bypassing the app's UI) could self-register and get
-- full read/write access via the shared-read RLS policies on bucket_items,
-- calendar_events, and the bucket-photos storage bucket.
--
-- This function is meant to be wired up as a "Before User Created" Auth
-- Hook in the Supabase dashboard (Authentication -> Hooks). See SUPABASE.md
-- for the exact steps -- enabling the hook itself is a dashboard action
-- this migration cannot perform.
CREATE OR REPLACE FUNCTION public.hook_enforce_signup_allowlist(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
BEGIN
  _email := event->'user'->>'email';

  IF _email IS NULL OR public.is_email_allowed(_email) THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email is not on the invite list. Ask an existing member to add it from Settings.'
    )
  );
END;
$$;

-- Required by Supabase Auth Hooks: only the auth service role may call this.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.hook_enforce_signup_allowlist(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.hook_enforce_signup_allowlist(jsonb) FROM PUBLIC, anon, authenticated;
