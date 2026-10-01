import { isUnarmedAttackVerb, isUnarmedWeaponClaim } from './weapon-catalog.js';
import {
  COMBAT_INTENT_VERBS,
  looksLikeCombatIntent,
} from '../../../../shared/combat-intent-prefilter';
import { getSpellByName, isPlayerCombatSpell } from '../../data/spellData.js';
import { logger } from '../../lib/logger.js';

/** The actor identity the intent gate is allowed to resolve against. */
export interface CombatIntentActor {
  name: string;
  actorSlug?: string;
  /** `slug` is accepted for callers that use the tactical-map field name. */
  slug?: string;
  monsterId?: string;
  /**
   * Where the roster learned this actor: this session's ledger, this session's map, or only the
   * campaign's authored cast. A `campaign` actor can be named, but nothing says the player has
   * met it (#2415, #2445). The first source to report an actor wins.
   */
  source?: 'ledger' | 'map' | 'campaign';
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

export { COMBAT_INTENT_VERBS, looksLikeCombatIntent };

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
  /(?:punch|hit|strike|stab|slash|shoot|attack|kick|headbutt|tackle|grapple|shove|slap|elbow|fire|swing|throw|hurl|launch|loose|blast|zap|cast)(?:es|s)?\b/gi;

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

/**
 * The attack verb governs the actor only when the actor heads the target phrase: "strike Valerius"
 * and "strike the professor" do, "strike a bargain with Valerius" does not, though it shares a
 * word with the roster (#2341). The name has to be one of the first two words of the target.
 */
const governsActor = (targetText: string, actor: CombatIntentActor): boolean => {
  const nameWords = new Set(actorWords(actor.name));
  const firstNameWord = actorWords(targetText).findIndex((word) => nameWords.has(word));
  return firstNameWord >= 0 && firstNameWord <= 1;
};

const matchGoverningActor = (
  targetText: string,
  actors: readonly CombatIntentActor[],
): CombatIntentActor | null => {
  const actor = matchActor(targetText, actors);
  return actor && governsActor(targetText, actor) ? actor : null;
};

const PRONOUN_TARGETS = new Set(['him', 'her', 'them', 'it']);

interface ActorResolution {
  actor: CombatIntentActor;
  pronoun?: string;
}

const matchActorOrUnambiguousPronoun = (
  targetText: string,
  actors: readonly CombatIntentActor[],
  previousApproachTarget?: CombatIntentActor | null,
): ActorResolution | null => {
  const actor = matchGoverningActor(targetText, actors);
  if (actor) return { actor };
  const pronoun = normalize(targetText);
  if (previousApproachTarget && PRONOUN_TARGETS.has(pronoun)) {
    return { actor: previousApproachTarget, pronoun };
  }
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

/** "Dr. Darkwater" is one name, not two sentences. */
const TITLE_ABBREVIATION = /(?:^|\s)(?:mr|mrs|ms|dr|st|prof|capt|sgt|lt|col|gen)$/i;

/** Verbs a player uses to send a spell at something. */
const SPELL_VERBS = 'cast|hurl|launch|loose|fire|blast|zap|unleash';

export const declareSpellAttackOn = (
  spell: { id: string; name: string },
  actor: CombatIntentActor,
): DeclaredAttack => ({
  ...toDeclaredAttack(`cast ${spell.name}`, actor),
  attackSource: 'spell',
  // The legacy declaration shape calls this field `weaponName`; keep the explicit
  // spell namespace so downstream grounding can never mistake a spell for a weapon.
  weaponName: `spell:${spell.name}`,
  spellId: spell.id,
  spellName: spell.name,
});

/**
 * The sheet's Cast button appends `[spell_id=chill-touch, spell_level=cantrip]`. Its comma would
 * split the player's one clause in two, and neither half reads as a spell (#2415). The client
 * drops the same tag from the bubble (`withoutSpellCastTag`).
 */
const withoutSheetSpellTag = (input: string): string =>
  input.replace(/\s*\[spell_id=[^\]]*\]/g, '');

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

    // A sentence end starts a new clause (#2341). Without it "I do not trust him. I cast Chill
    // Touch at Valerius." is one clause that does not begin with the verb, and the declared
    // attack in its second sentence is never seen.
    if (
      /[.!?]/.test(character) &&
      /\s/.test(input[index + 1] ?? '') &&
      !(character === '.' && TITLE_ABBREVIATION.test(input.slice(clauseStart, index)))
    ) {
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

/** Keep the target from an approach clause so a following "attack it" remains one intent. */
const resolveApproachTarget = (
  rawClause: string,
  actors: readonly CombatIntentActor[],
): CombatIntentActor | null => {
  const clause = stripLeadingPlayerIntent(stripTrailingPunctuation(rawClause.trim()));
  const match = /^(?:move|walk|run|advance|approach|close)\s+(?:toward|towards|to)\s+(.+)$/i.exec(
    clause,
  );
  return match ? matchActor(match[1], actors) : null;
};

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
  const spellVerbMatch = new RegExp(`^(${SPELL_VERBS})\\s+(.+?)\\s+(?:at|on)\\s+(.+)$`, 'i').exec(
    clause,
  );
  if (spellVerbMatch) {
    const spellName = stripTrailingPunctuation(spellVerbMatch[2]);
    const verb = spellVerbMatch[1].toLowerCase();
    // "cast" always names a spell; "hurl Acid Splash" does, "hurl a rock" is a thrown weapon.
    if (verb === 'cast' || getSpellByName(spellName)) {
      return { verb, spellName, targetText: spellVerbMatch[3] };
    }
  }

  const throwMatch = /^(?:throw|hurl|launch|loose)\s+.+?\s+at\s+(.+)$/i.exec(clause);
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

  const fireMatch = /^fire(?:\s+.+?)?\s+(?:at|on)\s+(.+)$/i.exec(clause);
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
  previousApproachTarget?: CombatIntentActor | null,
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
    if (!spell?.damage || !isPlayerCombatSpell(spell)) return null;
    const actor = matchGoverningActor(match.targetText, actors);
    return actor ? declareSpellAttackOn(spell, actor) : null;
  }

  const resolution = matchActorOrUnambiguousPronoun(
    match.targetText,
    actors,
    previousApproachTarget,
  );
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

  const clauses = splitIntoClauses(withoutSheetSpellTag(playerInput).trim().replace(/\s+/g, ' '));
  let declaredAttack: DeclaredAttack | null = null;
  let previousApproachTarget: CombatIntentActor | null = null;
  for (const clause of clauses) {
    if (isCombatDeescalationSpeech(clause)) continue;
    previousApproachTarget = resolveApproachTarget(clause, actors) ?? previousApproachTarget;
    const match = resolveClauseAttack(clause, actors, previousApproachTarget);
    if (match) declaredAttack = match;
  }
  return declaredAttack;
}

export interface UntargetedAttackSpell {
  id: string;
  name: string;
  /** "him", "it"... when the player wrote one; absent when the spell named no target at all. */
  pronoun?: string;
}

const UNTARGETED_SPELL_PATTERN = new RegExp(
  `^(?:${SPELL_VERBS})\\s+(.+?)(?:\\s+(?:at|on|toward|towards)\\s+(.+))?$`,
  'i',
);

/**
 * A known attack spell or cantrip cast at "him", "it" or nothing at all ("I cast Fire Bolt at
 * him"). The roster cannot say who, so `detectDeclaredAttack` returns null, and the DM would
 * answer first (#2341). The popup asks which creature instead. A named target that is not on the
 * roster ("at the lantern") is not this: that is not an attack on a creature.
 */
export function detectUntargetedAttackSpell(playerInput: string): UntargetedAttackSpell | null {
  if (typeof playerInput !== 'string' || !playerInput.trim()) return null;
  const input = withoutSheetSpellTag(playerInput).trim().replace(/\s+/g, ' ');
  for (const rawClause of splitIntoClauses(input)) {
    if (isCombatDeescalationSpeech(rawClause)) continue;
    const clause = stripLeadingPlayerIntent(stripTrailingPunctuation(rawClause.trim()));
    if (!clause || isInsideQuote(clause, 0)) continue;
    if (DECLARATION_BLOCK_PATTERN.test(clause.replace(/[’‘]/g, "'"))) continue;
    const match = UNTARGETED_SPELL_PATTERN.exec(clause);
    if (!match) continue;
    const spell = getSpellByName(stripTrailingPunctuation(match[1]));
    if (!spell?.damage || !isPlayerCombatSpell(spell)) continue;
    const target = match[2];
    const pronoun = target ? actorWords(target)[0] : undefined;
    if (target && !PRONOUN_TARGETS.has(pronoun ?? '')) continue;
    return { id: spell.id, name: spell.name, ...(pronoun ? { pronoun } : {}) };
  }
  return null;
}

const HONORIFICS = [
  'professor',
  'captain',
  'doctor',
  'lord',
  'lady',
  'sir',
  'dame',
  'mother',
  'father',
  'brother',
  'sister',
  'master',
  'elder',
  'sergeant',
  'lieutenant',
  'commander',
  'general',
];
const HONORIFIC_WORDS = new Set(HONORIFICS);
const TITLE_WORDS = new Set(['the', ...HONORIFICS]);

/**
 * Roster actors the narration names: by full name, by title + surname ("Captain Reeves"), or
 * by one distinctive word of a name that has a given name as well as a surname. A name that is
 * only a title and one word ("Mother Basalt") is named in full or not at all: "basalt" in a
 * cave and "mother of pearl" name no one (#2458). A campaign NPC the player may not have met
 * is named only in full. Used to offer the popup the creatures "him" can mean.
 */
export function actorsMentionedIn(
  text: string,
  actors: readonly CombatIntentActor[],
): CombatIntentActor[] {
  const haystack = ` ${normalize(text)} `;
  return actors.filter((actor) => {
    const name = normalize(actor.name);
    if (!name) return false;
    if (haystack.includes(` ${name} `)) return true;
    if (actor.source === 'campaign') return false;
    const nameWords = words(actor.name);
    const honorific = HONORIFIC_WORDS.has(nameWords[0] ?? '') ? nameWords[0] : undefined;
    const surname = nameWords[nameWords.length - 1];
    if (honorific && surname && haystack.includes(` ${honorific} ${surname} `)) return true;
    // A quoted nickname ("Iron" Jawn) is not a name on its own: "iron" in the narration is a
    // rail, not the man (#2445). The full name above still matches it.
    const nicknameWords = new Set(
      [...actor.name.matchAll(/["“]([^"”]+)["”]/g)].flatMap((quoted) => words(quoted[1])),
    );
    // Title and one more word, no nickname: nothing but the whole name names them.
    if (honorific && nameWords.length === 2 && nicknameWords.size === 0) return false;
    const distinctive = [
      nameWords.find((word) => !TITLE_WORDS.has(word) && !nicknameWords.has(word)),
      nameWords.length <= 3 ? nameWords[nameWords.length - 1] : undefined,
    ].filter((word) => word && !nicknameWords.has(word));
    return distinctive.some((word) => word && word.length >= 4 && haystack.includes(` ${word} `));
  });
}
