-- is_email_allowed was switched to SECURITY INVOKER on the assumption that
-- "authenticated already has SELECT on allowed_emails" covers every caller.
-- It doesn't: src/routes/auth.tsx calls this RPC as a pre-signup check
-- BEFORE the user has a session, i.e. as `anon` -- and `anon` has no SELECT
-- policy on allowed_emails. Under RLS that makes the table look empty to
-- an anon caller regardless of its real contents, so the bootstrap rule
-- ("empty table -> allow anyone") fired on every single call, making the
-- frontend pre-check silently always return true.
--
-- Confirmed live: calling the RPC with the anon key returned true for an
-- email that is NOT on the allowlist, while the same call with a
-- service-role key correctly returned false (2026-07-08).
--
-- This was NOT a security hole -- hook_enforce_signup_allowlist() is
-- SECURITY DEFINER and correctly bypasses RLS when it calls this function
-- internally (confirmed: a real signup attempt with a non-allowlisted
-- email was rejected with a 403 by the hook). Only the cosmetic frontend
-- pre-check was broken -- users would skip straight to the hook's error
-- instead of seeing the friendlier pre-check message.
--
-- Fix: go back to SECURITY DEFINER (as it was in the original migration)
-- so the function gives a correct, RLS-independent answer no matter who
-- calls it, same as has_role().
CREATE OR REPLACE FUNCTION public.is_email_allowed(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.allowed_emails)
    OR EXISTS (SELECT 1 FROM public.allowed_emails WHERE lower(email) = lower(_email));
$$;

GRANT EXECUTE ON FUNCTION public.is_email_allowed(text) TO anon, authenticated, service_role;
