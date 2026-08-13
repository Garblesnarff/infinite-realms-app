-- #1707 Group 1 last mile / #1760 follow-up.
--
-- APPLY AFTER THE SERVER/FRONTEND CODE DEPLOY.
-- The authenticated damage-log route and rewritten browser caller must be live before this
-- file is applied. It is a sibling of 20260814_revoke_combat_anon_access.sql so the new revoke
-- cannot be hidden behind a schema_migrations row that may already have recorded that file.
--
-- combat_damage_log is now written by the ownership-checked combat persistence route. The
-- roll_history split remains browser-used through RollManager and is intentionally not revoked.
-- service_role is intentionally not named. The server's existing grants remain intact.

REVOKE ALL PRIVILEGES ON TABLE public.combat_damage_log FROM anon, authenticated;

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
  'db/migrations/20260815_revoke_combat_damage_log_anon_access.sql',
  'applied',
  'Applied after the Group 1 damage-log route deployment; revoked browser grants for combat_damage_log.'
)
ON CONFLICT (filename) DO NOTHING;
