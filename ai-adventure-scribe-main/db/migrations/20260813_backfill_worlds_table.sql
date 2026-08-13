-- Backfill for public.worlds, which no committed migration has ever created.
--
-- Found while writing 20260813_revoke_anon_access_round_2.sql (#1760): that
-- migration's REVOKE failed the from-scratch replay with
-- `relation "public.worlds" does not exist`, because worlds is one of the
-- objects made directly through the Supabase dashboard and never captured as a
-- migration. It is not modeled in db/schema/*.ts either, so neither drizzle nor
-- 0004_snapshot.json can supply its shape.
--
-- db/migrations/.replay-known-gaps is explicit that a newly written migration
-- must never be added to it -- "either the migration is wrong or it depends on
-- an object that also needs a migration, write that one too". This is that
-- migration.
--
-- Shape taken from `pg_dump --schema-only -t public.worlds` run against
-- production on 2026-08-13, the same method and the same reasoning used by
-- 20251113_backfill_campaign_characters_and_metrics.sql and
-- 20251210_backfill_starter_character_templates.sql: for a dashboard-created
-- object, production is the only trustworthy source of truth.
--
-- Every statement is guarded so this is a no-op against production, where the
-- table already exists. It carries no data: worlds holds 0 rows in production,
-- so there is nothing to seed.
--
-- The policy below is reproduced exactly as production has it. Note it is
-- inert: worlds has relrowsecurity = false, so the policy never fires. It is
-- included for replay fidelity, not as a security control -- and it is one of
-- the six "policies that read as protection and provide none" catalogued in
-- #1760. Deciding its fate belongs to the RLS-strategy task in #1703, not here.

CREATE TABLE IF NOT EXISTS public.worlds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    name text NOT NULL,
    description text,
    climate_type text,
    magic_level text,
    technology_level text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'worlds_pkey' AND conrelid = 'public.worlds'::regclass
  ) THEN
    ALTER TABLE ONLY public.worlds ADD CONSTRAINT worlds_pkey PRIMARY KEY (id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_worlds_campaign ON public.worlds USING btree (campaign_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'worlds_campaign_id_fkey' AND conrelid = 'public.worlds'::regclass
  ) THEN
    ALTER TABLE ONLY public.worlds
      ADD CONSTRAINT worlds_campaign_id_fkey FOREIGN KEY (campaign_id)
      REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'worlds' AND policyname = 'Users can manage worlds'
  ) THEN
    CREATE POLICY "Users can manage worlds" ON public.worlds USING (true) WITH CHECK (true);
  END IF;
END
$$;
