/**
 * Encounter sizing by campaign difficulty (#2514).
 *
 * Run D1 (#2511) stood a level-1 Fighter (AC 18, 12 HP) against one +3 creature
 * at a time for 23 turns and lost 3 HP total: a single CR-1/4-class creature
 * cannot threaten that premade, so the death flow was unreachable. The fix is
 * visible, honest 5e pressure — more creatures — not a hidden to-hit nudge
 * (option 2 in #2514, rejected for exactly that reason).
 *
 * This module is pure: it decides how many hostile creatures an encounter
 * places from the campaign difficulty, the bible's encounter note for the
 * named creature, and the campaign monster index. It never touches the
 * partySize/4 scaler (`party-scaling.ts`) or the house HP/damage curve:
 * those fit a single creature to the party; this decides how many
 * creatures there are.
 *
 * Difficulty buckets (starter `campaign_difficulty` enum and user
 * `difficulty_level` text both feed through `normalizeEncounterDifficulty`):
 *   Easy / Medium (incl. low-medium) -> 1
 *   Hard (incl. medium-hard)         -> 2, or 3 for a pack/swarm/group note
 *   Deadly (incl. "very hard")       -> 3
 * A bible "solo" note overrides any difficulty to 1. Unknown/absent
 * difficulty yields 1 (no change from pre-#2514 behaviour).
 *
 * Multiplication rules (round 2, strategist review at `3631d169`;
 * round 3, strategist review at `6ee2c524`):
 * - Only generic creatures are ever multiplied. A named unique — an NPC
 *   with a proper name in the bible or the monster index — is never
 *   cloned, on any tier (`isNamedUnique`). It may still be joined by
 *   companions the bible explicitly states for it.
 * - When sizing adds seats to a name-only primary, the bible heading is
 *   stamped as its `monsterId` (`bibleMonsterId`), so every numbered
 *   seat resolves the authored stat block instead of the generic rung.
 * - Every spawned seat is its own participant: same-kind companions share
 *   only the stat-block template (`monsterId`), never the primary's
 *   `npcId`, and each gets a distinct name, so `startCombat` seats them
 *   as separate rows with separate HP.
 * - Companions come from the bible's stated group (the explicit
 *   `Encounters:` line, including its `with:` companions), then same-kind
 *   copies of a generic creature. With neither, the count stays 1. There
 *   is no keyword search over the rest of the chunk: words in ability
 *   text ("calls a group…") never change the count.
 */

import {
  findAuthoredMonster,
  findBibleNameInProse,
  type CampaignMonsterIndex,
} from './campaign-monster-index.js';
import { monsterKeyTokens, normalizeMonsterKey } from './monster-key.js';

export type EncounterDifficulty = 'easy' | 'medium' | 'hard' | 'deadly';

/** The session/campaign context encounter sizing needs, loaded once per entry. */
export interface EncounterContext {
  difficulty: EncounterDifficulty | null;
  /** Raw difficulty value the campaign row carries, for logging/tests. */
  difficultyRaw: string | null;
  index: CampaignMonsterIndex;
}

/**
 * Maps a campaign difficulty value onto the sizing buckets.
 *
 * Starter campaigns carry the `campaign_difficulty` enum
 * (easy | low-medium | medium | medium-hard | hard | deadly); user campaigns
 * carry free text (`difficulty_level`: "Easy", "Very Hard", ...). Matching is
 * by contained word so both dialects, and capitalisation, read the same.
 */
export function normalizeEncounterDifficulty(
  raw: string | null | undefined,
): EncounterDifficulty | null {
  if (!raw || typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!value) return null;
  if (value.includes('deadly') || value.includes('very hard')) return 'deadly';
  if (value.includes('hard')) return 'hard';
  if (value.includes('easy')) return 'easy';
  if (value.includes('medium')) return 'medium';
  return null;
}

export type EncounterNoteKind = 'solo' | 'pair' | 'pack' | 'group' | 'swarm';

export interface EncounterNote {
  kind: EncounterNoteKind | null;
  /** The bible's explicit `Encounters:` segment the kind was read from ('' when there is none). */
  sourceText: string;
}

/**
 * Reads the bible's encounter note for one creature out of its chunk content.
 *
 * Only the bible's explicit encounter line speaks — the authored format
 * (`Encounters: group: solo | pair | pack (N) | default; with: <companions>; morale: …`)
 * and the plain form (`**Encounters:** pack`, `Encounter: solo`,
 * `- Encounters — a pair, ...`) both resolve, with the `group:` value
 * classifying the encounter when one is present. Numbers/dice in the note
 * (`pack (3)`) describe the fiction's group; the engine's own 1–3 band,
 * scaled by difficulty, decides how many seat. Line markings that name a
 * singular creature (`solo`, `boss`, `unique`, `legendary`) cap the count
 * at 1. Without an explicit line there is no note at all (round 2): words
 * elsewhere in the chunk — ability text about "a group", disposition prose
 * about packs — never change the count.
 */
export function parseEncounterNote(content: string | null | undefined): EncounterNote {
  if (!content || typeof content !== 'string') return { kind: null, sourceText: '' };

  const explicit = /(?:^|[\n*_>|-])\s*\**\s*encounters?\s*\**\s*[:—-]\s*([^\n]*)/i.exec(content);
  if (!explicit) return { kind: null, sourceText: '' };
  const segment = (explicit[1] ?? '').trim();
  // The structured form names its parts (`group:`, `with:`, `morale:`); the
  // group value is what classifies the encounter. The plain form puts the
  // kind word directly after the colon.
  const haystack = (segment.match(/group\s*:\s*([^;]+)/i)?.[1] ?? segment).toLowerCase();
  const segmentText = segment.toLowerCase();

  if (
    /\b(solo|solitary)\b/.test(haystack) ||
    /\b(boss|unique|legendary)\b/.test(segmentText)
  ) {
    return { kind: 'solo', sourceText: segment };
  }
  if (/\bswarm\b/.test(haystack)) return { kind: 'swarm', sourceText: segment };
  const packWords = /\b(pack|brood|gang|mob|hatchlings?)\b/.test(haystack);
  if (/\bpair\b/.test(haystack) && !packWords && !/\bgroup\b/.test(haystack)) {
    return { kind: 'pair', sourceText: segment };
  }
  if (/\bgroup\b/.test(haystack) && !packWords) return { kind: 'group', sourceText: segment };
  if (packWords || /\bgroup\b/.test(haystack)) return { kind: 'pack', sourceText: segment };
  return { kind: null, sourceText: segment };
}

/** The encounter note for one combatant, via the real authored-monster lookup. */
export function encounterNoteFor(
  index: CampaignMonsterIndex,
  monsterId: string | null | undefined,
  name: string | null | undefined,
): EncounterNote {
  const authored = findAuthoredMonster(index, monsterId, name);
  if (!authored) return { kind: null, sourceText: '' };
  // Chunks built before #2514 carry no retained content; those read as no note.
  return parseEncounterNote((authored as { content?: string }).content);
}

const isPackLike = (kind: EncounterNoteKind | null): boolean =>
  kind === 'pack' || kind === 'group' || kind === 'swarm';

/**
 * How many hostile creatures this encounter places in total, for a generic
 * (multiplyable) primary.
 *
 * `note` is the primary (first/named) creature's bible note. A solo note
 * overrides every difficulty to 1; otherwise the difficulty bucket decides,
 * with a pack/swarm/group note lifting Hard from 2 to 3.
 */
export function desiredHostileCount(
  difficulty: EncounterDifficulty | null,
  note: EncounterNote,
): number {
  if (note.kind === 'solo') return 1;
  if (difficulty === 'deadly') return 3;
  if (difficulty === 'hard') return isPackLike(note.kind) ? 3 : 2;
  return 1;
}

const baseKindName = (name: string): string => name.replace(/\s+\d+$/, '').trim();

// Titles and forms of address that mark a person rather than a creature
// kind ("Professor Emil Darkwater", "Sister Vola", "Grand Chef Sazón").
const PERSON_TITLES: ReadonlySet<string> = new Set([
  'captain', 'sergeant', 'lieutenant', 'commander', 'general', 'admiral',
  'lord', 'lady', 'sir', 'dame', 'doctor', 'dr', 'professor', 'father',
  'mother', 'brother', 'sister', 'master', 'elder', 'chef', 'king', 'queen',
  'prince', 'princess', 'baron', 'baroness', 'count', 'countess', 'duke',
  'duchess', 'grand', 'saint', 'bishop', 'abbot', 'abbess', 'mayor',
  'judge',
]);

// Creature-kind nouns: a name *ending* in one of these names a kind of
// creature, not a person ("Faceless Stalker", "Vitruvian Spider",
// "Gravity Golem", "Shadow Roach"). The list is deliberately generous —
// erring toward "person" only fails safe (the encounter stays small),
// while erring toward "creature" would clone a named character.
const CREATURE_KIND_NOUNS: ReadonlySet<string> = new Set([
  'stalker', 'roach', 'golem', 'spider', 'hatchling', 'ghoul', 'shark',
  'elemental', 'hound', 'wolf', 'bear', 'rat', 'bat', 'snake', 'serpent',
  'wyrm', 'dragon', 'wyvern', 'drake', 'troll', 'ogre', 'giant', 'orc',
  'goblin', 'hobgoblin', 'kobold', 'skeleton', 'zombie', 'wraith', 'wight',
  'specter', 'spectre', 'ghost', 'phantom', 'vampire', 'lich', 'mummy',
  'banshee', 'harpy', 'gargoyle', 'gorgon', 'hydra', 'chimera',
  'manticore', 'basilisk', 'cockatrice', 'griffin', 'gryphon',
  'hippogriff', 'pegasus', 'unicorn', 'kraken', 'beholder', 'flayer',
  'devil', 'demon', 'angel', 'fiend', 'celestial', 'ooze', 'slime',
  'jelly', 'pudding', 'fungus', 'mold', 'mould', 'plant', 'vine',
  'tendril', 'horror', 'terror', 'beast', 'creature', 'monster', 'spawn',
  'broodling', 'swarmling', 'hulk', 'eater', 'drinker', 'reaper',
  'stinger', 'crawler', 'lurker', 'prowler', 'hunter', 'devourer',
  'render', 'shredder', 'crusher', 'smasher', 'gnawer', 'minion',
  'sentinel', 'guardian', 'keeper', 'weaver', 'hag', 'witch', 'warlock',
  'cultist', 'acolyte', 'knight', 'archer', 'warrior', 'brute',
  'marauder', 'raider', 'bandit', 'thug', 'pirate', 'assassin',
  'berserker', 'shaman', 'druid', 'mage', 'wizard', 'sorcerer', 'adept',
  'guard', 'soldier',
]);

/** Word tokens of a creature/NPC name, lowercased ("The Ghoul" → ['ghoul']). */
function nameTokens(name: string): string[] {
  const tokens = monsterKeyTokens(baseKindName(name));
  return tokens[0] === 'the' ? tokens.slice(1) : tokens;
}

/**
 * Is this combatant a named unique — a person, not a creature kind? Only
 * generic creatures may be multiplied; a unique is never cloned, on any
 * tier. Detection, in order (round 4, strategist review at `5988385742`):
 * it carries an `npcId`; the index has an entry for it, in which case the
 * bible's own typing decides — an `npc` chunk is a person, any other chunk
 * is a creature kind whatever its name looks like ("Light-Eater Swarm",
 * "Giant Rats", "Flavor-Elemental (Corrupted)", whose blockless NPC bio
 * sibling must not win over the monster entry); only with no entry does
 * the blockless-NPC probe judge it a person; or it carries an SRD template
 * id (`srd:ghoul`), a kind by construction. Only with no index entry and
 * no SRD id is the name itself judged: a title or an "X the Y" epithet
 * names a person ("Captain Sarah Reeves", "Kaelen the Warlock"), a name
 * ending in a creature-kind noun names a kind, and anything else fails
 * safe to person. A solo/boss/unique `Encounters:` note caps even a
 * generic creature at 1 through `desiredHostileCount`.
 */
export function isNamedUnique(
  index: CampaignMonsterIndex,
  lookup: { monsterId?: string | null; npcId?: string | null; name: string },
): boolean {
  if (lookup.npcId) return true;
  const base = baseKindName(lookup.name);
  const baseKey = normalizeMonsterKey(base);
  // The index entry decides first: a monster whose name matches a blockless
  // NPC bio (the Flavor-Elemental (Corrupted) pair) is typed by the bible's
  // own entry, not judged a person by the bio probe.
  const entry = findAuthoredMonster(index, lookup.monsterId, base);
  if (entry) {
    return entry.chunkType.toLowerCase().startsWith('npc');
  }
  if (index.blocklessNpcs.has(baseKey)) {
    return true;
  }
  if (lookup.monsterId?.startsWith('srd:')) return false;
  const tokens = nameTokens(base);
  if (tokens.length > 0 && PERSON_TITLES.has(tokens[0]!)) return true;
  // "X the Y" is an epithet, and epithets name individuals.
  if (tokens.length >= 3 && tokens[1] === 'the') return true;
  const last = tokens[tokens.length - 1];
  // A creature-kind name ends in a kind noun; anything else is a person.
  return !(last && CREATURE_KIND_NOUNS.has(last));
}

/**
 * The monsterId sizing stamps on a combatant whose primary carries none:
 * the bible heading (`entityName`) of its authored entry. Without it, the
 * sized seats are named "X 1" / "X 2" and the exact-name stat lookup
 * misses the bible entirely, seating a generic AC 12 / 11 HP body where
 * the authored creature should stand. Same-kind clones inherit the stamp;
 * a distinct companion still resolves its own entry by name.
 */
const bibleMonsterId = (
  index: CampaignMonsterIndex,
  combatant: { monsterId?: string | null; name: string },
): string | undefined =>
  combatant.monsterId ??
  findAuthoredMonster(index, null, baseKindName(combatant.name))?.entityName;

/**
 * Bible-named companions in the primary creature's encounter note, in note
 * order, excluding the primary itself. This is the "bible's stated group"
 * (a Vitruvian Spider with hatchlings): the note names another authored
 * creature, and that creature — not a clone — fills the extra seats. Only
 * the explicit `Encounters:` segment is read, and only names the monster
 * index can resolve are seated.
 */
export function statedCompanionNames(
  index: CampaignMonsterIndex,
  primaryName: string,
  note: EncounterNote,
): string[] {
  if (!note.sourceText || index.byKey.size === 0) return [];
  const primaryKey = normalizeMonsterKey(baseKindName(primaryName));
  const companions: string[] = [];
  // Walk the note with the same exact-name reader the seating code uses,
  // removing each found name so the next distinct companion can surface.
  let remaining = note.sourceText;
  for (let guard = 0; guard < 8; guard += 1) {
    const found = findBibleNameInProse(index, remaining, (name) => {
      return normalizeMonsterKey(baseKindName(name)) === primaryKey || companions.includes(name);
    });
    if (!found) break;
    companions.push(found);
    const tokens = found.replace(/^the\s+/i, '').split(/\s+/).join('\\s+');
    remaining = remaining.replace(new RegExp(tokens, 'i'), ' ');
  }
  return companions;
}

export interface SizedCombatant {
  name: string;
  monsterId?: string;
  count: number;
}

/**
 * Expands a combatant list to the difficulty-sized total.
 *
 * Rules, in order:
 * - The current total is never reduced (a DM who already authored three
 *   creatures on Easy keeps three; sizing is a floor for the common
 *   one-named-creature entry, not a cap that deletes authored creatures).
 * - A named unique primary is never copied. Extra seats around it come
 *   only from the bible's stated group; if that group cannot fill the
 *   sized count, the encounter seats smaller.
 * - For a generic primary, extra seats come from the bible's stated group
 *   first when the note names other authored creatures; otherwise they
 *   are the same kind as the primary creature (the Faceless Stalker pair).
 * - Kinds are merged by name+monsterId, so the result is a compact
 *   `{name, count}` list that `buildEntryParticipants` numbers into
 *   distinct seats ("Faceless Stalker 1 / 2"). A distinct companion never
 *   inherits the primary's stat block — it resolves its own.
 */
export function expandDerivedCombatants<T extends SizedCombatant>(
  combatants: readonly T[],
  context: { difficulty: EncounterDifficulty | null; index: CampaignMonsterIndex },
): T[] {
  if (combatants.length === 0) return [...combatants];
  const primary = combatants[0]!;
  const note = encounterNoteFor(context.index, primary.monsterId, primary.name);
  const unique = isNamedUnique(context.index, primary);
  let desired = desiredHostileCount(context.difficulty, note);
  if (unique && !isPackLike(note.kind) && note.kind !== 'pair') desired = 1;
  const current = combatants.reduce((total, c) => total + Math.max(1, c.count || 1), 0);
  if (current >= desired) return [...combatants];

  let need = desired - current;
  const result: T[] = combatants.map((c) => ({ ...c, count: Math.max(1, c.count || 1) }));
  // Sizing is adding seats: a name-only primary gets its bible heading
  // stamped as monsterId, so the numbered seats resolve the authored
  // stat block instead of the generic rung (strategist fix at 6ee2c524).
  const primaryMonsterId = bibleMonsterId(context.index, primary);
  if (primaryMonsterId && !primary.monsterId) {
    result[0] = { ...result[0]!, monsterId: primaryMonsterId };
  }
  const addKind = (name: string, monsterId: string | undefined): void => {
    const existing = result.find(
      (c) =>
        normalizeMonsterKey(baseKindName(c.name)) === normalizeMonsterKey(baseKindName(name)) &&
        (c.monsterId ?? '') === (monsterId ?? ''),
    );
    if (existing) {
      existing.count += 1;
    } else {
      result.push({
        ...primary,
        name,
        monsterId,
        count: 1,
      } as T);
    }
  };

  for (const companion of statedCompanionNames(context.index, primary.name, note)) {
    if (need <= 0) break;
    addKind(companion, undefined);
    need -= 1;
  }
  // Same-kind copies fill what the stated group did not — for a generic
  // creature only. A unique is never cloned.
  while (need > 0 && !unique) {
    addKind(baseKindName(primary.name), primaryMonsterId);
    need -= 1;
  }
  return result;
}

/** Every seated hostile name, numbered the way `buildEntryParticipants` numbers them. */
export function expandedCreatureNames(combatants: readonly SizedCombatant[]): string[] {
  const names: string[] = [];
  for (const combatant of combatants) {
    const count = Math.max(1, combatant.count || 1);
    for (let i = 0; i < count; i += 1) {
      names.push(count === 1 ? combatant.name : `${baseKindName(combatant.name)} ${i + 1}`);
    }
  }
  return names;
}

/**
 * The prompt fragment that tells the DM the engine-decided encounter size
 * BEFORE it narrates the approach (#2514 scope 2). The engine decides the
 * count; the DM describes exactly those creatures and no others.
 */
export function buildEncounterSizeDirective(combatants: readonly SizedCombatant[]): string {
  const names = expandedCreatureNames(combatants);
  if (names.length === 0) return '';
  const count = names.length;
  return (
    `Encounter size (engine-decided): ${count} hostile creature${count === 1 ? '' : 's'} — ${names.join(', ')}. ` +
    `Narrate exactly ${count} creature${count === 1 ? '' : 's'} approaching; do not add or remove creatures, ` +
    `and name them as listed so the prose and the encounter tracker agree.`
  );
}

export interface SizedParticipantInput {
  name: string;
  characterId?: string | null;
  npcId?: string | null;
  monsterId?: string | null;
}

/**
 * The `startCombat` backstop: expands hostile participant inputs to the
 * difficulty-sized total and gives every seat a distinct name.
 *
 * Player-character inputs (and any input carrying a characterId, including
 * seated companions) are never counted or cloned. Hostile seats are
 * numbered per kind when a kind seats more than once, matching
 * `buildEntryParticipants`; a lone seat keeps its bare name. Inputs that
 * already arrive sized (via the entry gate) are returned unchanged in
 * count, with names only de-duplicated if they collide.
 *
 * Identity (round 2): a seat carrying an `npcId` is a specific person and
 * is never copied, and a named unique is never copied either. Every
 * spawned seat gets `npcId: null` of its own — spawned companions share
 * only the stat template (`monsterId`, same-kind copies only), so
 * `startCombat` seats each as its own participant row with its own HP.
 */
export function expandParticipantInputs<T extends SizedParticipantInput>(
  inputs: readonly T[],
  context: { difficulty: EncounterDifficulty | null; index: CampaignMonsterIndex },
): T[] {
  const hostiles = inputs.filter((input) => !input.characterId);
  if (hostiles.length === 0) return [...inputs];

  const primary = hostiles[0]!;
  const note = encounterNoteFor(
    context.index,
    primary.monsterId,
    baseKindName(primary.name),
  );
  const unique = isNamedUnique(context.index, primary);
  let desired = desiredHostileCount(context.difficulty, note);
  if (unique && !isPackLike(note.kind) && note.kind !== 'pair') desired = 1;

  const result: T[] = inputs.map((input) => ({ ...input }));
  let need = desired - hostiles.length;
  if (need > 0) {
    // Sizing is adding seats: stamp the primary's bible heading as its
    // monsterId (and its clones'), so the numbered seats resolve the
    // authored stat block instead of the generic rung.
    const primaryMonsterId = bibleMonsterId(context.index, primary);
    if (primaryMonsterId && !primary.monsterId) {
      const primaryAt = inputs.indexOf(primary);
      result[primaryAt] = { ...result[primaryAt]!, monsterId: primaryMonsterId };
    }
    const companions = statedCompanionNames(context.index, primary.name, note);
    let companionIndex = 0;
    while (need > 0) {
      // Past the bible's stated group, only a generic creature may be
      // copied. A unique seats what the bible stated and no more.
      if (unique && companionIndex >= companions.length) break;
      const companionName =
        companionIndex < companions.length
          ? companions[companionIndex]
          : baseKindName(primary.name);
      companionIndex += 1;
      const isSameKind =
        normalizeMonsterKey(baseKindName(companionName ?? '')) ===
        normalizeMonsterKey(baseKindName(primary.name));
      result.push({
        ...primary,
        name: companionName ?? baseKindName(primary.name),
        ...(isSameKind ? { monsterId: primaryMonsterId } : { monsterId: undefined }),
        npcId: null,
      } as T);
      need -= 1;
    }
  }

  // Distinct names per kind: number every seat of a kind that seats >1,
  // preserving any bible-given distinct names (different kinds stay bare).
  const hostileSeats = result.filter((input) => !input.characterId);
  const byKind = new Map<string, T[]>();
  for (const seat of hostileSeats) {
    const kind = normalizeMonsterKey(baseKindName(seat.name));
    byKind.set(kind, [...(byKind.get(kind) ?? []), seat]);
  }
  for (const seats of byKind.values()) {
    if (seats.length <= 1) continue;
    seats.forEach((seat, index) => {
      seat.name = `${baseKindName(seat.name)} ${index + 1}`;
    });
  }
  return result;
}
