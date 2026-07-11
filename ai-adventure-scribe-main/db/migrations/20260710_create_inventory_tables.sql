CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name text NOT NULL,
  item_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  weight numeric(5,2) DEFAULT 0,
  description text,
  properties text,
  is_equipped boolean NOT NULL DEFAULT false,
  is_attuned boolean NOT NULL DEFAULT false,
  requires_attunement boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory_items(character_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item_type ON inventory_items(character_id, item_type);

CREATE TABLE IF NOT EXISTS consumable_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_used integer NOT NULL DEFAULT 1,
  session_id uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  context text,
  "timestamp" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consumable_usage_character ON consumable_usage_log(character_id);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_item ON consumable_usage_log(item_id);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_session ON consumable_usage_log(session_id);
CREATE INDEX IF NOT EXISTS idx_consumable_usage_timestamp ON consumable_usage_log("timestamp");

GRANT SELECT, INSERT, UPDATE ON inventory_items TO service_role;
GRANT SELECT, INSERT, UPDATE ON consumable_usage_log TO service_role;
GRANT SELECT, INSERT, UPDATE ON starter_character_templates TO service_role;
GRANT SELECT, INSERT, UPDATE ON character_stats TO service_role;
GRANT SELECT, INSERT, UPDATE ON character_equipment TO service_role;
