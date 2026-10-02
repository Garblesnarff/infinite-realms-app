-- Reset The Exile (Abyssal Descent) to the seed's Ranger sheet, 2014 rules. Issue #2483.
--
-- Production has this template as a Druid (Hetzner, on #2483; #2150/#2140 audits saw Druid
-- characters made from it, and #1915 recorded it with short uppercase ability keys on
-- 2026-08-26), while 20260103_seed_starter_character_templates.sql seeds an Elf (Drow) Ranger.
-- Rob's decision on #2483 is that The Exile is a Ranger. No migration, script or code in the
-- repo writes a template's class or skills (scripts/upload-campaign-assets.ts sets portrait_url
-- and card_image_url only), so the Druid row came from outside the repo history.
--
-- The values are the seed's, except skills, which carry the 2014 fix of
-- 20261001_fix_premade_skill_proficiencies_2014.sql (Outlander also grants Athletics). A level 1
-- Ranger has no spellcasting in 2014 5e; the seeder derives that from class and level, so no
-- spell data belongs on the row. Ability scores use the long lowercase keys the other
-- Abyssal Descent rows use.
--
-- Updates an existing production row: applied only on Rob's typed line.
-- portrait_url, card_image_url and display_order are left as they are in production.
-- Re-runnable (upsert on unique_template_per_campaign). Where starter_campaigns has no
-- abyssal-descent row (fresh replay) the SELECT returns nothing and no row is written.
-- Characters already created from the Druid row are copies and are not touched.

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
  portrait_prompt
) SELECT
  id,
  'the-exile',
  'The Exile',
  'Drow who rejected cruelty, at home in darkness',
  'Elf',
  'Drow',
  'Ranger',
  'Outlander',
  1,
  '{"strength": 10, "dexterity": 18, "constitution": 12, "intelligence": 12, "wisdom": 14, "charisma": 10}',
  '{"traits": ["I feel more comfortable in darkness than in light", "I''m always looking for escape routes"], "ideals": ["All people deserve to be treated with dignity"], "bonds": ["I seek to redeem myself by helping others escape the darkness I once served"], "flaws": ["I trust no one from my homeland"]}',
  '["perception", "stealth", "nature", "survival", "athletics"]',
  '["Common", "Elvish", "Undercommon", "Deep Speech"]',
  '["hand crossbow", "rapier", "leather armor", "dark cloak", "underground survival kit", "Underdark navigation tools"]',
  'In Velkynvelve, kindness is weakness. I learned to survive—to play the games, to betray before being betrayed. But when I was ordered to lead surface-dwellers into an ambush for sacrifice to Lolth, I couldn''t. They called it treason. I called it a soul I didn''t know I still had. I fled to the surface, where the sun burns and everyone sees my skin and assumes the worst. They''re not entirely wrong to fear drow. But they''re wrong about me. The Valdris tunnels reach deep—deep enough to touch Underdark territory. Whatever broke through may be something my people know.',
  'The reports describe tunnels that connect to the deep places—my homeland. The creatures emerging bear the marks of something older than even drow civilization. I know these depths. I know their dangers. And I know that if something down there has awakened, surface-dwellers will need a guide who doesn''t flinch at what lurks in darkness.',
  'Dark elf with obsidian skin and stark white hair, wary defensive posture, hood drawn up to shield from any light, hand crossbow ready at hip, eyes that have seen cruelty and rejected it, comfortable in the shadows of a deep cave entrance, dramatic chiaroscuro lighting, dark fantasy survival style'
FROM public.starter_campaigns
WHERE id = 'abyssal-descent'
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
  portrait_prompt = EXCLUDED.portrait_prompt;
