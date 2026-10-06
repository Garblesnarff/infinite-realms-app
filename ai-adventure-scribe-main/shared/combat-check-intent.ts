/**
 * Typed intent for the mid-combat checks of #2420, and the verbs that produce one.
 *
 * This is the translation step the issue names: a player who types "shove the goblin", "grapple
 * it", "hide behind the pillar" or "talk it down" mid-fight used to get narration with no roll
 * and no engine state. `detectCombatCheck` turns those sentences into a typed intent the engine
 * can resolve, and returns a REASON CODE for the ones it cannot — so an unrecognised check is
 * counted, not silently dropped.
 */

/** What the engine was asked to do, independent of how the player phrased it. */
export type CombatCheckIntentKind = 'shove' | 'grapple' | 'escape' | 'hide' | 'parley';

/**
 * The clauses that mean each check. Deliberately small and clause-head-anchored, like the
 * attack vocabulary in `combat-intent-prefilter`: the verb must lead the clause so "I do not
 * want to shove it" and "should I shove him?" never become actions.
 */
const CHECK_VERBS: Record<CombatCheckIntentKind, readonly string[]> = {
  shove: ['shove', 'push', 'barge', 'ram', 'shoulder'],
  grapple: ['grapple', 'grab', 'seize', 'wrestle', 'tackle'],
  // An escape is only the grapple: "escape" alone could as well be fleeing the room.
  escape: [
    'break free',
    'break the grapple',
    'escape the grapple',
    'escape the hold',
    'escape from the grapple',
    'wriggle free',
    'squirm free',
    'struggle free',
    'pull free',
    'twist free',
  ],
  hide: ['hide', 'sneak', 'skulk', 'conceal', 'take cover'],
  parley: ['persuade', 'intimidate', 'talk down', 'talk it down', 'reason with', 'appeal to'],
};

/** Which of the two Charisma skills a parley phrase asks for. Intimidation is its own verb. */
const PARLEY_SKILL_HINT: ReadonlyArray<[RegExp, 'persuade' | 'intimidate']> = [
  [/intimidat|threaten|scare|menac/, 'intimidate'],
  [/persuad|reason|appeal|plead|convince/, 'persuade'],
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest phrases first so "talk it down" wins over a bare "talk". */
const checkVerbPattern = new RegExp(
  `^(?:${[...Object.values(CHECK_VERBS).flat()]
    .sort((left, right) => right.length - left.length)
    .map((verb) => escapeRegExp(verb))
    .join('|')})\\b`,
  'i',
);

/**
 * A mid-combat sentence that looks like an ability check the engine does not run.
 *
 * The point is the log: "I try to convince the guard to stand down" reaches a DM that cannot
 * adjudicate it, and without this the turn vanishes with nothing to grep for.
 */
const UNOWNED_CHECK_PATTERN =
  /\b(?:persuad|intimidat|convince|reason with|appeal to|talk (?:it|him|her|them) down|bargain|negotiate|plead|coax|charm|seduce|bluff|feint|disguise)\b/i;

/** A typed mid-combat check, resolved against the roster. */
export interface CombatCheckIntent {
  kind: CombatCheckIntentKind;
  /** The clause's verb as the player wrote it, for the log line and the engine label. */
  verb: string;
  /** For a parley, which Charisma skill the phrasing asked for. Absent for the other three. */
  parleySkill?: 'persuade' | 'intimidate';
  /**
   * The creature the player named, resolved against the roster. Absent for a hide or an escape, which
   * targets no one — it is measured against the room's highest passive Perception.
   */
  targetName?: string;
}

/**
 * Why a mid-combat check produced no intent.
 *
 * `unrecognised_check` is the no-silent-drop case: the sentence named a check the engine has no
 * owner for, and it is logged so the vocabulary can be widened from evidence. The rest say
 * which guard declined, which is what makes a refused parse distinguishable from a turn that
 * was never a check at all.
 */
export type CombatCheckRejectionReason =
  | 'not_a_check'
  | 'hypothetical'
  | 'unrecognised_check'
  | 'no_target_actor';

export interface CombatCheckDetection {
  intent?: CombatCheckIntent;
  reason?: CombatCheckRejectionReason;
  /** The clause that was examined, for the log line. */
  clause: string;
}

interface CheckActor {
  name: string;
}

/** "Can I shove him?", "what if I grapple the ogre" — asking is not doing. */
const HYPOTHETICAL_CHECK =
  /\b(?:can|could|should|may|might|would|do|dare)\s+(?:i|we)\b|\bwhat\s+if\b/i;

/**
 * Quotes are the player or an NPC talking, not the player declaring an action.
 *
 * A straight apostrophe is deliberately NOT a quote mark: it is far more often the apostrophe in
 * a contraction ("I'll shove the goblin"), and treating it as one silently dropped the most
 * common way a player writes an intention.
 */
const isQuoted = (clause: string): boolean => /["“”]/.test(clause);

const stripLeadingPlayerIntent = (clause: string): string =>
  clause
    .trim()
    .replace(/^(?:and|then|also|ok|okay|so|now)\b[, ]*/i, '')
    .replace(/^(?:i|we)\s+/i, '')
    .replace(/^(?:try to|attempt to|attempt|want to|wanna|need to|decide to|choose to)\s+/i, '')
    .replace(/^(?:quickly|slowly|hard|forcefully|carefully|now|then)\s+/i, '')
    // Contractions first: "I'll shove" is `i` + `'ll`, not the bare `will` below.
    .replace(/^(?:i|we)['’](?:ll|m|d|ve)\s+/i, '')
    .replace(/^(?:will|would|can|could|should|shall|am|are)\s+/i, '')
    .trim();

/** Split on sentence ends, semicolons and commas — the same clause boundaries attacks use. */
const splitClauses = (input: string): string[] =>
  input
    .split(/(?<=[.!?;])|[,]/)
    .map((clause) =>
      clause
        .trim()
        .replace(/[.!?;,]+$/, '')
        .trim(),
    )
    .filter(Boolean);

/**
 * The creature a clause names, matched against the roster.
 *
 * Reuses the same containment rule the attack gate uses: a roster name whose words all appear
 * in the target phrase. Deliberately not a pronoun resolver — "shove it" with several hostiles
 * on the board is genuinely ambiguous, and the caller is better off not resolving than resolving
 * to the wrong goblin.
 */
function matchTarget(clause: string, actors: readonly CheckActor[]): string | undefined {
  const words = clause
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const wordSet = new Set(words);
  let best: { name: string; length: number } | undefined;
  for (const actor of actors) {
    const nameWords = actor.name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (!nameWords.length) continue;
    const matched = nameWords.filter((word) => wordSet.has(word)).length;
    if (matched === nameWords.length && (!best || nameWords.length > best.length)) {
      best = { name: actor.name, length: nameWords.length };
    }
  }
  return best?.name;
}

const parleySkillFor = (clause: string): 'persuade' | 'intimidate' =>
  PARLEY_SKILL_HINT.find(([pattern]) => pattern.test(clause))?.[1] ?? 'persuade';

/** "shove IT", "talk IT down" — the pronoun the issue's own examples use. */
const PRONOUN_TARGETS = new Set(['it', 'him', 'her', 'them', 'that', 'this']);

/**
 * The creature a check clause targets: the name it names, or an unambiguous pronoun.
 *
 * A pronoun resolves ONLY when the roster has a single candidate, which is the same rule the
 * attack gate uses (`combat-intent-gate.ts`). With two goblins on the board "grapple it" is
 * genuinely ambiguous, and guessing would shove the wrong one — so the caller is told
 * `no_target_actor` and the turn falls through to be asked, not silently resolved.
 */
function matchCheckTarget(clause: string, actors: readonly CheckActor[]): string | undefined {
  const named = matchTarget(clause, actors);
  if (named) return named;
  const words = clause
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const pronouns = words.filter((word) => PRONOUN_TARGETS.has(word));
  if (!pronouns.length || actors.length !== 1) return undefined;
  return actors[0].name;
}

/**
 * Translate one mid-combat player message into a typed check intent.
 *
 * Returns the first clause that names a check the engine owns. A clause that names a check the
 * engine does NOT own comes back with `reason: 'unrecognised_check'` so the caller can log it;
 * a clause that is not a check at all comes back with `reason: 'not_a_check'`, which is the
 * ordinary path for ordinary conversation.
 */
export function detectCombatCheck(
  playerInput: string,
  actors: readonly CheckActor[] = [],
): CombatCheckDetection {
  if (typeof playerInput !== 'string' || !playerInput.trim()) {
    return { reason: 'not_a_check', clause: '' };
  }

  let unowned: string | null = null;
  for (const rawClause of splitClauses(playerInput)) {
    if (isQuoted(rawClause)) continue;
    if (HYPOTHETICAL_CHECK.test(rawClause)) continue;

    const clause = stripLeadingPlayerIntent(rawClause);
    const verbMatch = checkVerbPattern.exec(clause);
    if (verbMatch) {
      const verb = verbMatch[0].toLowerCase();
      const kind = (Object.keys(CHECK_VERBS) as CombatCheckIntentKind[]).find((candidate) =>
        CHECK_VERBS[candidate].some((word) => word.toLowerCase() === verb),
      );
      if (!kind) continue;
      // A hide is measured against whoever is searching, and an escape against whoever holds the
      // actor, so neither names a target of its own.
      const needsTarget = kind !== 'hide' && kind !== 'escape';
      const targetName = needsTarget ? matchCheckTarget(clause, actors) : undefined;
      if (needsTarget && !targetName) {
        return { reason: 'no_target_actor', clause: rawClause };
      }
      return {
        intent: {
          kind,
          verb,
          ...(kind === 'parley' ? { parleySkill: parleySkillFor(clause) } : {}),
          ...(targetName ? { targetName } : {}),
        },
        clause: rawClause,
      };
    }

    // A check the engine has no owner for, remembered so the loop can report it below.
    if (!unowned && UNOWNED_CHECK_PATTERN.test(clause)) unowned = rawClause;
  }

  if (unowned) return { reason: 'unrecognised_check', clause: unowned };
  return { reason: 'not_a_check', clause: '' };
}
