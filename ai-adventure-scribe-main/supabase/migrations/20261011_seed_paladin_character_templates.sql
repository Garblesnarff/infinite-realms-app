-- Starter character template: Paladin premade for Academy of Arcane Gastronomy (#317).
-- Follows 20260929_seed_*_character_templates.sql. Re-runnable: ON CONFLICT upsert on
-- unique_template_per_campaign (starter_campaign_id, template_key).
-- Each row is INSERT ... SELECT FROM starter_campaigns: a no-op where the campaign row is missing
-- (fresh replay), an upsert where it exists. No portrait_url: the asset uploader sets it.
-- Class is SRD only (starter seeding rejects non-SRD classes). Races use the app's names.
-- Level 1 Paladin has no spellcasting (2014 PHB): no slots, no spells on the seed. Lay on Hands
-- is a class feature, not a spell, and comes from the class data.

-- The Oathbound (Human Paladin) - Academy of Arcane Gastronomy
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
  subrace,
  class,
  background,
  level,
  ability_scores,
  personality,
  skills,
  languages,
  equipment,
  adapted_backstory,
  campaign_hook,
  portrait_prompt,
  display_order
) SELECT
  id,
  'the-oathbound',
  'The Oathbound',
  'Oath-sworn protector who believes no one should go hungry',
  'Human',
  NULL,
  'Paladin',
  'Acolyte',
  1,
  '{"strength": 16, "dexterity": 10, "constitution": 14, "intelligence": 10, "wisdom": 12, "charisma": 14}',
  '{"traits": ["I bless every meal before it is served", "I speak plainly; oaths leave no room for riddles"], "ideals": ["Charity. A full belly and a safe hearth are the foundation of every good oath"], "bonds": ["The hospice that raised me still writes; I send every spare coin home"], "flaws": ["I cannot turn away from someone in need, even when the need is a trap"]}',
  '["insight", "religion", "athletics", "persuasion"]',
  '["Common"]',
  '["chain mail", "longsword", "shield", "holy symbol", "priest''s pack"]',
  'I was raised in the Hospice of the Gilded Ladle, where the sisters taught me that an oath sworn on an empty stomach is just noise. I took my vows before the altar of the Hearthkeeper: to shield the helpless and to feed the hungry, in that order, though I have never been good at keeping the order. When I heard of a school where cooking itself is a kind of magic, I knew the Hearthkeeper was pointing me there. A paladin who can cook for a hundred is worth ten who can only swing a sword.',
  'The Academy kitchens feed hundreds of students and staff, and lately the pantries have been tampered with after dark. The headmistress asked for someone who can both work a kitchen and keep a night watch. I volunteered before she finished asking.',
  'Noble human paladin in gleaming chain mail with a shield bearing a hearth-flame sigil, longsword at the hip, holy symbol on a leather cord, warm kind eyes, standing in a grand magical kitchen with copper pots and floating herbs, morning light through tall windows, cozy epic fantasy art style',
  6
FROM public.starter_campaigns
WHERE id = 'academy-of-arcane-gastronomy'
ON CONFLICT (starter_campaign_id, template_key) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  race = EXCLUDED.race,
  subrace = EXCLUDED.subrace,
  class = EXCLUDED.class,
  background = EXCLUDED.background,
  level = EXCLUDED.level,
  ability_scores = EXCLUDED.ability_scores,
  personality = EXCLUDED.personality,
  skills = EXCLUDED.skills,
  languages = EXCLUDED.languages,
  equipment = EXCLUDED.equipment,
  adapted_backstory = EXCLUDED.adapted_backstory,
  campaign_hook = EXCLUDED.campaign_hook,
  portrait_prompt = EXCLUDED.portrait_prompt,
  display_order = EXCLUDED.display_order,
  updated_at = now();
