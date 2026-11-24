/**
 * #1741: the name a player gives a premade hero at hero choice.
 *
 * Suggestions come from these tables in code: no model call, and the same three
 * names for the same premade every time. Every name here is invented; none is a
 * real person or a trademarked character.
 */

export const HERO_NAME_MAX_LENGTH = 40;

const NAME_POOLS: Readonly<Record<string, readonly string[]>> = {
  human: ['Mara', 'Tomas', 'Ilse', 'Bram', 'Corin', 'Essa', 'Doran', 'Liss'],
  elf: ['Aelindra', 'Thessaly', 'Caladon', 'Ilyanwe', 'Sylvar', 'Faelen', 'Ninessa', 'Orrin'],
  dwarf: ['Garrek', 'Dagna', 'Holm', 'Ulfra', 'Brokk', 'Hilde', 'Runa', 'Dorin'],
  halfling: ['Pim', 'Tilly', 'Rosie', 'Bramble', 'Wenna', 'Cob', 'Lolly', 'Nettle'],
  tiefling: ['Ashar', 'Vesper', 'Nyssa', 'Kael', 'Sorrel', 'Mordai', 'Oriel', 'Lilith'],
  dragonborn: ['Arjhan', 'Kriv', 'Surah', 'Dhava', 'Ilrah', 'Vrath', 'Sahrak', 'Mekhai'],
  gnome: ['Fizzwick', 'Orla', 'Pock', 'Quill', 'Bibbet', 'Nim', 'Wicket', 'Dilly'],
  'half-elf': ['Seren', 'Kiva', 'Rhun', 'Maelis', 'Jory', 'Ondra', 'Cael', 'Sabine'],
  'half-orc': ['Dorra', 'Ghull', 'Tusk', 'Brakka', 'Murn', 'Oskar', 'Hagra', 'Kugg'],
};

const GENERAL_POOL: readonly string[] = [
  'Ash',
  'Rowan',
  'Sable',
  'Wren',
  'Quinn',
  'Tamsin',
  'Jory',
  'Ondra',
];

function poolFor(race: string): readonly string[] {
  return NAME_POOLS[race.trim().toLowerCase()] ?? GENERAL_POOL;
}

/** FNV-1a: a stable number from the premade's id. */
function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A small seeded generator (mulberry32): the same seed gives the same sequence. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Three names that fit the hero's race. Deterministic per premade id, so the
 * same premade always offers the same three.
 */
export function suggestHeroNames(hero: { id: string; race: string }, count = 3): string[] {
  const pool = [...poolFor(hero.race)];
  const random = seededRandom(hashSeed(hero.id));
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, count);
}

// Letters, spaces, apostrophes (straight or curly) and hyphens. Starts with a letter.
const HERO_NAME_PATTERN = /^\p{L}[\p{L} '’-]*$/u;

export type HeroNameCheck = { ok: true; name: string } | { ok: false; message: string };

/**
 * Check the typed name. An empty field keeps the premade's title as the name.
 * The name is trimmed before it is checked.
 */
export function checkHeroName(typed: string, title: string): HeroNameCheck {
  const name = typed.trim();
  if (name === '') return { ok: true, name: title };
  if (name.length > HERO_NAME_MAX_LENGTH) {
    return { ok: false, message: `Use ${HERO_NAME_MAX_LENGTH} characters or fewer.` };
  }
  if (!HERO_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      message: 'Use letters, spaces, apostrophes and hyphens only.',
    };
  }
  return { ok: true, name };
}

/** "Mara, the Seeker" for a hero named Mara with the title "The Seeker". */
export function heroEpithetName(name: string, title: string): string {
  if (name === title) return title;
  return `${name}, ${title.replace(/^The /, 'the ')}`;
}
