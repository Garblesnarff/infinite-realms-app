-- Issue #1784: close the six tables that still grant public anon access.
--
-- Production is the source of truth for these dashboard-created tables. Four
-- of them (voice mappings, voice profiles, safety audit trail, and session
-- config) were not represented in the replayable migration history, so their
-- current production definitions are included idempotently below. The other
-- two already have current-shape backfills in db/migrations/.
--
-- The application uses WorkOS identities, which are stored as text on
-- campaigns/characters rather than as Supabase auth UUIDs. The ownership
-- helpers therefore read the signed request subject as text and use the
-- existing campaign/character/session relationships. Only authenticated owner
-- reads remain; the service role retains an explicit internal read path.

-- ---------------------------------------------------------------------------
-- Production definitions missing from the historical replay
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.character_voice_mappings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  character_name text NOT NULL,
  voice_id text NOT NULL,
  voice_category text,
  appearance_count integer DEFAULT 1,
  first_appearance timestamptz DEFAULT now(),
  last_used timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT character_voice_mappings_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_character_voice_mappings_character
  ON public.character_voice_mappings (character_name);
CREATE INDEX IF NOT EXISTS idx_character_voice_mappings_session
  ON public.character_voice_mappings (session_id);

CREATE TABLE IF NOT EXISTS public.character_voice_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  character_id uuid,
  voice_style text,
  speech_patterns text[],
  vocabulary_level text,
  tone text,
  quirks text[],
  example_phrases text[],
  consistency_score numeric(3,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT character_voice_profiles_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_character_voice_profiles_character
  ON public.character_voice_profiles (character_id);

CREATE TABLE IF NOT EXISTS public.safety_audit_trail (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid,
  user_id uuid,
  action_type text NOT NULL,
  action_details jsonb,
  content_flagged text,
  filter_applied text,
  severity_level text,
  "timestamp" timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT safety_audit_trail_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_safety_audit_session
  ON public.safety_audit_trail (session_id);
CREATE INDEX IF NOT EXISTS idx_safety_audit_timestamp
  ON public.safety_audit_trail ("timestamp");
CREATE INDEX IF NOT EXISTS idx_safety_audit_user
  ON public.safety_audit_trail (user_id);

CREATE TABLE IF NOT EXISTS public.session_config (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  config_key text NOT NULL,
  config_value jsonb,
  content_filter_level text DEFAULT 'moderate'::text,
  allow_violence boolean DEFAULT false,
  allow_romance boolean DEFAULT false,
  allow_horror boolean DEFAULT false,
  custom_boundaries text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT session_config_pkey PRIMARY KEY (id),
  CONSTRAINT session_config_session_id_config_key_key UNIQUE (session_id, config_key)
);

CREATE INDEX IF NOT EXISTS idx_session_config_session
  ON public.session_config (session_id);

-- ---------------------------------------------------------------------------
-- Ownership helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_1784_current_request_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
    NULLIF(current_setting('request.jwt.claim.sub', true), '')
  );
$$;

CREATE OR REPLACE FUNCTION public.issue_1784_character_is_owned(p_character_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH caller AS (
    SELECT public.issue_1784_current_request_user_id() AS user_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.characters AS c
    CROSS JOIN caller
    WHERE c.id = p_character_id
      AND (
        c.user_id = caller.user_id
        OR c.owner_id = caller.user_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.issue_1784_session_is_owned(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH caller AS (
    SELECT public.issue_1784_current_request_user_id() AS user_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.game_sessions AS gs
    LEFT JOIN public.characters AS c ON c.id = gs.character_id
    LEFT JOIN public.campaigns AS ca ON ca.id = gs.campaign_id
    CROSS JOIN caller
    WHERE gs.id = p_session_id
      AND (
        c.user_id = caller.user_id
        OR c.owner_id = caller.user_id
        OR ca.user_id = caller.user_id
      )
  );
$$;

REVOKE ALL ON FUNCTION public.issue_1784_current_request_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1784_character_is_owned(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1784_session_is_owned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_1784_current_request_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1784_character_is_owned(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1784_session_is_owned(uuid) TO authenticated;

-- Remove the historical permissive policies, including any policy added out
-- of band after the last migration was written.
DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (
        ARRAY[
          'safety_audit_trail',
          'character_equipment',
          'character_creation_metrics',
          'character_voice_mappings',
          'character_voice_profiles',
          'session_config'
        ]
      )
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$$;

-- A public anon-key request must not have table privileges at all. Keep only
-- authenticated SELECT so the RLS owner predicates are the security boundary.
REVOKE ALL PRIVILEGES ON TABLE
  public.safety_audit_trail,
  public.character_equipment,
  public.character_creation_metrics,
  public.character_voice_mappings,
  public.character_voice_profiles,
  public.session_config
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.safety_audit_trail,
  public.character_equipment,
  public.character_creation_metrics,
  public.character_voice_mappings,
  public.character_voice_profiles,
  public.session_config
TO authenticated, service_role;

ALTER TABLE public.safety_audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_creation_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_voice_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY issue_1784_safety_audit_trail_owner_read
  ON public.safety_audit_trail
  FOR SELECT TO authenticated
  USING (
    (
      user_id IS NOT NULL
      AND user_id::text = public.issue_1784_current_request_user_id()
    )
    OR (
      session_id IS NOT NULL
      AND public.issue_1784_session_is_owned(session_id)
    )
  );

CREATE POLICY issue_1784_character_equipment_owner_read
  ON public.character_equipment
  FOR SELECT TO authenticated
  USING (public.issue_1784_character_is_owned(character_id));

CREATE POLICY issue_1784_character_creation_metrics_owner_read
  ON public.character_creation_metrics
  FOR SELECT TO authenticated
  USING (
    (
      user_id IS NOT NULL
      AND user_id::text = public.issue_1784_current_request_user_id()
    )
    OR (
      character_id IS NOT NULL
      AND public.issue_1784_character_is_owned(character_id)
    )
  );

CREATE POLICY issue_1784_character_voice_mappings_owner_read
  ON public.character_voice_mappings
  FOR SELECT TO authenticated
  USING (public.issue_1784_session_is_owned(session_id));

CREATE POLICY issue_1784_character_voice_profiles_owner_read
  ON public.character_voice_profiles
  FOR SELECT TO authenticated
  USING (
    character_id IS NOT NULL
    AND public.issue_1784_character_is_owned(character_id)
  );

CREATE POLICY issue_1784_session_config_owner_read
  ON public.session_config
  FOR SELECT TO authenticated
  USING (public.issue_1784_session_is_owned(session_id));

-- service_role is an internal server credential, not a public client role.
-- Keep its read path explicit for deployments where it does not carry
-- BYPASSRLS by default.
CREATE POLICY issue_1784_safety_audit_trail_service_read
  ON public.safety_audit_trail
  FOR SELECT TO service_role
  USING (true);
CREATE POLICY issue_1784_character_equipment_service_read
  ON public.character_equipment
  FOR SELECT TO service_role
  USING (true);
CREATE POLICY issue_1784_character_creation_metrics_service_read
  ON public.character_creation_metrics
  FOR SELECT TO service_role
  USING (true);
CREATE POLICY issue_1784_character_voice_mappings_service_read
  ON public.character_voice_mappings
  FOR SELECT TO service_role
  USING (true);
CREATE POLICY issue_1784_character_voice_profiles_service_read
  ON public.character_voice_profiles
  FOR SELECT TO service_role
  USING (true);
CREATE POLICY issue_1784_session_config_service_read
  ON public.session_config
  FOR SELECT TO service_role
  USING (true);

-- Record the change when this migration is manually applied after the
-- replacement server paths are deployed.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'applied',
  note text
);

REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (filename, status, note)
VALUES (
  'db/migrations/20260903_lockdown_issue_1784_public_tables.sql',
  'applied',
  'Closed public anon access on the six tables from #1784; authenticated owner reads remain RLS-scoped.'
)
ON CONFLICT (filename) DO NOTHING;
