-- Seed data for starter_character_templates
-- Adds 5 pre-built characters for each starter campaign
-- Date: 2026-01-03

-- =============================================================================
-- ABYSSAL DESCENT CHARACTERS (Horror/Survival - Underground Expedition)
-- =============================================================================

-- 1. The Veteran (Human Fighter) - Abyssal Descent
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'abyssal-descent',
  'the-veteran',
  'The Veteran',
  'Seasoned soldier haunted by past battles',
  'Human',
  'Fighter',
  'Soldier',
  1,
  '{"strength": 16, "dexterity": 12, "constitution": 14, "intelligence": 10, "wisdom": 13, "charisma": 10}',
  '{"traits": ["I can stare down a hellhound without flinching", "I face problems head-on with simple, direct solutions"], "ideals": ["Those who fight beside me are those worth dying for"], "bonds": ["Someone saved my life on the battlefield. I will never leave a companion behind"], "flaws": ["I made a terrible mistake in battle that cost lives. I would do anything to keep that secret"]}',
  '["athletics", "intimidation", "perception", "survival"]',
  '["Common", "Undercommon"]',
  '["longsword", "shield", "chain mail", "light crossbow", "dungeoneer''s pack", "trophy from fallen enemy"]',
  'I served in the Granite Wars for twelve years under Commander Thorne. I''ve seen things that still wake me at night—the fall of Deephold Citadel, the betrayal at Shimmer Pass. When the fighting ended, I couldn''t go home. Home doesn''t exist for people like me anymore. Now I take contracts that lead into dark places, looking for something that might finally let me rest. Maybe in the depths, I''ll find either redemption or an ending.',
  'The whispers about what happened to the Valdris Mining Consortium expedition remind me of Shimmer Pass. I swore I''d never let that happen again—wouldn''t stand by while people disappeared into the dark.',
  'Weathered human warrior in their 40s, salt-and-pepper hair, prominent facial scar across left cheek, worn but well-maintained plate armor with torch-light reflections, thousand-yard stare, underground cavern background with distant eldritch glow, realistic dark fantasy art style, dramatic torchlight',
  1
);

-- 2. The Scholar (Human Wizard) - Abyssal Descent
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'abyssal-descent',
  'the-scholar',
  'The Scholar',
  'Academic obsessed with forbidden knowledge',
  'Human',
  'Wizard',
  'Sage',
  1,
  '{"strength": 8, "dexterity": 12, "constitution": 12, "intelligence": 18, "wisdom": 14, "charisma": 10}',
  '{"traits": ["I use polysyllabic words to convey the impression of great erudition", "I am horribly awkward in social situations"], "ideals": ["Knowledge. The path to power and self-improvement is through knowledge"], "bonds": ["I have an ancient text that holds terrible secrets that must not fall into the wrong hands"], "flaws": ["Unlocking an ancient mystery is worth the price of a civilization"]}',
  '["arcana", "history", "investigation", "religion"]',
  '["Common", "Draconic", "Deep Speech", "Abyssal"]',
  '["quarterstaff", "spellbook", "component pouch", "scholar''s pack", "ink and quill", "research notes on the Abyss"]',
  'I spent fifteen years at the Collegium Arcana, earning my mastery in Planar Studies. My thesis on "Liminal Spaces Between Material and Lower Planes" was well-received in academic circles—too well-received. When rival scholars began competing for the same research, I discovered references to the Valdris Mining Consortium''s findings buried in a classified archive. What they unearthed beneath those mountains shouldn''t be possible according to any established theory. I must see it for myself.',
  'According to my research, the phenomena described in the Valdris reports contradict fundamental laws of planar boundaries. Either our understanding of reality is incomplete, or something has changed. I need to study this phenomenon directly—no matter the cost.',
  'Middle-aged human wizard with spectacles, weathered spellbook clutched protectively, ink-stained fingers, scholarly robes with protective runes sewn into fabric, curious but slightly unhinged expression, small magical light illuminating their face against darkness, lantern-lit cave entrance background, academic fantasy horror style',
  2
);

-- 3. The Hunter (Human Ranger) - Abyssal Descent
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'abyssal-descent',
  'the-hunter',
  'The Hunter',
  'Monster hunter with a personal code',
  'Human',
  'Ranger',
  'Outlander',
  1,
  '{"strength": 14, "dexterity": 16, "constitution": 14, "intelligence": 12, "wisdom": 14, "charisma": 8}',
  '{"traits": ["I watch over my friends as if they were a litter of newborn pups", "I have no patience for sitting still and waiting"], "ideals": ["If I dishonor myself, I dishonor my whole clan"], "bonds": ["My family, clan, or tribe is the most important thing in my life"], "flaws": ["Violence is my answer to almost any challenge"]}',
  '["athletics", "perception", "stealth", "survival"]',
  '["Common", "Undercommon", "Goblin"]',
  '["longbow", "quiver with 20 arrows", "two shortswords", "leather armor", "explorer''s pack", "hunting trap", "trophy from dangerous quarry"]',
  'Started hunting when the creatures from the deep began raiding my village—someone had to protect the survivors. Found I was good at it. Took up the trade professionally. Twenty years, forty-seven confirmed kills, twelve close calls. I''ve learned every monster has a weakness. Finding it is the job. I don''t hunt for sport or cruelty—just necessity. But whatever emerged from beneath the Valdris mines... the survivors'' descriptions don''t match anything in my bestiary. Time to add a new chapter.',
  'The things coming out of those tunnels match the signs of something I''ve only read about in forbidden texts. If it''s really what I think it is... this hunt will either make my name or end it.',
  'Weathered human hunter in practical leather armor, longbow over shoulder, monster tooth necklace, focused calculating expression, scars from past hunts visible on arms, crossbow bolt bandolier across chest, underground passage entrance behind them, gritty survival horror fantasy style',
  3
);

-- 4. The Pact-Bound (Tiefling Warlock) - Abyssal Descent
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'abyssal-descent',
  'the-pact-bound',
  'The Pact-Bound',
  'Made deals for power, comfortable with darkness',
  'Tiefling',
  'Warlock',
  'Haunted One',
  1,
  '{"strength": 8, "dexterity": 14, "constitution": 14, "intelligence": 12, "wisdom": 10, "charisma": 18}',
  '{"traits": ["I don''t run from evil. Evil runs from me", "I put no trust in divine beings"], "ideals": ["I''ll do whatever it takes to survive"], "bonds": ["There is evil in me, but I fight to prevent it from spreading"], "flaws": ["I assume the worst in people"]}',
  '["arcana", "deception", "intimidation", "investigation"]',
  '["Common", "Infernal", "Abyssal"]',
  '["eldritch focus", "leather armor", "light crossbow", "scholar''s pack", "dark ritual components", "patron''s gift"]',
  'I was desperate—dying from a wasting curse with no healer willing to touch a tiefling. The voice came in my dreams, offering power in exchange for service. I accepted. The power is real—I feel it burning in my blood, mixing with the hellfire of my heritage. My patron, something ancient that dwells in the spaces between worlds, asks little... so far. Just small favors. Small glimpses into darkness. The Valdris incident has caught their attention. They want me to see what broke through.',
  'My patron has taken an uncomfortable interest in whatever emerged from the Valdris mines. They''re excited. That''s never good. But when they speak of the rift, I hear something I''ve never detected before: fear. If my patron fears something, I need to understand what it is.',
  'Tiefling warlock with elegant dark horns and glowing eldritch symbols on their forearms, torn between confidence and unease, shadows seeming to move independently around them, patron''s mark visible on palm, underground darkness with distant purple rift-light, dark fantasy horror style, ominous lighting',
  4
);

-- 5. The Exile (Drow Ranger) - Abyssal Descent
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
) VALUES (
  'abyssal-descent',
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
  '["perception", "stealth", "nature", "survival"]',
  '["Common", "Elvish", "Undercommon", "Deep Speech"]',
  '["hand crossbow", "rapier", "leather armor", "dark cloak", "underground survival kit", "Underdark navigation tools"]',
  'In Velkynvelve, kindness is weakness. I learned to survive—to play the games, to betray before being betrayed. But when I was ordered to lead surface-dwellers into an ambush for sacrifice to Lolth, I couldn''t. They called it treason. I called it a soul I didn''t know I still had. I fled to the surface, where the sun burns and everyone sees my skin and assumes the worst. They''re not entirely wrong to fear drow. But they''re wrong about me. The Valdris tunnels reach deep—deep enough to touch Underdark territory. Whatever broke through may be something my people know.',
  'The reports describe tunnels that connect to the deep places—my homeland. The creatures emerging bear the marks of something older than even drow civilization. I know these depths. I know their dangers. And I know that if something down there has awakened, surface-dwellers will need a guide who doesn''t flinch at what lurks in darkness.',
  'Dark elf with obsidian skin and stark white hair, wary defensive posture, hood drawn up to shield from any light, hand crossbow ready at hip, eyes that have seen cruelty and rejected it, comfortable in the shadows of a deep cave entrance, dramatic chiaroscuro lighting, dark fantasy survival style',
  5
);


-- =============================================================================
-- THE ETERNAL FEAST CHARACTERS (Intrigue/Hospitality - Interdimensional Restaurant)
-- =============================================================================

-- 1. The Storyteller (Half-Elf Lore Bard) - The Eternal Feast
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'the-eternal-feast',
  'the-storyteller',
  'The Storyteller',
  'Collector of tales from every realm',
  'Half-Elf',
  'Bard',
  'Entertainer',
  1,
  '{"strength": 8, "dexterity": 14, "constitution": 12, "intelligence": 14, "wisdom": 12, "charisma": 18}',
  '{"traits": ["I know a story relevant to almost every situation", "Nobody stays angry at me for long"], "ideals": ["The right story at the right time can change the world"], "bonds": ["I will do anything to prove myself superior to a rival"], "flaws": ["I can''t resist a good story, even if it means getting into trouble"]}',
  '["history", "performance", "persuasion", "insight"]',
  '["Common", "Elvish", "Sylvan", "Primordial"]',
  '["lute", "rapier", "diplomat''s pack", "leather armor", "journal filled with stories", "costume collection"]',
  'Every person is a story waiting to be told. I''ve spent my life collecting them—the farmer''s quiet tragedy, the king''s secret shame, the soldier''s last words. I carry over three hundred tales, each one a life that matters. When I heard whispers of The Last Course—a restaurant that exists between worlds, serving guests from dimensions beyond imagining—I knew I had found the greatest collection of untold stories in existence. Archons, fey lords, beings of pure concept... each one a narrative never before recorded.',
  'The Eternal Feast represents the intersection of infinite stories—every guest carries tales from realms I''ve never visited, cultures I''ve never encountered. This is where legends are born. I need to be there when history happens across every dimension at once.',
  'Charming half-elf with expressive amber eyes and warm inviting smile, well-worn lute with cosmic motifs, traveling clothes with colorful interdimensional accents, journal bursting with notes tucked in belt, captivating presence, ethereal restaurant interior with impossible architecture background, warm magical lighting, storybook fantasy style',
  1
);

-- 2. The Faithful (Human Cleric) - The Eternal Feast
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'the-eternal-feast',
  'the-faithful',
  'The Faithful',
  'Devoted to service and healing others',
  'Human',
  'Cleric',
  'Acolyte',
  1,
  '{"strength": 14, "dexterity": 10, "constitution": 14, "intelligence": 10, "wisdom": 18, "charisma": 12}',
  '{"traits": ["I always try to help those in need", "I see omens in every event and action"], "ideals": ["Charity. I always try to help those in need"], "bonds": ["I will do anything to protect the temple where I served"], "flaws": ["I judge others harshly, and myself even more severely"]}',
  '["insight", "medicine", "persuasion", "religion"]',
  '["Common", "Celestial", "Elvish"]',
  '["mace", "scale mail", "shield", "holy symbol", "priest''s pack", "prayer book", "hospitality vestments"]',
  'I heard Helm''s call when I was just a kitchen hand at the Temple of the Watchful Eye. Took my vows and served for fifteen years—healing the sick, comforting the dying, ensuring all who entered our doors felt welcome. When the vision came showing me The Last Course—a sanctuary where beings from across all planes could find nourishment and peace—I knew my calling extended beyond any single temple. Hospitality is holy. Food shared is love manifest. This restaurant is a temple to something universal.',
  'The Eternal Feast serves all who enter in peace—regardless of their origin, nature, or form. That sacred hospitality is exactly what Helm stands for: protection and welcome for those who need it. If beings from across the multiverse can find sanctuary here, I will ensure it remains so.',
  'Human cleric in practical holy vestments with hospitality motifs, religious symbol worn as an elegant pendant, kind but perceptive eyes, healing hands ready to serve, server''s apron over chainmail, warm smile welcoming guests, interdimensional restaurant interior with floating candles, reverent yet warm fantasy style',
  2
);

-- 3. The Lucky One (Halfling Trickster) - The Eternal Feast
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'the-eternal-feast',
  'the-lucky-one',
  'The Lucky One',
  'Impossibly lucky optimist who handles any crisis',
  'Halfling',
  'Rogue',
  'Charlatan',
  1,
  '{"strength": 8, "dexterity": 16, "constitution": 12, "intelligence": 12, "wisdom": 10, "charisma": 16}',
  '{"traits": ["I fall in and out of love easily", "Flattery is my preferred trick for getting what I want"], "ideals": ["Independence. I am a free spirit—no one tells me what to do"], "bonds": ["I swindled the wrong person and need to make amends"], "flaws": ["I can''t resist a pretty face"]}',
  '["deception", "sleight_of_hand", "persuasion", "performance"]',
  '["Common", "Halfling", "Thieves'' Cant"]',
  '["shortsword", "shortbow", "leather armor", "thieves'' tools", "fine clothes", "lucky charms", "serving tray"]',
  'Back in Willowdale, they said I was born under a lucky star. Fell off a roof, landed on a hay cart. Cheated a crime boss, he choked on dinner that night. Got caught stealing from a visiting noble, they thought it was so funny they offered me a job instead. I don''t question it anymore. When the door to The Last Course appeared in an alley I was fleeing through, I walked right in. Universe just seems to like me. A restaurant that serves interdimensional beings? Sounds like exactly the kind of chaos I thrive in!',
  'Look, an infinite restaurant with guests from impossible dimensions sounds dangerous, but I''ve got a good feeling about this. I always land on my feet—usually in exactly the right place. When have I ever been wrong? Don''t answer that. The point is, someone needs to charm the difficult customers and smooth over diplomatic incidents, and that someone might as well be me.',
  'Cheerful halfling with messy curly brown hair, mischievous grin that could sell sand in a desert, pockets bulging with lucky charms and odds and ends, server''s vest over colorful clothing, balancing impossibly full tray of exotic drinks, surrounded by amused interdimensional guests, warm whimsical fantasy style, golden hour lighting',
  3
);

-- 4. The Reveler (Elf Barbarian) - The Eternal Feast
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'the-eternal-feast',
  'the-reveler',
  'The Reveler',
  'Fey hedonist learning the depth of mortal feelings',
  'Elf',
  'Barbarian',
  'Entertainer',
  1,
  '{"strength": 10, "dexterity": 14, "constitution": 14, "intelligence": 10, "wisdom": 10, "charisma": 18}',
  '{"traits": ["I have a joke for every occasion", "I change my mood as quickly as I change my tune"], "ideals": ["Beauty. When I perform, I make the world better than it was"], "bonds": ["I want to be famous—whatever it takes"], "flaws": ["I have trouble keeping my true feelings hidden"]}',
  '["acrobatics", "performance", "persuasion", "deception"]',
  '["Common", "Sylvan", "Elvish", "Giant"]',
  '["rapier", "pan pipes", "lute", "entertainer''s pack", "fine clothes", "wine flask", "Feywild party favors"]',
  'In the Feywild, we revel for centuries. Wine, song, dance—endless, eternal. I thought I knew pleasure. Then I visited the mortal realm and met a dying human who showed me more passion in one evening than I''d felt in five hundred years. When they passed, I understood: Limits create meaning. I''ve been chasing that intensity ever since. The Last Course—a place where beings from every realm come to share food, stories, and fleeting connections—is exactly where I need to be. Every meal here is a celebration of mortality''s beautiful urgency.',
  'The Eternal Feast is the most intensely alive place I''ve ever encountered! Beings with spans of centuries sitting beside those with mere decades, all sharing food and moment together. The joy! The drama! The exquisite tension of temporary connections! I must experience every course, every guest, every impossible combination of existence!',
  'Wild-looking elf with untamed silver hair and fierce amber eyes full of joy, tribal tattoos across bare muscular arms, goat-horn drinking cup at belt, wearing festive but battle-ready leather vest, surrounded by magical motes of joy and scattered musical notes, vibrant interdimensional restaurant background, whimsical fey style with warm celebratory lighting',
  4
);

-- 5. The Seeker (Catfolk Explorer) - The Eternal Feast
INSERT INTO public.starter_character_templates (
  starter_campaign_id,
  template_key,
  name,
  tagline,
  race,
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
) VALUES (
  'the-eternal-feast',
  'the-seeker',
  'The Seeker',
  'Insatiably curious explorer of mysteries',
  'Catfolk',
  'Rogue',
  'Anthropologist',
  1,
  '{"strength": 10, "dexterity": 18, "constitution": 10, "intelligence": 14, "wisdom": 12, "charisma": 12}',
  '{"traits": ["I''m driven by wanderlust that led me away from home", "I have a lesson for every situation"], "ideals": ["Discovery. I want to know everything about the world"], "bonds": ["I seek to preserve a memory of a culture that no longer exists"], "flaws": ["I am dogmatic in my beliefs"]}',
  '["acrobatics", "investigation", "perception", "stealth"]',
  '["Common", "Feline", "Primordial", "Celestial"]',
  '["shortsword", "shortbow", "leather armor", "thieves'' tools", "journal", "explorer''s pack", "artifacts from various cultures"]',
  'My people have a saying: "Curiosity is the path to all knowledge." They leave out the part about how many paths lead to death. I left my clan to find the legendary Library of Infinite Shelves—a story, a myth, a truth no one could confirm. Every answer led to three more questions. When I discovered that The Last Course exists in the spaces between dimensions, serving guests from realms beyond imagination, I knew I had found something even greater than a library: a crossroads of all knowledge, walking through the door three times a night.',
  'The Eternal Feast hosts beings from dimensions I''ve only theorized might exist! Every guest is a walking encyclopedia of unknowable truths. Their customs, their foods, their stories—each detail is a thread leading to revelations about the nature of reality itself. I must observe everything, document every interaction, taste every impossible cuisine!',
  'Sleek catfolk with spotted golden fur and impossibly bright curious green eyes, explorer''s gear with countless pouches bulging with collected curiosities, leather journal and quill always ready, ears perked forward with intense interest, sniffing at an exotic glowing dish being served, interdimensional restaurant kitchen background, adventure fantasy style with wonder-filled lighting',
  5
);
