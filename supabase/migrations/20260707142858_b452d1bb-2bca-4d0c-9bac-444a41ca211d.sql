
CREATE POLICY "Signed-in users can read allowlist"
  ON public.allowed_emails FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in users can add invites"
  ON public.allowed_emails FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Signed-in users can remove invites"
  ON public.allowed_emails FOR DELETE TO authenticated USING (true);
