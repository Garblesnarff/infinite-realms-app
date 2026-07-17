ALTER TABLE combat_participants
  ADD COLUMN IF NOT EXISTS resources_round integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS action_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bonus_action_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reaction_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_dodging boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_disengaged boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_combat_participants_current_turn
  ON combat_participants(encounter_id, turn_order, is_active);
