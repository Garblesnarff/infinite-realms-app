-- #1707 Group 1 / #1760 follow-up.
--
-- APPLY AFTER THE SERVER/FRONTEND CODE DEPLOY.
-- The code in this change must be live and the authenticated combat persistence/status smoke
-- pass must be green before this file is applied. Applying it first removes the browser's
-- direct table grants before the replacement routes are available.
--
-- The split analysis on #1760 found that these four tables are the browser persistence surface
-- moved by Group 1. roll_history and combat_damage_log remain out of this revoke: their browser
-- writers are independent paths and are not covered by the persistence.ts replacement.
--
-- service_role is intentionally not named. The server's existing grants remain intact.

REVOKE ALL PRIVILEGES ON TABLE public.combat_encounters FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.combat_participants FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.combat_participant_status FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.combat_participant_conditions FROM anon, authenticated;

-- Production already has this ledger from #1703. Keep the migration replayable in a fresh
-- database too, without relying on an out-of-band production-only object.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'applied',
  note text
);

REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM anon, authenticated;

INSERT INTO public.schema_migrations (filename, status, note)
VALUES (
  'db/migrations/20260814_revoke_combat_anon_access.sql',
  'applied',
  'Applied after #1707 Group 1 server-route deployment; revoked browser grants for four combat persistence tables.'
)
ON CONFLICT (filename) DO NOTHING;
