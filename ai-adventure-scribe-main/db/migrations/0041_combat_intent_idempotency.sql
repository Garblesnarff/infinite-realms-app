CREATE TABLE "combat_intent_idempotency" (
	"encounter_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"claim_token" uuid NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combat_intent_idempotency_encounter_id_request_id_pk" PRIMARY KEY("encounter_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "combat_intent_idempotency" ADD CONSTRAINT "combat_intent_idempotency_encounter_id_combat_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."combat_encounters"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "combat_intent_idempotency" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "combat_intent_idempotency" FROM anon, authenticated;
--> statement-breakpoint
-- Combat intent idempotency rows are server-only: the API server uses a
-- privileged role, and no client role may read or write them directly.
