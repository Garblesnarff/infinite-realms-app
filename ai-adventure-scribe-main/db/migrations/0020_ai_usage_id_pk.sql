-- #350 FIX round 3: ai_usage needs a stable row id so the deploy smoke can
-- delete exactly the rows its probe turn created (DELETE /v1/llm/usage by id).
--
-- Additive and order-independent. ai_usage is created at runtime by
-- AIUsageService.ensureTable (not by the numbered migrations), and the
-- date-based backfill migration also creates it — so depending on replay
-- order this migration may run before the table exists. It therefore:
--   1. creates the table with the full runtime schema + id if missing;
--   2. adds the id column if the table exists without it (prod case —
--      verified 2026-10-11 that no PK exists on main);
--   3. adds the PK if missing.
-- Later column migrations all use IF NOT EXISTS, so creating the full
-- schema here is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ai_usage'
  ) THEN
    CREATE TABLE "ai_usage" (
      "org_id" text,
      "user_id" text,
      "plan" text,
      "type" text,
      "units" integer NOT NULL,
      "period_start" date NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      "provider" text,
      "model" text,
      "input_tokens" integer,
      "output_tokens" integer,
      "total_tokens" integer,
      "cost_usd" numeric,
      "session_id" text,
      "image_output_tokens" integer,
      "id" serial PRIMARY KEY
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_usage' AND column_name = 'id'
    ) THEN
      ALTER TABLE "ai_usage" ADD COLUMN "id" serial;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ai_usage_pkey' AND conrelid = 'public.ai_usage'::regclass
    ) THEN
      ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id");
    END IF;
  END IF;
END $$;
