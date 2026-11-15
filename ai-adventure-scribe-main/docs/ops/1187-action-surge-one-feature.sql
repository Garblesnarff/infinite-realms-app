-- prod data — Hetzner applies on Rob's line
-- #1187. Not a migration. Do not run this from CI or from a worker.
--
-- Action Surge is one feature. The second use at fighter level 17 is a uses
-- count, which the engine already reads from the fighter level.
--
-- character_features.feature_id and feature_usage_log.feature_id both
-- ON DELETE CASCADE from class_features_library. This script never deletes a
-- character_features row. It re-points a character who holds only the level-17
-- row onto the level-2 row, then deletes the level-17 library row only when
-- nothing still points at it. A character who already holds both rows keeps
-- both user rows; the sheet read collapses them.

WITH base AS (
  SELECT id
  FROM class_features_library
  WHERE class_name = 'Fighter'
    AND subclass_name IS NULL
    AND level_acquired = 2
    AND feature_name IN ('Action Surge', 'Action Surge (1 use)')
  ORDER BY length(feature_name), feature_name
  LIMIT 1
),
tier AS (
  SELECT id
  FROM class_features_library
  WHERE class_name = 'Fighter'
    AND subclass_name IS NULL
    AND level_acquired = 17
    AND feature_name IN ('Action Surge (two uses)', 'Action Surge (2 uses)')
)
UPDATE character_features cf
SET feature_id = base.id
FROM tier, base
WHERE cf.feature_id = tier.id
  AND NOT EXISTS (
    SELECT 1
    FROM character_features own
    WHERE own.character_id = cf.character_id
      AND own.feature_id = base.id
  );

WITH base AS (
  SELECT id
  FROM class_features_library
  WHERE class_name = 'Fighter'
    AND subclass_name IS NULL
    AND level_acquired = 2
    AND feature_name IN ('Action Surge', 'Action Surge (1 use)')
  ORDER BY length(feature_name), feature_name
  LIMIT 1
),
tier AS (
  SELECT id
  FROM class_features_library
  WHERE class_name = 'Fighter'
    AND subclass_name IS NULL
    AND level_acquired = 17
    AND feature_name IN ('Action Surge (two uses)', 'Action Surge (2 uses)')
)
UPDATE feature_usage_log log
SET feature_id = base.id
FROM tier, base
WHERE log.feature_id = tier.id
  AND NOT EXISTS (
    SELECT 1 FROM character_features cf WHERE cf.feature_id = tier.id
  );

DELETE FROM class_features_library tier
WHERE tier.class_name = 'Fighter'
  AND tier.subclass_name IS NULL
  AND tier.level_acquired = 17
  AND tier.feature_name IN ('Action Surge (two uses)', 'Action Surge (2 uses)')
  AND NOT EXISTS (
    SELECT 1 FROM character_features cf WHERE cf.feature_id = tier.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM feature_usage_log log WHERE log.feature_id = tier.id
  );
