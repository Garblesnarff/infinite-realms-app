-- #2058: remember player-provoked NPCs only for the lifetime of an encounter.
ALTER TABLE public.combat_participants
  ADD COLUMN IF NOT EXISTS provoked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.combat_participants.provoked IS
  'Encounter-scoped flag set when player damage makes a non-hostile NPC fight back';
