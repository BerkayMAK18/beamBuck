
CREATE OR REPLACE FUNCTION public.is_email_allowed(_email TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.allowed_emails)
    OR EXISTS (SELECT 1 FROM public.allowed_emails WHERE lower(email) = lower(_email));
$$;
