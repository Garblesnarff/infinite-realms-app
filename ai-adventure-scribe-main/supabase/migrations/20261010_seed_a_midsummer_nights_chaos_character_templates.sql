-- Starter character templates for A Midsummer Night's Chaos (5 characters).
-- Converted from campaign-art/a-midsummer-nights-chaos/seed-starter-character-templates.sql
-- to the re-runnable upsert form (#222), following
-- 20260930_seed_journey_to_the_inner_world_character_templates.sql:
-- ON CONFLICT upsert on unique_template_per_campaign (starter_campaign_id, template_key).
-- Each row is INSERT ... SELECT FROM starter_campaigns: a no-op where the campaign row is missing
-- (fresh replay), an upsert where it exists. The campaign row itself is created by the
-- reingest-starter-campaigns.ts path (a-midsummer-nights-chaos is in its campaign list).
-- No portrait_url: the asset uploader sets it.
-- Classes are SRD only (starter seeding rejects non-SRD classes). Races use the app's names.
--
-- APPLY ORDER (Hetzner): this SQL is a no-op until the campaign row exists, and
-- migrations do not re-run. Exact order:
--   1. bun scripts/reingest-starter-campaigns.ts --repo-path <infinite-realms-clean> --apply
--      (creates the a-midsummer-nights-chaos campaign row; dry-run first)
--   2. Apply this migration (supabase migration replay, or psql -f).
-- Running step 2 on prod needs Rob's line. If step 1 has not run, this file
-- inserts zero rows and a later replay is required.

-- 1. The Thespian (Human Bard)
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
  'the-thespian',
  'The Thespian',
  'Bit-player actor in way over his head',
  'Human',
  NULL,
  'Bard',
  'Entertainer',
  1,
  '{"strength": 10, "dexterity": 14, "constitution": 12, "intelligence": 12, "wisdom": 10, "charisma": 16}',
  '{"traits": ["The show must go on — I never break character", "I narrate my own life in stage directions"], "ideals": ["Beauty. Art makes the world better than it was"], "bonds": ["My troupe is my family; I will do anything to get them home safe"], "flaws": ["I cannot resist an audience, even a dangerous one"]}',
  '["acrobatics", "deception", "performance", "persuasion"]',
  '["Common", "Elvish"]',
  '["rapier", "lute", "diplomat''s pack", "leather armor", "costume", "play script", "stage paint"]',
  'I was third spear-carrier from the left in the mechanicals'' troupe — twelve years of fetching props, painting flats, and dreaming of the day Quince would finally give me a line. On the way to rehearsal in the woods I took a wrong turn past the old mushroom ring, and the forest... changed. The trees started watching. A horned imp offered me a vial of something pink and called me "the lead." I have been improvising ever since.',
  'The Duke''s wedding needs its entertainment, the mechanicals need their star, and Puck keeps rewriting my scenes. Someone has to make sure this play ends with applause instead of a funeral — and nobody knows stagecraft like me.',
  'Bashful human actor in a patched Elizabethan doublet, holding a wooden prop sword, half in costume as a romantic lead, stage paint smudged on his cheek, nervous hopeful grin, dark fae forest with hanging silver lanterns behind him, moody atmospheric digital painting, deep blue-black shadows, silver moonlight, enchanting and dangerous, no text',
  1
FROM public.starter_campaigns
WHERE id = 'a-midsummer-nights-chaos'
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

-- 2. The Lovesick (Half-Elf Sorcerer)
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
  'the-lovesick',
  'The Lovesick',
  'Dosed with love potion; the magic woke up',
  'Half-Elf',
  NULL,
  'Sorcerer',
  'Noble',
  1,
  '{"strength": 8, "dexterity": 14, "constitution": 14, "intelligence": 12, "wisdom": 10, "charisma": 16}',
  '{"traits": ["I fall dramatically in and out of love at inconvenient moments", "I describe everything as though it were a ballad"], "ideals": ["Love. It is the only magic that matters — I would know"], "bonds": ["I owe a badger a sincere apology"], "flaws": ["I trust anyone who speaks beautifully, no matter what they are selling"]}',
  '["history", "persuasion", "arcana", "deception"]',
  '["Common", "Elvish", "Sylvan"]',
  '["light crossbow", "component pouch", "fine clothes", "signet ring", "unsent love letter", "perfumed handkerchief"]',
  'I came to Athens for the Duke''s wedding — a minor noble''s third child, invited out of obligation, hoping to catch someone''s eye across the feast. In the forest I drank from a spring a flower had fallen into. I woke up in love with the first thing I saw (a badger — we have talked it through, we are better as friends) and with magic crackling at my fingertips that was not there yesterday. The sorcery, apparently, was always in the blood. The potion just... uncorked it.',
  'The love juice is still in my veins, and it is doing things to my magic nobody can predict. If I can find who brewed it, maybe I can get answers — and keep it from happening to anyone else. Also, I owe the badger an apology.',
  'Dreamy-eyed half-elf noble in rumpled wedding-guest finery, flower petals stuck in their hair, faint pink magical glow crackling at their fingertips, lovesick distracted smile, dark fae forest with hanging silver lanterns behind them, moody atmospheric digital painting, deep blue-black shadows, silver moonlight, enchanting and dangerous, no text',
  2
FROM public.starter_campaigns
WHERE id = 'a-midsummer-nights-chaos'
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

-- 3. The Woodsman (Wood Elf Ranger)
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
  'the-woodsman',
  'The Woodsman',
  'Knows every path; fears what walks them now',
  'Elf',
  'Wood Elf',
  'Ranger',
  'Outlander',
  1,
  '{"strength": 12, "dexterity": 16, "constitution": 12, "intelligence": 10, "wisdom": 14, "charisma": 10}',
  '{"traits": ["I leave milk at every fairy ring I pass, out of habit and terror", "I talk to trees; they are better listeners than people"], "ideals": ["Nature. The forest provides, and the forest punishes"], "bonds": ["These woods raised me; I will not abandon them to chaos"], "flaws": ["I would rather face a bear than attend a party"]}',
  '["athletics", "nature", "perception", "survival"]',
  '["Common", "Elvish", "Sylvan"]',
  '["longbow", "quiver with 20 arrows", "two shortswords", "leather armor", "explorer''s pack", "hunting trap", "small vial of milk (fae offering)"]',
  'Twenty years I have kept the Duke''s forest — marked the trails, culled the wolves, and learned exactly which clearings to never enter after dark. I knew the rules: leave milk at the ring, do not follow the music, never thank them. Then the rules stopped working. Paths I marked yesterday lead somewhere else today. The milk is untouched and the music is everywhere. Whatever the fair folk are fighting about, it is spilling onto my paths.',
  'Travelers are going missing between Athens and the wedding, and I am the only one who can still read this forest — barely. Someone has to walk people through safely, and the fae will not bargain with just anyone. They respect a forester. Mostly.',
  'Grizzled wood elf forester in worn green-grey leathers, longbow over shoulder, wary eyes scanning the dark, a small vial of milk tied at his belt as a fae offering, moonlit forest with hanging silver lanterns behind him, moody atmospheric digital painting, deep blue-black shadows, silver moonlight, enchanting and dangerous, no text',
  3
FROM public.starter_campaigns
WHERE id = 'a-midsummer-nights-chaos'
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

-- 4. The Runaway (Lightfoot Halfling Rogue)
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
  'the-runaway',
  'The Runaway',
  'Fled a wedding, found a weirder one',
  'Halfling',
  'Lightfoot',
  'Rogue',
  'Urchin',
  1,
  '{"strength": 8, "dexterity": 16, "constitution": 12, "intelligence": 12, "wisdom": 12, "charisma": 14}',
  '{"traits": ["I have never met a locked door I respected", "I collect other people''s wedding rings (one so far, and it was mine)"], "ideals": ["Freedom. No one chooses my life but me"], "bonds": ["My mother''s shortbow is the only family I still claim"], "flaws": ["I run from commitment the way others run from fire"]}',
  '["acrobatics", "perception", "sleight_of_hand", "stealth"]',
  '["Common", "Halfling", "Thieves'' Cant"]',
  '["shortsword", "shortbow", "leather armor", "thieves'' tools", "burglar''s pack", "stolen wedding ring on a cord"]',
  'My father arranged my marriage to a miller''s son with forty acres and the personality of damp flour. So I climbed out the window on the wedding eve with a stolen ring, my mother''s shortbow, and no plan. The forest was supposed to be safer than home. It is not. There are donkey-headed men rehearsing plays, lovers chasing each other in circles, and a very polite imp who keeps offering me drinks I absolutely should not accept.',
  'Athens wants me back in chains — or a veil. The forest wants me as a punchline. But I have learned every hiding spot between here and the city, and if anyone is going to smuggle people past both the Duke''s guards and the fae courts, it is the girl nobody has managed to catch yet.',
  'Quick-eyed halfling girl with a stolen gold wedding ring on a cord around her neck, shortbow in hand, hood half up, mischievous defiant grin, darting through a moonlit forest with hanging silver lanterns, moody atmospheric digital painting, deep blue-black shadows, silver moonlight, enchanting and dangerous, no text',
  4
FROM public.starter_campaigns
WHERE id = 'a-midsummer-nights-chaos'
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

-- 5. The Hedgewitch (Forest Gnome Druid)
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
  'the-hedgewitch',
  'The Hedgewitch',
  'The forest''s edge is her pharmacy',
  'Gnome',
  'Forest Gnome',
  'Druid',
  'Hermit',
  1,
  '{"strength": 8, "dexterity": 12, "constitution": 14, "intelligence": 12, "wisdom": 16, "charisma": 10}',
  '{"traits": ["I diagnose everyone I meet, invited or not", "I name my poultices after the people they saved"], "ideals": ["Balance. Every remedy has its poison; every poison its remedy"], "bonds": ["My cottage garden is the work of forty years; I will not see it trampled"], "flaws": ["I lecture. At length. During emergencies."]}',
  '["medicine", "religion", "arcana", "nature"]',
  '["Common", "Gnomish", "Druidic", "Sylvan"]',
  '["quarterstaff", "herbalism kit", "leather armor", "explorer''s pack", "druidic focus (sprig of mistletoe)", "assorted poultices"]',
  'I keep a cottage at the forest''s edge where the villagers come for poultices, teas, and advice they pretend not to need. I know every herb, every mushroom, every flower — including the small purple one with the heart-shaped petals that only blooms when the fae are feuding. It is blooming everywhere this season, out of cycle, in impossible quantities. I have seen this flower''s work before. It never ends with anyone happy.',
  'Someone is weaponizing love itself, and the forest is drowning in it. I can brew the antidote — I think — but I need the uncorrupted heart of the bloom, and that only grows where the courts'' magic runs thinnest. Which means going in. Which means I need people I trust at my back.',
  'Wrinkled forest gnome herbalist with a basket of glowing purple heart-petaled flowers, shawl of moss and feathers, knowing stern eyes, hanging herb charms around her, at the moonlit edge of a dark fae forest with silver lanterns, moody atmospheric digital painting, deep blue-black shadows, silver moonlight, enchanting and dangerous, no text',
  5
FROM public.starter_campaigns
WHERE id = 'a-midsummer-nights-chaos'
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
