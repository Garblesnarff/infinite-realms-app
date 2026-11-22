-- Refs #1635. Data only; apply on Rob's line and record the apply (#1703).
--
-- Seed the Half-Orc racial feature "Relentless Endurance" into class_features_library.
-- The engine spends it lazily (server-bun/src/services/combat/relentless-endurance.ts):
-- a character_features row is created on first drop to 0 HP, so no backfill is needed.
-- usage_type is 'passive': the engine applies it when the character drops; a player never
-- "uses" it, so the DM feature gate (dm-feature-gate.ts) does not treat it as a claim to check.
-- uses_per_rest/uses_count still drive the long-rest refill in restoreFeatures.
--
-- Pre-apply check (prod): the row this inserts.
--   SELECT id, class_name, subclass_name, feature_name, level_acquired, usage_type, uses_per_rest, uses_count
--     FROM class_features_library
--    WHERE class_name = 'Half-Orc' AND feature_name = 'Relentless Endurance';

INSERT INTO class_features_library (
  id, class_name, subclass_name, feature_name, level_acquired, description,
  usage_type, uses_per_rest, uses_count
)
SELECT
  '1635e0de-0000-4000-8000-000000001635'::uuid,
  'Half-Orc',
  NULL,
  'Relentless Endurance',
  1,
  'When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead. You can''t use this feature again until you finish a long rest.',
  'passive',
  'long_rest',
  1
WHERE NOT EXISTS (
  SELECT 1 FROM class_features_library
   WHERE class_name = 'Half-Orc' AND feature_name = 'Relentless Endurance'
)
ON CONFLICT (id) DO NOTHING;
