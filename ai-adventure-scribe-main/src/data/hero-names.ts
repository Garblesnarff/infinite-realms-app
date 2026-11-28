/**
 * #1741: the name a player gives a premade hero at hero choice.
 *
 * Suggestions come from these tables in code: no model call, and the same three
 * names for the same premade every time. Every name here is invented; none is a
 * real person or a trademarked character.
 */

export { HERO_NAME_MAX_LENGTH, checkHeroName, heroEpithetName } from '../../shared/hero-name';
export type { HeroNameCheck } from '../../shared/hero-name';

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
