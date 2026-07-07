-- Browser access to character data is intentionally disabled.
-- All application reads and writes must go through authenticated server-bun routes.

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('characters', 'character_stats')
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

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.characters FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.character_stats FROM anon, authenticated;
