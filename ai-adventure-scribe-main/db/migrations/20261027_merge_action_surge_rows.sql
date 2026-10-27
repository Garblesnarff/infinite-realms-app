-- Refs #1187. Data only; apply on Rob's line and record the apply (#1703).
--
-- One feature, one row. Action Surge is a level-2 Fighter feature; its second use per rest at
-- fighter level 17 is a uses count, which the engine now derives from the fighter level
-- (`actionSurgeUsesAt`, server-bun/src/services/combat/fighter-features-service.ts). The
-- level-17 library row ("Action Surge (two uses)" from 20251112_06; "Action Surge (2 uses)" if
-- a database took the 20261009 generated spelling) is the same feature a second time, and the
-- level-up grants put both rows on a level-17 sheet.
--
-- Pre-apply check (prod): the rows this removes and the sheets that hold them.
--   SELECT id, feature_name, level_acquired FROM class_features_library
--    WHERE class_name = 'Fighter' AND subclass_name IS NULL AND level_acquired = 17
--      AND feature_name IN ('Action Surge (two uses)', 'Action Surge (2 uses)');
--   SELECT count(*) FROM character_features
--    WHERE feature_id IN (<ids above>);
--
-- character_features.feature_id and feature_usage_log.feature_id cascade on delete, so a sheet's
-- level-17 grant row (and its usage history) goes with the library row. A sheet that holds the
-- level-17 row WITHOUT a level-2 row is given the level-2 row first, with uses_remaining NULL:
-- the engine reads NULL as the full level-keyed count.

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

-- A sheet that held both rows keeps the uses its level-17 row had left (the engine spent that
-- row at level 17, #1181), so the merge costs nobody a use.
UPDATE character_features base_cf
SET uses_remaining = tier_cf.uses_remaining
FROM class_features_library base_lib, character_features tier_cf, class_features_library tier_lib
WHERE base_lib.id = base_cf.feature_id
  AND base_lib.class_name = 'Fighter'
  AND base_lib.subclass_name IS NULL
  AND base_lib.level_acquired = 2
  AND base_lib.feature_name IN ('Action Surge', 'Action Surge (1 use)')
  AND tier_cf.character_id = base_cf.character_id
  AND tier_lib.id = tier_cf.feature_id
  AND tier_lib.class_name = 'Fighter'
  AND tier_lib.subclass_name IS NULL
  AND tier_lib.level_acquired = 17
  AND tier_lib.feature_name IN ('Action Surge (two uses)', 'Action Surge (2 uses)');

DELETE FROM class_features_library
WHERE class_name = 'Fighter'
  AND subclass_name IS NULL
  AND level_acquired = 17
  AND feature_name IN ('Action Surge (two uses)', 'Action Surge (2 uses)');
