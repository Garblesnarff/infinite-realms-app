import { isUnarmedAttackVerb, isUnarmedWeaponClaim } from './weapon-catalog.js';
import { getSpellByName } from '../../data/spellData.js';
import { logger } from '../../lib/logger.js';

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
  attackSource?: 'unarmed' | 'weapon' | 'spell';
  weaponName?: string;
  /**
   * True only when the player named the weapon (e.g. "with the dagger").
   * A missing weapon on "I attack" is Unarmed Strike, not an inferred blade.
   */
  weaponStated?: boolean;
  spellId?: string;
  spellName?: string;
}

/**
 * Deliberately small, clause-head vocabulary. This is not a classifier: it only recognizes
 * an attack-shaped clause and then resolves the named actor against the server roster.
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
  'headbutt',
  'tackle',
  'grapple',
  'shove',
  'slap',
  'elbow',
  'fire at',
  'swing',
  'swing at',
  'throw',
  'cast',
] as const;

const IGNORABLE_ACTOR_WORDS = new Set(['a', 'an', 'at', 'in', 'on', 'the', 'to']);

const DIRECT_ATTACK_VERBS = [
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
  'slap',
  'elbow',
] as const;

const VERB_TOKEN_PATTERN =
  /(?:punch|hit|strike|stab|slash|shoot|attack|kick|headbutt|tackle|grapple|shove|slap|elbow|fire|swing|throw|cast)(?:es|s)?\b/gi;

const DECLARATION_BLOCK_PATTERN =
  /\b(?:don't|do not|won't|never|not going to|should\s+i|can\s+i|could\s+i|what\s+if|if\s+i)\b/i;

const DEESCALATION_SPEECH_PATTERN =
  /\bput\b[\s\S]{0,40}\bdown\b|\bdon'?t want to hurt\b|\bwe can end this\b|\bsurrender\b|\bwithout anyone getting hurt\b|\bstop (?:this|fighting|attacking)\b/i;

export function isCombatDeescalationSpeech(text: string): boolean {
  return DEESCALATION_SPEECH_PATTERN.test(text.replace(/[’‘]/g, "'"));
}

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

const matchActor = (
  targetText: string,
  actors: readonly CombatIntentActor[],
): CombatIntentActor | null => {
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

const PRONOUN_TARGETS = new Set(['him', 'her', 'them', 'it']);

interface ActorResolution {
  actor: CombatIntentActor;
  pronoun?: string;
}

const matchActorOrUnambiguousPronoun = (
  targetText: string,
  actors: readonly CombatIntentActor[],
): ActorResolution | null => {
  const actor = matchActor(targetText, actors);
  if (actor) return { actor };
  const pronoun = normalize(targetText);
  return actors.length === 1 && PRONOUN_TARGETS.has(pronoun) ? { actor: actors[0], pronoun } : null;
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

const splitIntoClauses = (input: string): string[] => {
  const clauses: string[] = [];
  let clauseStart = 0;
  let quote: 'straight' | 'curly' | null = null;

  const pushClause = (end: number): void => {
    const clause = input.slice(clauseStart, end).trim();
    if (clause) clauses.push(clause);
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '“') {
      quote = 'curly';
      continue;
    }
    if (character === '”') {
      quote = null;
      continue;
    }
    if (character === '"' && input[index - 1] !== '\\') {
      quote = quote === 'straight' ? null : 'straight';
      continue;
    }
    if (quote) continue;

    if (character === ',' || character === ';') {
      pushClause(index);
      clauseStart = index + 1;
      continue;
    }

    const delimiter = /^(?:and|then|but)(?=\s|$)/i.exec(input.slice(index));
    const before = input[index - 1];
    const after = input[index + (delimiter?.[0].length ?? 0)];
    if (
      delimiter &&
      (index === 0 || /\s/.test(before ?? '')) &&
      (index + delimiter[0].length === input.length || /\s/.test(after ?? ''))
    ) {
      pushClause(index);
      clauseStart = index + delimiter[0].length;
      index += delimiter[0].length - 1;
    }
  }

  pushClause(input.length);
  return clauses;
};

const stripLeadingPlayerIntent = (value: string): string =>
  value
    .replace(/^(?:but|however|yet|so)\s+/i, '')
    .replace(
      /^(?:(?:i|i'll|we|we'll)\s+)?(?:(?:try|attempt)\s+to\s+|want\s+to\s+|(?:i'm|i am)\s+going\s+to\s+|let\s+me\s+)?/i,
      '',
    )
    .trim();

const isInsideQuote = (value: string, index: number): boolean => {
  let quote: 'straight' | 'curly' | null = null;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (character === '“') quote = 'curly';
    else if (character === '”') quote = null;
    else if (character === '"' && value[cursor - 1] !== '\\') {
      quote = quote === 'straight' ? null : 'straight';
    }
    if (cursor === index) return quote !== null;
  }
  return false;
};

/**
 * A roster actor at the start of a clause is the speaker of that clause, not its player. This
 * guard is checked before player-prefix stripping so "the professor punches the air" cannot be
 * mistaken for a player declaration when the target words happen to overlap the roster.
 */
const hasRosterActorSubject = (clause: string, actors: readonly CombatIntentActor[]): boolean => {
  VERB_TOKEN_PATTERN.lastIndex = 0;
  for (const match of clause.matchAll(VERB_TOKEN_PATTERN)) {
    const index = match.index ?? -1;
    if (index < 0 || isInsideQuote(clause, index)) continue;
    if (matchActor(clause.slice(0, index), actors)) return true;
  }
  return false;
};

const singularVerb = (verb: string): string => verb.toLowerCase().replace(/(?:es|s)$/i, '');

interface ClauseAttackMatch {
  verb: string;
  targetText: string;
  spellName?: string;
  weaponName?: string;
}

const matchClauseHead = (clause: string): ClauseAttackMatch | null => {
  const castMatch = /^cast\s+(.+?)\s+(?:at|on)\s+(.+)$/i.exec(clause);
  if (castMatch) {
    return {
      verb: 'cast',
      spellName: stripTrailingPunctuation(castMatch[1]),
      targetText: castMatch[2],
    };
  }

  const throwMatch = /^throw\s+.+?\s+at\s+(.+)$/i.exec(clause);
  if (throwMatch) return { verb: 'throw', targetText: throwMatch[1] };

  const takeSwingMatch = /^take\s+a\s+swing\s+(?:at|on)\s+(.+)$/i.exec(clause);
  if (takeSwingMatch) return { verb: 'swing', targetText: takeSwingMatch[1] };

  const swingMatch = /^swing(?:\s+(?:my|the)\s+(.+?))?\s+(?:at|on)\s+(.+)$/i.exec(clause);
  if (swingMatch) {
    return {
      verb: 'swing',
      ...(swingMatch[1] ? { weaponName: stripTrailingPunctuation(swingMatch[1]) } : {}),
      targetText: swingMatch[2],
    };
  }

  const fireMatch = /^fire\s+(?:at|on)\s+(.+)$/i.exec(clause);
  if (fireMatch) return { verb: 'fire at', targetText: fireMatch[1] };

  const goForMatch = /^go\s+for\s+(.+)$/i.exec(clause);
  if (goForMatch) {
    const weaponMatch = /^(.+?)\s+with\s+(?:my|the|a|his|her)\s+(.+)$/i.exec(goForMatch[1]);
    return {
      verb: 'go for',
      targetText: weaponMatch ? weaponMatch[1] : goForMatch[1],
      ...(weaponMatch ? { weaponName: stripTrailingPunctuation(weaponMatch[2]) } : {}),
    };
  }

  const directVerbPattern = new RegExp(
    `^(${DIRECT_ATTACK_VERBS.join('|')})(?:es|s)?\\b(?:\\s+(?:at|on))?\\s+(.+)$`,
    'i',
  );
  const directVerbMatch = directVerbPattern.exec(clause);
  if (!directVerbMatch) return null;
  const weaponMatch = /^(.+?)\s+with\s+(?:my|the|a|his|her)\s+(.+)$/i.exec(directVerbMatch[2]);
  return {
    verb: singularVerb(directVerbMatch[1]),
    targetText: weaponMatch ? stripTrailingPunctuation(weaponMatch[1]) : directVerbMatch[2],
    ...(weaponMatch ? { weaponName: stripTrailingPunctuation(weaponMatch[2]) } : {}),
  };
};

const resolveClauseAttack = (
  rawClause: string,
  actors: readonly CombatIntentActor[],
): DeclaredAttack | null => {
  const clause = stripTrailingPunctuation(rawClause.trim());
  if (!clause || DECLARATION_BLOCK_PATTERN.test(clause.replace(/[’‘]/g, "'"))) return null;
  if (hasRosterActorSubject(clause, actors)) return null;

  const strippedClause = stripLeadingPlayerIntent(clause);
  if (!strippedClause || isInsideQuote(strippedClause, 0)) return null;

  const match = matchClauseHead(strippedClause);
  if (!match) return null;

  const verb = match.verb === 'fire at' ? 'fire' : match.verb;
  const verbOffset = strippedClause.search(new RegExp(`\\b${verb.split('\\s+')[0]}\\b`, 'i'));
  if (verbOffset >= 0 && isInsideQuote(strippedClause, verbOffset)) return null;

  if (match.spellName) {
    const spell = getSpellByName(match.spellName);
    if (!spell?.damage) return null;
    const actor = matchActor(match.targetText, actors);
    return actor
      ? {
          ...toDeclaredAttack(`cast ${spell.name}`, actor),
          attackSource: 'spell',
          spellId: spell.id,
          spellName: spell.name,
        }
      : null;
  }

  const resolution = matchActorOrUnambiguousPronoun(match.targetText, actors);
  if (!resolution) return null;
  const { actor } = resolution;
  if (resolution.pronoun) {
    logger.info({
      msg: 'COMBAT_INTENT_PRONOUN_RESOLVED',
      verb: match.verb,
      pronoun: resolution.pronoun,
      actorName: actor.name.trim(),
    });
  }
  const namedWeapon = Boolean(match.weaponName && !isUnarmedWeaponClaim(match.weaponName));
  const unarmedVerb = isUnarmedAttackVerb(match.verb) || match.verb === 'attack';
  return {
    ...toDeclaredAttack(match.verb, actor),
    attackSource: namedWeapon || !unarmedVerb ? 'weapon' : 'unarmed',
    weaponStated: namedWeapon,
    ...(namedWeapon ? { weaponName: match.weaponName } : {}),
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

  const clauses = splitIntoClauses(playerInput.trim().replace(/\s+/g, ' '));
  let declaredAttack: DeclaredAttack | null = null;
  for (const clause of clauses) {
    if (isCombatDeescalationSpeech(clause)) continue;
    const match = resolveClauseAttack(clause, actors);
    if (match) declaredAttack = match;
  }
  return declaredAttack;
}
