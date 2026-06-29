/**
 * asset-icons — resolves game entity names to the navy-theme icon art in
 * /public/images (items, conditions, tokens, crests). Pure, dependency-free.
 *
 * Usage:
 *   import { getItemIcon, getConditionIcon, getCrestIcon, getTokenIcon } from '@/lib/asset-icons';
 *   <img src={getItemIcon('Longsword +1')} />   // -> /images/items/longsword.png
 */

const slug = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** 49 item icons available under /images/items */
const ITEMS = new Set([
  'longsword','shortsword','greatsword','rapier','dagger','scimitar','battleaxe',
  'handaxe','warhammer','mace','quarterstaff','spear','halberd','flail',
  'shortbow','longbow','crossbow','quiver','sling','throwing-knives','blowgun',
  'leather-armor','chain-mail','plate-armor','wooden-shield','kite-shield','helmet','gauntlets',
  'potion-healing','potion-mana','poison-vial','antitoxin','oil-flask','rations','waterskin',
  'scroll','spellbook','wand','staff','ring','amulet','crystal-orb',
  'torch','lantern','rope','grappling-hook','lockpicks','coin-pouch','gemstone',
]);

/** keyword → item slug, for fuzzy names like "Greatsword of the Feast" */
const ITEM_KEYWORDS: [RegExp, string][] = [
  [/great\s*sword/, 'greatsword'], [/short\s*sword/, 'shortsword'], [/long\s*sword/, 'longsword'],
  [/rapier/, 'rapier'], [/scimitar|saber|sabre/, 'scimitar'], [/dagger|knife|dirk/, 'dagger'],
  [/battle\s*axe|greataxe|great\s*axe/, 'battleaxe'], [/hand\s*axe|hatchet/, 'handaxe'],
  [/war\s*hammer|maul/, 'warhammer'], [/mace|morningstar/, 'mace'], [/flail|nunchaku/, 'flail'],
  [/quarter\s*staff|\bstaff\b/, 'quarterstaff'], [/spear|pike|trident|lance/, 'spear'], [/halberd|glaive|poleaxe/, 'halberd'],
  [/short\s*bow/, 'shortbow'], [/long\s*bow/, 'longbow'], [/cross\s*bow/, 'crossbow'],
  [/quiver|arrows?/, 'quiver'], [/sling/, 'sling'], [/throwing|darts?/, 'throwing-knives'], [/blowgun/, 'blowgun'],
  [/leather/, 'leather-armor'], [/chain\s*mail|chainmail|chain\s*shirt/, 'chain-mail'],
  [/plate|breastplate|half\s*plate/, 'plate-armor'], [/kite\s*shield/, 'kite-shield'], [/shield/, 'wooden-shield'],
  [/helm|helmet|cap/, 'helmet'], [/gauntlet|glove/, 'gauntlets'],
  [/heal/, 'potion-healing'], [/mana|arcane\s*potion/, 'potion-mana'], [/poison/, 'poison-vial'],
  [/antitoxin|antidote/, 'antitoxin'], [/oil/, 'oil-flask'], [/ration|food|meal/, 'rations'], [/waterskin|flask|canteen/, 'waterskin'],
  [/scroll/, 'scroll'], [/spell\s*book|tome|grimoire|journal|book/, 'spellbook'], [/wand/, 'wand'], [/staff|rod/, 'staff'],
  [/ring/, 'ring'], [/amulet|necklace|pendant|talisman/, 'amulet'], [/orb|crystal\s*ball|sphere/, 'crystal-orb'],
  [/torch/, 'torch'], [/lantern/, 'lantern'], [/rope/, 'rope'], [/grappl/, 'grappling-hook'],
  [/lock\s*pick|thieves/, 'lockpicks'], [/coin|gold|purse|pouch|gp\b/, 'coin-pouch'], [/gem|jewel|diamond|ruby/, 'gemstone'],
];

/** 25 conditions under /images/conditions (filenames prefixed condition-) */
const CONDITIONS = new Set([
  'blinded','deafened','charmed','frightened','poisoned','grappled','restrained','paralyzed',
  'stunned','prone','petrified','unconscious','incapacitated','exhausted','invisible',
  'blessed','heroism','hasted','raging','shielded','burning','frozen','regenerating','concentrating','cursed',
]);
const CONDITION_ALIASES: Record<string, string> = {
  bless: 'blessed', inspired: 'heroism', inspiration: 'heroism', haste: 'hasted', slow: 'hasted',
  rage: 'raging', shield: 'shielded', shielded: 'shielded', burn: 'burning', burning: 'burning',
  frozen: 'frozen', chilled: 'frozen', regen: 'regenerating', regeneration: 'regenerating',
  concentration: 'concentrating', concentrating: 'concentrating', curse: 'cursed',
  exhaustion: 'exhausted', exhausted: 'exhausted', petrify: 'petrified',
};

/** 13 class crests + utility, under /images/crests (prefixed crest-) */
const CRESTS = new Set([
  'barbarian','bard','cleric','druid','fighter','monk','paladin','ranger',
  'rogue','sorcerer','warlock','wizard','artificer','adventurer','villain','blank',
]);

/** common monster/type tokens under /images/tokens (prefixed token-) */
const TOKENS = new Set([
  'goblin','hobgoblin','orc','kobold','bandit','cultist','gnoll','skeleton','zombie','ghoul',
  'wight','wraith','ghost','lich','wolf','dire-wolf','bear','giant-spider','giant-rat','boar',
  'snake','red-dragon','white-dragon','wyvern','drake','basilisk','lizardfolk','troglodyte',
  'fire-elemental','water-elemental','earth-elemental','air-elemental','mephit','salamander',
  'will-o-wisp','imp','demon','devil','mind-flayer','beholder','gibbering-mouther','rust-monster',
  'ogre','troll','hill-giant','minotaur','owlbear','animated-armor','gargoyle',
]);

const BASE = '/images';

/** Resolve an item name to its icon path, or null if no good match. */
export function getItemIcon(name: string): string | null {
  const s = slug(name);
  if (ITEMS.has(s)) return `${BASE}/items/${s}.png`;
  for (const [re, target] of ITEM_KEYWORDS) if (re.test(s)) return `${BASE}/items/${target}.png`;
  return null;
}

/** Resolve a condition/status name to its medallion icon path, or null. */
export function getConditionIcon(name: string): string | null {
  let s = slug(name);
  if (CONDITION_ALIASES[s]) s = CONDITION_ALIASES[s];
  if (CONDITIONS.has(s)) return `${BASE}/conditions/condition-${s}.png`;
  for (const key of Object.keys(CONDITION_ALIASES)) if (s.includes(key)) return `${BASE}/conditions/condition-${CONDITION_ALIASES[key]}.png`;
  return null;
}

/** Resolve a class name to its heraldic crest, falling back to a generic crest. */
export function getCrestIcon(className?: string): string {
  const s = slug(className || '');
  if (CRESTS.has(s)) return `${BASE}/crests/crest-${s}.png`;
  return `${BASE}/crests/crest-adventurer.png`;
}

/** Resolve a monster/creature name or type to a token, or null. */
export function getTokenIcon(name: string): string | null {
  const s = slug(name);
  if (TOKENS.has(s)) return `${BASE}/tokens/token-${s}.png`;
  for (const t of TOKENS) if (s.includes(t)) return `${BASE}/tokens/token-${t}.png`;
  return null;
}
