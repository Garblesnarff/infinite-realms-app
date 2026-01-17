-- Migration: Update Eternal Feast Characters
-- Date: 2026-01-17
-- Purpose:
--   1. Change The Reveler from Elf to Satyr (keeps Barbarian class)
--   2. Change The Seeker from Rogue to Ranger (keeps Catfolk race)
--   3. Add portrait_url to all 5 Eternal Feast characters

-- =============================================================================
-- 1. UPDATE THE REVELER: Elf → Satyr
-- =============================================================================
UPDATE public.starter_character_templates
SET
  race = 'Satyr',
  ability_scores = '{"strength": 14, "dexterity": 14, "constitution": 14, "intelligence": 10, "wisdom": 10, "charisma": 16}',
  skills = '["acrobatics", "performance", "persuasion", "athletics"]',
  languages = '["Common", "Sylvan"]',
  equipment = '["greataxe", "pan pipes", "handaxes", "entertainer''s pack", "fine clothes", "wine flask", "Feywild party favors"]',
  adapted_backstory = 'In the Feywild, we satyrs revel for centuries. Wine, song, dance—endless, eternal. I thought I knew pleasure. Then I visited the mortal realm and met a dying human who showed me more passion in one evening than I''d felt in five hundred years. When they passed, I understood: Limits create meaning. I''ve been chasing that intensity ever since. My hooves have carried me across a dozen realms, and my horns have crowned a thousand celebrations. The Last Course—a place where beings from every realm come to share food, stories, and fleeting connections—is exactly where I need to be. Every meal here is a celebration of mortality''s beautiful urgency.',
  portrait_prompt = 'Wild satyr with curling ram horns and fierce amber eyes full of joy, goat legs with brown fur ending in cloven hooves, bare muscular torso with tribal tattoos, untamed auburn hair with leaves tangled in it, goat-horn drinking cup raised in toast, wearing festive leather vest, surrounded by magical motes of joy and scattered musical notes, vibrant interdimensional restaurant background, whimsical fey style with warm celebratory lighting',
  portrait_url = '/images/characters/eternal-feast/the-reveler.png?v=1'
WHERE starter_campaign_id = 'the-eternal-feast'
  AND template_key = 'the-reveler';

-- =============================================================================
-- 2. UPDATE THE SEEKER: Rogue → Ranger
-- =============================================================================
UPDATE public.starter_character_templates
SET
  class = 'Ranger',
  tagline = 'Insatiably curious tracker of mysteries',
  ability_scores = '{"strength": 10, "dexterity": 16, "constitution": 12, "intelligence": 14, "wisdom": 16, "charisma": 10}',
  skills = '["nature", "survival", "perception", "investigation"]',
  equipment = '["longbow", "quiver with 20 arrows", "shortsword", "leather armor", "journal", "ranger''s pack", "hunting traps", "artifacts from various cultures"]',
  adapted_backstory = 'My people have a saying: "Curiosity is the path to all knowledge." They leave out the part about how many paths lead to death. I left my clan to track the legendary Library of Infinite Shelves—a story, a myth, a truth no one could confirm. My keen senses and natural instincts led me across countless wildernesses, following trails others couldn''t see. Every answer led to three more questions. When I discovered that The Last Course exists in the spaces between dimensions, serving guests from realms beyond imagination, I knew I had found something even greater than a library: a crossroads of all knowledge, where I could track the patterns of existence itself.',
  campaign_hook = 'The Eternal Feast hosts beings from dimensions I''ve only theorized might exist! Every guest leaves traces—scents, auras, patterns of movement—that tell stories words cannot. My ranger''s instincts help me read these trails of existence. Their customs, their foods, their stories—each detail is a thread leading to revelations about the nature of reality itself. I must observe everything, document every interaction, taste every impossible cuisine!',
  portrait_prompt = 'Sleek catfolk with spotted golden fur and impossibly bright curious green eyes, longbow slung across back with nature-themed quiver, ranger''s gear with countless pouches bulging with collected curiosities, leather journal and quill always ready, ears perked forward with intense interest, nose twitching as they catch an exotic scent, interdimensional restaurant background with otherworldly flora, adventure fantasy style with wonder-filled lighting',
  portrait_url = '/images/characters/eternal-feast/the-seeker.png?v=1'
WHERE starter_campaign_id = 'the-eternal-feast'
  AND template_key = 'the-seeker';

-- =============================================================================
-- 3. ADD PORTRAIT URLs TO UNCHANGED CHARACTERS
-- =============================================================================

-- The Storyteller
UPDATE public.starter_character_templates
SET portrait_url = '/images/characters/eternal-feast/the-storyteller.png?v=1'
WHERE starter_campaign_id = 'the-eternal-feast'
  AND template_key = 'the-storyteller';

-- The Faithful
UPDATE public.starter_character_templates
SET portrait_url = '/images/characters/eternal-feast/the-faithful.png?v=1'
WHERE starter_campaign_id = 'the-eternal-feast'
  AND template_key = 'the-faithful';

-- The Lucky One
UPDATE public.starter_character_templates
SET portrait_url = '/images/characters/eternal-feast/the-lucky-one.png?v=1'
WHERE starter_campaign_id = 'the-eternal-feast'
  AND template_key = 'the-lucky-one';
