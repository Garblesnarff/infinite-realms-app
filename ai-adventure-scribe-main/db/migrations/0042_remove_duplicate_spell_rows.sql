-- #1803: remove the two retired duplicate spell rows and their class_spells links.
-- Canonical ids stay: Hideous Laughter 49679c17-4b59-5e1b-b9a2-8ed2f53f209e (Bard + Wizard) and Floating
-- Disk 14bccb17-1728-5095-ab6a-35b28812c6b7 (Wizard). Retired: Tasha's Hideous Laughter 2f531b61-5626-5b7b-a9f9-bf935e580864
-- (Bard) and Tenser's Floating Disk ce62cea7-640b-5439-a175-10289409f59b (Wizard).
--
-- Prod data: Hetzner verified on #254 (comment 7209639615) that no character_spells
-- row references either retired id, so no character_spells cleanup is needed. The
-- character_spells -> spells FK is ON DELETE CASCADE, so this migration relies on
-- that verified-0 precondition: re-check the count is still 0 immediately before
-- applying (Hetzner does this on Rob's typed line; #1703 records the apply).
-- This PR only writes the migration. It is NOT applied here.
DELETE FROM "class_spells" WHERE "spell_id" IN ('2f531b61-5626-5b7b-a9f9-bf935e580864', 'ce62cea7-640b-5439-a175-10289409f59b');
--> statement-breakpoint
DELETE FROM "spells" WHERE "id" IN ('2f531b61-5626-5b7b-a9f9-bf935e580864', 'ce62cea7-640b-5439-a175-10289409f59b');
--> statement-breakpoint
