import { getSpellByName } from '../../data/spellData.js';

/** The actor identity the intent gate is allowed to resolve against. */
export interface CombatIntentActor {
  name: string;
  actorSlug?: string;
  /** `slug` is accepted for callers that use the tactical-map field name. */
  slug?: string;
  monsterId?: string;
}

export interface DeclaredAttack {
  verb: string;
  actorName: string;
  actorSlug?: string;
  monsterId?: string;
}

/**
 * Deliberately small, clause-head vocabulary. This is not a classifier: it only recognizes
 * an attack-shaped opening and then resolves the named actor against the server roster.
 */
export const COMBAT_INTENT_VERBS = [
  'punch',
  'hit',
  'strike',
  'stab',
  'slash',
  'shoot',
  'attack',
  'kick',
  'tackle',
  'grapple',
  'shove',
  'fire at',
  'swing at',
  'throw',
] as const;

const IGNORABLE_ACTOR_WORDS = new Set(['a', 'an', 'at', 'in', 'on', 'the', 'to']);

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim();

const words = (value: string): string[] => normalize(value).split(/\s+/).filter(Boolean);

const actorWords = (value: string): string[] =>
  words(value).filter((word) => !IGNORABLE_ACTOR_WORDS.has(word));

const stripTrailingPunctuation = (value: string): string => value.replace(/[.!?,;:]+$/, '').trim();

const matchActor = (targetText: string, actors: CombatIntentActor[]): CombatIntentActor | null => {
  const targetWords = new Set(actorWords(targetText));
  if (!targetWords.size) return null;

  const candidates = actors
    .filter((actor) => typeof actor.name === 'string' && actor.name.trim())
    .map((actor, index) => {
      const nameWords = actorWords(actor.name);
      const matched = nameWords.filter((word) => targetWords.has(word));
      const complete = nameWords.length > 0 && matched.length === nameWords.length;
      return {
        actor,
        index,
        complete,
        matchedCount: matched.length,
        nameWordCount: nameWords.length,
      };
    })
    .filter((candidate) => candidate.matchedCount > 0)
    .sort((left, right) => {
      if (left.complete !== right.complete) return left.complete ? -1 : 1;
      if (left.matchedCount !== right.matchedCount) {
        return right.matchedCount - left.matchedCount;
      }
      if (left.nameWordCount !== right.nameWordCount) {
        return right.nameWordCount - left.nameWordCount;
      }
      return left.index - right.index;
    });

  return candidates[0]?.actor ?? null;
};

const toDeclaredAttack = (verb: string, actor: CombatIntentActor): DeclaredAttack => {
  const actorSlug = actor.actorSlug ?? actor.slug;
  return {
    verb,
    actorName: actor.name.trim(),
    ...(actorSlug?.trim() ? { actorSlug: actorSlug.trim() } : {}),
    ...(actor.monsterId?.trim() ? { monsterId: actor.monsterId.trim() } : {}),
  };
};

/**
 * Resolve a player-declared attack using only the supplied roster.
 *
 * The function is intentionally pure: no session lookup, database access, prompt mutation, or
 * LLM call belongs here. A non-attack clause such as "I ask Darkwater why he lied" returns null
 * before actor matching, even when Darkwater is present in the roster.
 */
export function detectDeclaredAttack(
  playerInput: string,
  actors: readonly CombatIntentActor[],
): DeclaredAttack | null {
  if (typeof playerInput !== 'string' || !playerInput.trim()) return null;

  let input = playerInput.trim().replace(/\s+/g, ' ');
  input = input.replace(/^(?:i|we)\s+/i, '');
  input = input.replace(/^(?:(?:try|attempt)\s+to)\s+/i, '');

  const castMatch = /^cast\s+(.+?)\s+(?:at|on)\s+(.+)$/i.exec(input);
  if (castMatch) {
    const spellName = stripTrailingPunctuation(castMatch[1]);
    const spell = getSpellByName(spellName);
    if (!spell?.damage) return null;
    const actor = matchActor(castMatch[2], [...actors]);
    return actor ? toDeclaredAttack(`cast ${spell.name}`, actor) : null;
  }

  const throwMatch = /^throw\s+.+?\s+at\s+(.+)$/i.exec(input);
  if (throwMatch) {
    const actor = matchActor(throwMatch[1], [...actors]);
    return actor ? toDeclaredAttack('throw', actor) : null;
  }

  const prepositionVerbMatch = /^(fire\s+at|swing\s+at)\s+(.+)$/i.exec(input);
  if (prepositionVerbMatch) {
    const actor = matchActor(prepositionVerbMatch[2], [...actors]);
    return actor
      ? toDeclaredAttack(prepositionVerbMatch[1].toLowerCase().replace(/\s+/g, ' '), actor)
      : null;
  }

  const directVerbMatch =
    /^(punch|hit|strike|stab|slash|shoot|attack|kick|tackle|grapple|shove)\b(?:\s+(?:at|on))?\s+(.+)$/i.exec(
      input,
    );
  if (!directVerbMatch) return null;

  const actor = matchActor(directVerbMatch[2], [...actors]);
  return actor ? toDeclaredAttack(directVerbMatch[1].toLowerCase(), actor) : null;
}
