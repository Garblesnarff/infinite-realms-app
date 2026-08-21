-- #1871: combat_participants.armor_class used NOT NULL DEFAULT 10 as "unset".
-- AC 10 is a legal unarmored value (DEX 10, no armour). The default collided with
-- that value and combat-attack-service silently rewrote it to generic AC 12.
--
-- Unset is now NULL. Existing rows are left as stored, including real 10s —
-- do not backfill 10 -> NULL.

ALTER TABLE public.combat_participants
  ALTER COLUMN armor_class DROP DEFAULT,
  ALTER COLUMN armor_class DROP NOT NULL;
