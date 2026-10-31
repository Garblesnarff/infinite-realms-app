-- Refs #1225. Data only; apply on Rob's line and record the apply (#1703).
--
-- The generated SRD seed (supabase/migrations/20261009_seed_srd_class_features.sql) could read a
-- feature's use count only from a "(N uses)" name suffix, so these limited features landed with
-- uses_count NULL. The engine no longer spends a NULL-count limited feature as unlimited (#1225:
-- it counts it by shared/limited-feature-counts.ts or refuses it), but the library row should
-- still carry the PHB count, so the generic rest restore and any reader of uses_count agree.
--
-- Only the counts that never change with level or an ability score are written here. Counts
-- keyed to level or ability (Rage, Ki, Font of Magic, Bardic Inspiration, Wild Shape, War Priest,
-- Cleansing Touch, Lay on Hands, Divine Sense) stay NULL and come from the engine's table.
-- scripts/generate-class-features-seed.ts now writes the same counts, so a re-generation keeps
-- them. Each UPDATE touches only a generated row (by its deterministic id) that is still NULL;
-- on a database where the legacy 20251112_06 row won the dedupe, the generated row does not
-- exist and the UPDATE changes nothing.
--
-- The second block fixes the rest tag on the generated rows whose tag disagrees with the PHB (the
-- engine's table): Arcane Recovery comes back on a long rest (its description says "once per day
-- when you finish a short rest"), and Bardic Inspiration recharges on a short rest from 5th level
-- (Font of Inspiration). The rest refill already reads the engine's table, not this tag; the tag
-- is fixed so the generic restore and any reader of uses_per_rest agree.
--
-- Pre-apply check (prod): the rows this changes.
--   SELECT id, class_name, feature_name, uses_count, uses_per_rest FROM class_features_library
--    WHERE id IN (<ids below>);

-- Cleric / Channel Divinity (1/rest) (level 2): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '01c05068-859f-072c-023e-4e5c6df93660' AND uses_count IS NULL;
-- Cleric / Channel Divinity (2/rest) (level 6): 2
UPDATE class_features_library SET uses_count = 2 WHERE id = 'a30ef604-505d-514b-7e0e-f67d7f830bef' AND uses_count IS NULL;
-- Cleric / Divine Intervention (level 10): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '8462032f-9577-24dd-309d-6dbd02bf501e' AND uses_count IS NULL;
-- Cleric / Channel Divinity (3/rest) (level 18): 3
UPDATE class_features_library SET uses_count = 3 WHERE id = '1b4ef597-f815-f407-8271-46d08f261379' AND uses_count IS NULL;
-- Fighter / Second Wind (level 1): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = 'a43cba29-7da0-5840-c801-28b7ddb889de' AND uses_count IS NULL;
-- Paladin / Channel Divinity (level 3): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '1e7c730c-196b-f27e-7537-de2e2d6e9ec5' AND uses_count IS NULL;
-- Rogue / Stroke of Luck (level 20): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = 'b228785f-3e74-9c18-f9c6-251fec824ac2' AND uses_count IS NULL;
-- Warlock / Mystic Arcanum (6th level) (level 11): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '769d551f-b805-26fe-3549-cc06d725f3f1' AND uses_count IS NULL;
-- Warlock / Mystic Arcanum (7th level) (level 13): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '823f89e2-d156-9384-dbdb-673d307901bc' AND uses_count IS NULL;
-- Warlock / Mystic Arcanum (8th level) (level 15): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = 'c18ab5f5-5401-b3bf-3630-066e0997a0d3' AND uses_count IS NULL;
-- Warlock / Mystic Arcanum (9th level) (level 17): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '1b87b22e-3f77-88f4-fd41-1f8e25d3aff8' AND uses_count IS NULL;
-- Warlock / Eldritch Master (level 20): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '48abfa3d-0004-beae-04e8-88e18a993cea' AND uses_count IS NULL;
-- Wizard / Arcane Recovery (level 1): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = '1b83c4d4-34b0-e359-07fc-a31f8a80907c' AND uses_count IS NULL;
-- Wizard / Signature Spell (level 20): 2
UPDATE class_features_library SET uses_count = 2 WHERE id = 'a945a785-1278-4730-ad39-ae1c1633264c' AND uses_count IS NULL;
-- Druid / Natural Recovery (level 2): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = 'cff31fcc-cd64-d983-4757-08f3584df6ef' AND uses_count IS NULL;
-- Monk / Wholeness of Body (level 6): 1
UPDATE class_features_library SET uses_count = 1 WHERE id = 'f5a96da1-d1e7-f794-63d1-b91e52484da7' AND uses_count IS NULL;

-- Rest tags (#1225 round 2)
-- Wizard / Arcane Recovery (level 1): short_rest -> long_rest
UPDATE class_features_library SET uses_per_rest = 'long_rest' WHERE id = '1b83c4d4-34b0-e359-07fc-a31f8a80907c' AND uses_per_rest = 'short_rest';
-- Bard / Bardic Inspiration (d8) (level 5): long_rest -> short_rest
UPDATE class_features_library SET uses_per_rest = 'short_rest' WHERE id = '13441da7-00a6-a652-142f-0774dda6c05b' AND uses_per_rest = 'long_rest';
-- Bard / Bardic Inspiration (d10) (level 10): long_rest -> short_rest
UPDATE class_features_library SET uses_per_rest = 'short_rest' WHERE id = 'e8423361-cf63-a558-c249-d429c8cb0f56' AND uses_per_rest = 'long_rest';
-- Bard / Bardic Inspiration (d12) (level 15): long_rest -> short_rest
UPDATE class_features_library SET uses_per_rest = 'short_rest' WHERE id = '68df09f4-5252-3403-af73-5aaa304cd41e' AND uses_per_rest = 'long_rest';
