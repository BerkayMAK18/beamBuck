
CREATE POLICY "Signed-in users read bucket photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bucket-photos');

CREATE POLICY "Signed-in users upload bucket photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bucket-photos');

CREATE POLICY "Signed-in users update bucket photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'bucket-photos');

CREATE POLICY "Signed-in users delete bucket photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bucket-photos');
