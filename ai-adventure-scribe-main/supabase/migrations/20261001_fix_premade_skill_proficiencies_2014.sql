-- Premade skill proficiencies, corrected to 2014 5e (SRD 5.1 / PHB) rules. Issue #2483.
--
-- Audit of every premade in the seed migrations (20260103, 20260117, 20260929 x3, 20260930):
-- these seven rows break the 2014 rule "a background always grants its two skills, and a class
-- picks no more than its allowance". The skills column is the character's stored skill
-- proficiencies, so each error reaches the sheet.
--
-- Rows not listed here follow the rule (several choose fewer class skills than the class
-- allows; that is under-allocation, not an error, and is left alone).
--
-- Data-only and re-runnable: each UPDATE sets the final value, so a second run changes nothing.
-- Each UPDATE also requires the class the seed gave the row, so a row whose class was changed
-- by hand in production is not touched. Where a row is missing (fresh replay: the
-- starter_campaigns rows are not migrated) the UPDATE matches nothing.
--
-- Existing characters already created from these templates keep the skills they were given.

-- The Exile (Elf Drow Ranger, Outlander): Outlander also grants Athletics.
UPDATE public.starter_character_templates
SET skills = '["perception", "stealth", "nature", "survival", "athletics"]'
WHERE starter_campaign_id = 'abyssal-descent'
  AND template_key = 'the-exile'
  AND class = 'Ranger';

-- The Tracker (Human Ranger, Outlander): Outlander also grants Athletics.
UPDATE public.starter_character_templates
SET skills = '["survival", "perception", "stealth", "nature", "athletics"]'
WHERE starter_campaign_id = 'curse-of-the-jersey-devil'
  AND template_key = 'the-tracker'
  AND class = 'Ranger';

-- The Furnace-Born (Half-Orc Fighter, Folk Hero): Folk Hero also grants Animal Handling.
UPDATE public.starter_character_templates
SET skills = '["athletics", "intimidation", "survival", "perception", "animal_handling"]'
WHERE starter_campaign_id = 'curse-of-the-jersey-devil'
  AND template_key = 'the-furnace-born'
  AND class = 'Fighter';

-- The Storyteller (Half-Elf Bard, Entertainer): Entertainer also grants Acrobatics.
UPDATE public.starter_character_templates
SET skills = '["history", "performance", "persuasion", "insight", "acrobatics"]'
WHERE starter_campaign_id = 'the-eternal-feast'
  AND template_key = 'the-storyteller'
  AND class = 'Bard';

-- The Cracksman (Halfling Rogue, Criminal): Criminal also grants Deception.
UPDATE public.starter_character_templates
SET skills = '["stealth", "sleight_of_hand", "investigation", "perception", "deception"]'
WHERE starter_campaign_id = 'the-impossible-vault'
  AND template_key = 'the-cracksman'
  AND class = 'Rogue';

-- The Rigger (Hill Dwarf Fighter, Guild Artisan): Guild Artisan grants Insight and Persuasion,
-- and a Fighter picks two class skills, not three. Survival is dropped, Athletics and
-- Perception stay as the two picks.
UPDATE public.starter_character_templates
SET skills = '["athletics", "insight", "perception", "persuasion"]'
WHERE starter_campaign_id = 'wings-of-the-void'
  AND template_key = 'the-rigger'
  AND class = 'Fighter';

-- The Seeker (Catfolk Ranger, Anthropologist): Anthropologist grants Insight and Religion, and a
-- Ranger picks three class skills, not four. Investigation is dropped, Nature, Survival and
-- Perception stay as the three picks.
UPDATE public.starter_character_templates
SET skills = '["nature", "survival", "perception", "insight", "religion"]'
WHERE starter_campaign_id = 'the-eternal-feast'
  AND template_key = 'the-seeker'
  AND class = 'Ranger';
