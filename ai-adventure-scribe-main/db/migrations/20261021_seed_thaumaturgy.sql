-- Refs #933. Data only; apply on Rob's line and record the apply (#1703).
-- Pre-apply check: SELECT id FROM spells WHERE name = 'Thaumaturgy';
-- A different UUID needs an explicit reference/mapping decision; never overwrite it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM spells WHERE name = 'Thaumaturgy'
    AND id <> '9441a1c1-bf92-4177-9494-39f815ff7f36'::uuid) THEN
    RAISE EXCEPTION 'Thaumaturgy UUID mismatch: inspect SELECT id FROM spells WHERE name = ''Thaumaturgy'' before applying #933';
  END IF;
END $$;

INSERT INTO spells (id, name, level, school, casting_time, range_text, duration, description, components_verbal, components_somatic, components_material, concentration, ritual) VALUES ('9441a1c1-bf92-4177-9494-39f815ff7f36','Thaumaturgy',0,'Transmutation','1 action','30 feet','1 minute','You manifest a minor wonder, a sign of supernatural power, within range. You create one of the following magical effects within range.

- Your voice booms up to three times as loud as normal for 1 minute.

- You cause flames to flicker, brighten, dim, or change color for 1 minute.

- You cause harmless tremors in the ground for 1 minute.

- You create an instantaneous sound that originates from a point of your choice within range, such as a rumble of thunder, the cry of a raven, or ominous whispers.

- You instantaneously cause an unlocked door or window to fly open or slam shut.

- You alter the appearance of your eyes for 1 minute.

If you cast this spell multiple times, you can have up to three of its 1-minute effects active at a time, and you can dismiss such an effect as an action.',true,false,false,false,false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO class_spells (class_id, spell_id, spell_level, source_feature)
SELECT c.id, s.id, 0, 'base' FROM classes c CROSS JOIN spells s
WHERE lower(c.name) = 'cleric' AND s.name = 'Thaumaturgy'
AND NOT EXISTS (SELECT 1 FROM class_spells cs WHERE cs.class_id = c.id AND cs.spell_id = s.id);
