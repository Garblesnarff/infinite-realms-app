ALTER TABLE "characters" ADD COLUMN "origin" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "origin" SET DEFAULT 'custom';--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_origin_check" CHECK ("origin" IN ('starter', 'custom', 'import', 'legacy'));
