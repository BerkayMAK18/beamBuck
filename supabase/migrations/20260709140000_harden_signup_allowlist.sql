-- Closes two edge cases in the signup allowlist found during a security
-- review (2026-07-09). Neither was ever exploited -- the hook has been
-- confirmed live and rejecting non-allowlisted signups since 2026-07-08
-- (see 20260708150826's comment) -- but both are real gaps in the logic:
--
-- 1. hook_enforce_signup_allowlist() treated a NULL email as automatically
--    allowed ("_email IS NULL OR is_email_allowed(_email)"). Not reachable
--    via the app's own email/password signup form, but any signup path
--    that omits an email (e.g. phone/OTP, if ever enabled) would bypass
--    the allowlist entirely. Flipped to require a non-NULL, allowed email.
--
-- 2. is_email_allowed()'s "empty allowlist -> allow anyone" rule was meant
--    only as a one-time bootstrap for the very first signup, but it keys
--    off allowed_emails being empty *right now* -- so deleting the last
--    invite row (accidental or deliberate) would silently reopen public
--    signup at any point in the app's life, not just at the start. Rescoped
--    the bypass to "no profiles exist yet", which is true only before the
--    first real account is created and never again after -- this project
--    already has its first profile (created 2026-07-08), so the bypass is
--    now permanently closed.
CREATE OR REPLACE FUNCTION public.is_email_allowed(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (NOT EXISTS (SELECT 1 FROM public.profiles) AND NOT EXISTS (SELECT 1 FROM public.allowed_emails))
    OR EXISTS (SELECT 1 FROM public.allowed_emails WHERE lower(email) = lower(_email));
$$;

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

  IF _email IS NOT NULL AND public.is_email_allowed(_email) THEN
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
