/**
 * Names the hostiles of a detected entry that the DM left unnamed (#2532).
 *
 * `deriveEntryCombatants` falls back to a literal "Hostile Creature" when the reply asks for a
 * fight and lists nobody. The popup then read "Strike at Hostile Creature?" and the encounter
 * service seated "Unknown creature" (run 20). A placeholder is replaced by the first name any of
 * these gives, in order: the DM's `monster_id` looked up in the campaign's authored creatures and
 * then the SRD, a campaign creature (not an NPC) the turn's prose names word for word, and the
 * creature the prose describes by kind ("a chitinous hunter"). A name is never guessed from a
 * capitalised phrase, and a bare role noun ("the captain", "the guard rail", "a giant crack") is
 * not a creature: that is how scenery and bystanders become the enemy. A placeholder nothing names
 * is dropped. The caller starts no encounter when none is left.
 */
import {
  findAuthoredMonster,
  findBibleNameInProse,
  type CampaignMonsterIndex,
} from './campaign-monster-index.js';
import { findSrdMonster } from './srd-monster-resolution.js';
import {
  creatureNameFromProse,
  isPlayerCharacterName,
  isUnresolvedNpcName,
  ROLE_NOUNS,
} from '../../tactical/seating.js';

import type { DerivedCombatant } from './combat-entry-gate.js';

const comparable = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** "A. **Consult the iron spike**", "2) Retreat": actions the player may take, not the scene. */
const OPTION_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?[A-Ha-h1-9][.)](?:\*\*)?\s/;

/** The DM's prose as one run of text, without its option menu: a name never spans two lines. */
const sceneProse = (prose: string): string =>
  prose
    .split('\n')
    .filter((line) => !OPTION_LINE.test(line))
    .join('. ');

export async function nameUnresolvedCombatants(params: {
  combatants: readonly DerivedCombatant[];
  /** Everything the DM wrote this turn that could name the creature. */
  prose: string;
  playerName: string;
  /** Read only when a combatant is unnamed. */
  loadIndex: () => Promise<CampaignMonsterIndex>;
}): Promise<DerivedCombatant[]> {
  const { combatants, playerName } = params;
  const prose = sceneProse(params.prose);
  if (!combatants.some((combatant) => isUnresolvedNpcName(combatant.name))) {
    return [...combatants];
  }

  const index = await params.loadIndex();
  const taken = new Set(
    combatants
      .filter((combatant) => !isUnresolvedNpcName(combatant.name))
      .map((combatant) => comparable(combatant.name)),
  );
  // An NPC the campaign names may be standing there as an ally; only its creatures are candidates.
  const npcNames = new Set([
    ...[...index.byKey.values()]
      .filter((entry) => entry.chunkType.startsWith('npc_'))
      .map((entry) => comparable(entry.entityName.replace(/^the\s+/i, ''))),
    ...[...index.blocklessNpcs.values()].map((name) => comparable(name.replace(/^the\s+/i, ''))),
  ]);
  const isUnusable = (name: string): boolean =>
    isUnresolvedNpcName(name) ||
    isPlayerCharacterName(name, [playerName]) ||
    taken.has(comparable(name));
  const isExcluded = (name: string): boolean => isUnusable(name) || npcNames.has(comparable(name));

  // A creature the prose only describes is never an NPC: not one a word of whose name it is
  // ("the captain" beside Captain Sarah Reeves), and not a bare role noun, which says nothing
  // about who is hostile ("the guard rail", "a giant crack").
  const npcWords = new Set([...npcNames].flatMap((npc) => npc.split(' ')));
  const isNotACreature = (name: string): boolean => {
    const words = comparable(name).split(' ');
    const noun = words[words.length - 1] ?? '';
    return (
      isExcluded(name) ||
      (words.length === 1 && ROLE_NOUNS.has(noun)) ||
      words.every((word) => npcWords.has(word)) ||
      (ROLE_NOUNS.has(noun) && npcWords.has(noun))
    );
  };

  const nameFor = (combatant: DerivedCombatant): string | null => {
    const authored = combatant.monsterId
      ? findAuthoredMonster(index, combatant.monsterId, null)
      : null;
    const idName =
      authored?.entityName.replace(/^the\s+/i, '').trim() ??
      (combatant.monsterId ? findSrdMonster(combatant.monsterId, null)?.name : undefined);
    // The DM chose this id on purpose, so an NPC it names is a fine answer.
    if (idName && !isUnusable(idName)) return idName;

    const named = findBibleNameInProse(index, prose, isExcluded);
    if (named) return named;

    return creatureNameFromProse(prose, isNotACreature) ?? null;
  };

  const named: DerivedCombatant[] = [];
  for (const combatant of combatants) {
    if (!isUnresolvedNpcName(combatant.name)) {
      named.push(combatant);
      continue;
    }
    const name = nameFor(combatant);
    if (!name) continue;
    taken.add(comparable(name));
    named.push({ ...combatant, name });
  }
  return named;
}
