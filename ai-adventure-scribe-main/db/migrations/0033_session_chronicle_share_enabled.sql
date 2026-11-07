ALTER TABLE "session_chronicles" ADD COLUMN "share_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "session_chronicles" SET "share_enabled" = true WHERE "share_token" IS NOT NULL;
