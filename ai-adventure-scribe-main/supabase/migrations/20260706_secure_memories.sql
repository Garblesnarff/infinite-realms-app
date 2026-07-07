-- Memory reads, writes, scoring, and semantic matching now require server authorization.

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'memories'
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

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.memories FROM anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.match_memories(vector,uuid,double precision,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.match_memories(vector, uuid, double precision, integer)
      FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;
