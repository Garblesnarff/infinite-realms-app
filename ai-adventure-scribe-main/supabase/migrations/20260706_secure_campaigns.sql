-- Campaign CRUD and public-template discovery now run through server-bun.

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'campaigns'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END
$$;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.campaigns FROM anon, authenticated;
