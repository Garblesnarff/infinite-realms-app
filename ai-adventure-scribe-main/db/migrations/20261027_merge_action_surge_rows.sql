-- Refs #1187. Data only; apply on Rob's line and record the apply (#1703).
--
-- One feature, one row. Action Surge is a level-2 Fighter feature; its second use per rest at
-- fighter level 17 is a uses count, which the engine now derives from the fighter level
-- (`actionSurgeUsesAt`, server-bun/src/services/combat/fighter-features-service.ts). The
-- level-17 library row ("Action Surge (two uses)" from 20251112_06; "Action Surge (2 uses)" if
-- a database took the 20261009 generated spelling) is the same feature a second time, and the
-- level-up grants put both rows on a level-17 sheet.
--
-- Step 1 only: a sheet that holds the level-17 row WITHOUT a level-2 row is given the
-- level-2 row first, with uses_remaining NULL: the engine reads NULL as the full
-- level-keyed count. The row-merge cleanup (carrying the level-17 row's remaining uses
-- onto the level-2 row, then deleting the level-17 library row) is a separate follow-up
-- migration: it needs Rob's approval in its own thread and a separate line before it is
-- applied. Nothing in this file removes rows.

INSERT INTO character_features (character_id, feature_id, uses_remaining, is_active, acquired_at_level)
SELECT DISTINCT held.character_id, base.id, NULL::integer, true, 2
FROM character_features held
JOIN class_features_library tier ON tier.id = held.feature_id
CROSS JOIN LATERAL (
  SELECT lib.id
  FROM class_features_library lib
  WHERE lib.class_name = 'Fighter'
    AND lib.subclass_name IS NULL
    AND lib.level_acquired = 2
    AND lib.feature_name IN ('Action Surge', 'Action Surge (1 use)')
  ORDER BY lib.feature_name
  LIMIT 1
) base
WHERE tier.class_name = 'Fighter'
  AND tier.subclass_name IS NULL
  AND tier.level_acquired = 17
  AND tier.feature_name IN ('Action Surge (two uses)', 'Action Surge (2 uses)')
  AND NOT EXISTS (
    SELECT 1
    FROM character_features own
    JOIN class_features_library ownlib ON ownlib.id = own.feature_id
    WHERE own.character_id = held.character_id
      AND ownlib.class_name = 'Fighter'
      AND ownlib.level_acquired = 2
      AND ownlib.feature_name IN ('Action Surge', 'Action Surge (1 use)')
  );
