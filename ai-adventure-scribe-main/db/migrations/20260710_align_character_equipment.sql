-- Aligns character_equipment with db/schema/inventory.ts, which has drifted
-- from prod since the table's original creation (no prior migration recorded
-- these columns). Table had 0 rows at migration time; casts are
-- data-preserving for any future rows anyway.

ALTER TABLE character_equipment
  ADD COLUMN IF NOT EXISTS item_type text DEFAULT 'equipment';

ALTER TABLE character_equipment
  ALTER COLUMN magic_properties TYPE text
  USING array_to_string(magic_properties, ', ');

ALTER TABLE character_equipment
  ALTER COLUMN magic_effects TYPE jsonb
  USING CASE
    WHEN magic_effects IS NULL THEN NULL
    ELSE to_jsonb(magic_effects)
  END;
