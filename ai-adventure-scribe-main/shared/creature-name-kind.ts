// Person-vs-creature-kind judgement shared by the server encounter sizer and
// the client fight-start card (#567). A proper name takes no article ("Attack
// Odile Vantrell?"); a creature kind keeps it ("Attack the goblin?").

// Titles and forms of address that mark a person rather than a creature
// kind ("Professor Emil Darkwater", "Sister Vola", "Grand Chef Sazón").
export const PERSON_TITLES: ReadonlySet<string> = new Set([
  'captain',
  'sergeant',
  'lieutenant',
  'commander',
  'general',
  'admiral',
  'lord',
  'lady',
  'sir',
  'dame',
  'doctor',
  'dr',
  'professor',
  'father',
  'mother',
  'brother',
  'sister',
  'master',
  'elder',
  'chef',
  'king',
  'queen',
  'prince',
  'princess',
  'baron',
  'baroness',
  'count',
  'countess',
  'duke',
  'duchess',
  'grand',
  'saint',
  'bishop',
  'abbot',
  'abbess',
  'mayor',
  'judge',
]);

// Creature-kind nouns: a name *ending* in one of these names a kind of
// creature, not a person ("Faceless Stalker", "Vitruvian Spider",
// "Gravity Golem", "Shadow Roach"). The list is deliberately generous —
// erring toward "person" only fails safe (the encounter stays small),
// while erring toward "creature" would clone a named character.
export const CREATURE_KIND_NOUNS: ReadonlySet<string> = new Set([
  'stalker',
  'roach',
  'golem',
  'spider',
  'hatchling',
  'ghoul',
  'shark',
  'elemental',
  'hound',
  'wolf',
  'bear',
  'rat',
  'bat',
  'snake',
  'serpent',
  'wyrm',
  'dragon',
  'wyvern',
  'drake',
  'troll',
  'ogre',
  'giant',
  'orc',
  'goblin',
  'hobgoblin',
  'kobold',
  'skeleton',
  'zombie',
  'wraith',
  'wight',
  'specter',
  'spectre',
  'ghost',
  'phantom',
  'vampire',
  'lich',
  'mummy',
  'banshee',
  'harpy',
  'gargoyle',
  'gorgon',
  'hydra',
  'chimera',
  'manticore',
  'basilisk',
  'cockatrice',
  'griffin',
  'gryphon',
  'hippogriff',
  'pegasus',
  'unicorn',
  'kraken',
  'beholder',
  'flayer',
  'devil',
  'demon',
  'angel',
  'fiend',
  'celestial',
  'ooze',
  'slime',
  'jelly',
  'pudding',
  'fungus',
  'mold',
  'mould',
  'plant',
  'vine',
  'tendril',
  'horror',
  'terror',
  'beast',
  'creature',
  'monster',
  'spawn',
  'broodling',
  'swarmling',
  'hulk',
  'eater',
  'drinker',
  'reaper',
  'stinger',
  'crawler',
  'lurker',
  'prowler',
  'hunter',
  'devourer',
  'render',
  'shredder',
  'crusher',
  'smasher',
  'gnawer',
  'minion',
  'sentinel',
  'guardian',
  'keeper',
  'weaver',
  'hag',
  'witch',
  'warlock',
  'cultist',
  'acolyte',
  'knight',
  'archer',
  'warrior',
  'brute',
  'marauder',
  'raider',
  'bandit',
  'thug',
  'pirate',
  'assassin',
  'berserker',
  'shaman',
  'druid',
  'mage',
  'wizard',
  'sorcerer',
  'adept',
  'guard',
  'soldier',
]);

function baseKindName(name: string): string {
  return name.replace(/\s+\d+$/, '').trim();
}

// Mirrors server monsterKeyTokens (server-bun/.../monster-key.ts), kept
// inline so shared/ never imports from server-bun.
function tokenize(value: string): string[] {
  const hyphenated = value
    .trim()
    .toLowerCase()
    .replace(/^srd:/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^the-/, '');
  const tokens = hyphenated.split('-').filter(Boolean);
  return tokens[0] === 'the' ? tokens.slice(1) : tokens;
}

/**
 * Person-vs-creature-kind judgement shared by the server encounter sizer and
 * the client fight-start card (#567). SRD id -> creature kind; a title or
 * "X the Y" epithet -> person; a name ending in a creature-kind noun ->
 * creature kind; anything else -> person.
 */
export function nameReadsAsPerson(name: string, monsterId?: string | null): boolean {
  if (monsterId?.startsWith('srd:')) return false;
  const base = baseKindName(name);
  const tokens = tokenize(base);
  const first = tokens[0];
  if (first !== undefined && PERSON_TITLES.has(first)) return true;
  if (tokens.length >= 3 && tokens[1] === 'the') return true;
  const last = tokens[tokens.length - 1];
  return !(last !== undefined && CREATURE_KIND_NOUNS.has(last));
}
