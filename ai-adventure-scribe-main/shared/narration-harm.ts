/**
 * Claims of harm in DM narration, for turns the engine resolved nothing for (#2342, #2373).
 *
 * Shared because two places must agree on what counts: the client gate that rejects a reply
 * (`src/hooks/ai/narration-gate.ts`) and the server, which must not write a provisional copy of
 * a reply the client is about to reject (`dm-reply-persistence.ts`, #2218). Pure text in, phrases
 * out; no imports.
 *
 * Every pattern needs a cue that the harm lands on the player or is the engine's arithmetic
 * ("hit points", "4 damage"): a bare `hit`, `strike` or `wounded` is also "the smell hits you",
 * "lightning strikes the tower" and "a wounded soldier", and a false positive costs a
 * regeneration now that the check is enforced.
 */

const ATTACK_NOUN = 'strike|blow|attack|swing|slash|stab|lunge|hit|bite|claw|punch|kick|thrust';
const ATTACK_VERB =
  'strikes?|struck|striking|hits?|hitting|slash(?:es|ed)|stab(?:s|bed)|lash(?:es|ed)|bites?|bit|' +
  'claw(?:s|ed)|club(?:s|bed)|smash(?:es|ed)|slam(?:s|med)|punch(?:es|ed)|kick(?:s|ed)|' +
  'pierc(?:es|ed)|graz(?:es|ed)|clips?|clipped|scorch(?:es|ed)|singe[sd]?';
const CONDITION = 'poisoned|paraly[sz]ed|unconscious|petrified|incapacitated|restrained|grappled';
const INJURY = 'wounded|injured|bloodied|bleeding|hurt';
/** What a creature hurts with: "the claw catches you", "the claws rake across your ribs". */
const NATURAL_WEAPON = 'claws?|talons?|fangs?|teeth|nails?|blade|dagger|fist|horns?|tail';

const HARM_PATTERNS: RegExp[] = [
  // "it strikes you", "hits your shoulder", "attacks you". The only capture group is a leading
  // "you", the player as the subject ("you strike your foe"), which is skipped below. "strikes
  // your blade against the anvil" is someone using the player's blade, not hitting the player.
  new RegExp(
    `(\\byou\\s+)?\\b(?:${ATTACK_VERB}|attacks?|attacked|lunges?|lunged)\\s+(?:at\\s+)?(?:you|yourself|your\\s+\\w+)\\b(?!\\s+against\\b)`,
    'gi',
  ),
  // "a strike from the entity", "an attack by the guard".
  new RegExp(
    `\\b(?:${ATTACK_NOUN})s?\\s+(?:from|by)\\s+(?:the|its|his|her|their|a|an)\\s+\\w+`,
    'gi',
  ),
  // "you narrowly avoid a strike": the attack is asserted even as it is dodged.
  new RegExp(
    `\\b(?:avoid|dodge|evade|duck|sidestep|parry|deflect|block|slip)\\w*\\s+(?:\\w+\\s+){0,3}?(?:${ATTACK_NOUN})s?\\b`,
    'gi',
  ),
  // "a glancing blow still leaves you rattled".
  /\b(?:blow|strike|hit|attack|slash|stab|lunge|swing)s?\b[^.!?,;:]{0,40}?\b(?:leaves?|leaving|catches?|catching|clips?|grazes?|glances? off)\s+you\b/gi,
  // "the claw catches you", "the claws rake across your ribs".
  new RegExp(`\\b(?:${NATURAL_WEAPON})\\s+(?:\\w+\\s+)?catch(?:es)?\\s+you\\b`, 'gi'),
  new RegExp(
    `\\b(?:${NATURAL_WEAPON})\\s+(?:rake|rakes|raked|tear|tears|tore|rip|rips|ripped|gouge|gouges|gouged|score|scores|scored)\\b[^.!?]{0,30}\\byour\\b`,
    'gi',
  ),
  // "blood runs down your arm".
  /\bblood\s+(?:runs?|trickles?|streams?|pours?|wells?|drips?|seeps?|flows?|spills?)\b[^.!?]{0,30}\b(?:your|you)\b/gi,
  // Wounds need the player as the one wounded: "wounds you", "you are wounded", "leaves you
  // feeling rattled and wounded". "You see a wounded soldier" and "You notice the bleeding stag"
  // name someone else's injury, so a copula or a "leaves you" construction is required.
  /\bwound(?:s|ed|ing)?\s+you\b/gi,
  new RegExp(
    `\\byou(?:['’]re|\\s+are|\\s+were|\\s+feel|\\s+felt|\\s+look|\\s+remain|\\s+grow|\\s+become|\\s+get|\\s+got)\\s+(?:\\w+\\s+){0,2}?(?:wounded|injured|bloodied|bleeding)\\b`,
    'gi',
  ),
  /\byou(?:['’]re|\s+are|\s+were|\s+get|\s+got)\s+hurt\b/gi,
  new RegExp(`\\b(?:leaves?|leaving|left)\\s+you\\s+(?:[\\w'’-]+\\s+){0,4}?(?:${INJURY})\\b`, 'gi'),
  /\byou\s+(?:stagger|stumble|reel|recoil|lurch)\w*\b[^.!?]{0,25}\b(?:hurt|wounded|bleeding)\b/gi,
  // "you feel a searing pain".
  /\byou\s+(?:feel|felt)\s+(?:an?\s+)?(?:\w+\s+){0,2}?(?:pain|agony)\b/gi,
  // "hit points", "HP", "4 points of damage", "you take damage".
  /\bhit points?\b|\bhp\b|\b\d+\s+(?:points?\s+of\s+)?(?:[a-z]+\s+)?damage\b/gi,
  /\b(?:take|takes|took|suffer|suffers|suffered|deal|deals|dealt)\s+(?:[a-z]+\s+){0,2}damage\b/gi,
  // "you are poisoned", "leaves you paralyzed", "knocked prone".
  new RegExp(
    `\\b(?:you|you['’]re|leaves?\\s+you|leaving\\s+you)\\s+(?:(?:are|be|feel|feeling|now|suddenly|become|becoming|remain|still)\\s+)*(?:${CONDITION})\\b`,
    'gi',
  ),
  /\bknocked\s+(?:you\s+)?(?:prone|unconscious|down)\b/gi,
  // The DM narrating the player character's death for a turn the engine resolved nothing
  // for (#468, Hark NT-106: a lethal free-text action narrated as final death with no roll,
  // while the sheet still showed full HP). Anchored on the player ("you") — an NPC's death
  // ("the goblin dies") is not a fabrication. Hypotheticals ("you would die", "if you die")
  // are excluded by isHypotheticalDeath below; "your death saving throw" is excluded by the
  // negative lookahead.
  /\byou\s+die\b/gi,
  /\byou\s+(?:\w+\s+and\s+)?die\b/gi,
  /\byou\s+(?:are|were)\s+dead\b/gi,
  /\byou['’]re\s+dead\b/gi,
  /\bkill(?:s|ed|ing)?\s+you\b/gi,
  /\bslay(?:s|ed|ing)?\s+you\b/gi,
  /\byour\s+death\b(?!\s+saving)/gi,
  // #468 NT-106: "Your journey through the chasm ends here" — the journey ending is death.
  /\b(?:your|the)\s+(?:journey|quest|adventure|tale|story)\b[^.!?]{0,40}?\bends?\s+here\b/gi,
];

/** The player casting or striking, which only a turn where the player did nothing can fabricate. */
const PLAYER_ACT_PATTERN = /\byour spell\b/gi;

/** "the smell hits you", "rain hits your face": a verb of impact with a subject that is no attacker. */
const FIGURATIVE_SUBJECT =
  /\b(?:smell|scent|stench|odou?r|aroma|reek|wave|heat|cold|chill|gust|wind|breeze|draft|rain|hail|snow|sleet|spray|mist|fog|smoke|steam|dust|sand|ash|sunlight|moonlight|realization|fatigue|exhaustion|silence|weight|sound|noise|glare|light|memory|nausea|dizziness|warmth)\s+(?:of\s+[\w-]+\s+)?$/i;

const NEGATOR = /\b(?:no|not|never|without|nor|neither|cannot)\b|n['’]t\b/i;
/** "Nothing hits you" negates; "Nothing stops the goblin as it hits you" does not. */
const ADJACENT_NEGATOR = /\b(?:nothing|none)\b/i;
/** A negation does not reach across these: "does not respond, but its strike hits you". */
const CLAUSE_BREAK = /[,;:]|\b(?:but|though|although|yet|however)\b/i;

/**
 * "you would die if you jumped", "if you die, your friends mourn", "you die if you touch
 * the altar": a hypothetical death is a warning, not a death claim (#468). Examines the
 * sentence for conditional modals before the match and "if" anywhere in the sentence.
 * Also excludes threats and attempts ("I will kill you", "trying to kill you") — the
 * killing hasn't happened. Only applies to death claims — other harm patterns keep their
 * existing behavior.
 */
function isHypotheticalDeath(text: string, index: number, matched: string): boolean {
  if (!/\b(?:die|dead|death|kill(?:s|ed|ing)?|slay(?:s|ed|ing)?)\b/i.test(matched)) return false;
  const boundary = Math.max(
    text.lastIndexOf('.', index - 1),
    text.lastIndexOf('!', index - 1),
    text.lastIndexOf('?', index - 1),
  );
  const sentenceStart = boundary + 1;
  const sentenceEnd = (() => {
    const rest = text.slice(index + matched.length);
    const m = /[.!?]/.exec(rest);
    return m ? index + matched.length + m.index : text.length;
  })();
  const beforeMatch = text.slice(sentenceStart, index);
  const sentence = text.slice(sentenceStart, sentenceEnd);
  // Conditional modals before the match, or "if" anywhere in the sentence.
  if (/\b(?:would|could|might|can|may)\b/i.test(beforeMatch)) return true;
  if (/\bif\b/i.test(sentence)) return true;
  // Threats and attempts: the killing hasn't happened.
  // ('ll covers both the ASCII and curly apostrophe.)
  if (/\b(?:will|'ll|’ll)\b/i.test(beforeMatch.slice(-20))) return true;
  if (/\b(?:trying|tries|attempting|attempts|about|going|want|wants)\s+to\s*$/i.test(beforeMatch)) {
    return true;
  }
  // "Move and you die": an imperative threat, not a death claim. The "you die" is what
  // happens IF you move, not what has happened.
  if (/^\s*\w+\s+and\s+you\s+die\b/i.test(sentence) && !/^\s*you\b/i.test(sentence)) {
    return true;
  }
  return false;
}

/** "no damage was dealt", "does not strike you", "without any hit": the DM honouring the note. */
function isNegated(text: string, index: number, matched: string): boolean {
  if (NEGATOR.test(matched)) return true;
  const sentenceStart = Math.max(
    text.lastIndexOf('.', index - 1),
    text.lastIndexOf('!', index - 1),
    text.lastIndexOf('?', index - 1),
  );
  const clause =
    text
      .slice(sentenceStart + 1, index)
      .split(CLAUSE_BREAK)
      .pop() ?? '';
  const words = clause.trim().split(/\s+/);
  return (
    NEGATOR.test(words.slice(-6).join(' ')) || ADJACENT_NEGATOR.test(words.slice(-2).join(' '))
  );
}

/**
 * The harm the DM text asserts for a turn the engine resolved nothing for, as the matched
 * phrases (empty when the text is clean). `playerMayHaveActed` is for a turn outside combat,
 * where "your spell lights the corridor" is the player's own action narrated; on a combat turn
 * the player did nothing, so a spell of theirs is invented.
 */
export function fabricatedOutcomeClaims(
  text: string | null | undefined,
  options: { playerMayHaveActed?: boolean } = {},
): string[] {
  const phrases = new Set<string>();
  for (const claim of fabricatedOutcomeClaimSpans(text, options)) {
    phrases.add(claim.match);
  }
  return [...phrases].slice(0, 5);
}

/**
 * The same claims as `fabricatedOutcomeClaims`, one entry per surviving occurrence,
 * carrying the occurrence's position in the text. The splicer works on indices, and
 * only the flagged occurrence's index resolves the cases the phrase list cannot tell
 * apart: a phrase repeated in two sentences, or a negated / figurative first use of a
 * phrase a later sentence uses in earnest.
 */
export function fabricatedOutcomeClaimSpans(
  text: string | null | undefined,
  { playerMayHaveActed = false }: { playerMayHaveActed?: boolean } = {},
): OutcomeClaim[] {
  const source = text ?? '';
  const patterns = playerMayHaveActed ? HARM_PATTERNS : [...HARM_PATTERNS, PLAYER_ACT_PATTERN];
  const claims: OutcomeClaim[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const matched = match[0];
      if (match[1]) continue;
      if (isNegated(source, index, matched)) continue;
      if (isHypotheticalDeath(source, index, matched)) continue;
      if (FIGURATIVE_SUBJECT.test(source.slice(Math.max(0, index - 40), index))) continue;
      claims.push({ match: matched.trim().toLowerCase().slice(0, 80), index });
    }
  }
  return claims;
}

export function suspectsFabricatedOutcome(
  text: string | null | undefined,
  options?: { playerMayHaveActed?: boolean },
): boolean {
  return fabricatedOutcomeClaims(text, options).length > 0;
}

/**
 * The engine's authoritative verdict for the turn (#266): a roll the dice decided, an attack
 * the engine resolved. `true` = the check succeeded / the attack hit; `false` = it failed /
 * missed. Mirrors `PersistedRollOutcome`'s `success`, the field the DM prompt already carries
 * as `lastRollOutcome`. `characterName` lets claims anchor on the player character as well as
 * "you" — an NPC's success ("the guard successfully spots you") is not a contradiction.
 * `description`/`requestType` are the roll's own words for the attempted action; soft verdict
 * language ("you manage to", "you are successful") only contradicts when its sentence names
 * the action — "you manage to catch your breath" after a failed Stealth check is recovery,
 * not a verdict on the check.
 */
export interface EngineOutcome {
  success: boolean;
  characterName?: string;
  description?: string;
  requestType?: string;
}

/** A contradicting phrase and where it occurs in the text. Indices let the splicer work in
 * text order instead of pattern order (strategist FIX: reversed-order, repeated-phrase and
 * negated-first cases). */
export interface OutcomeClaim {
  match: string;
  index: number;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Attack nouns whose miss can contradict an engine hit. */
const MISS_NOUN = 'strike|attack|blow|shot|arrow|blade|swing';

/**
 * Attack nouns for dismissal claims (#467). Extends MISS_NOUN with the words the DM uses
 * when waving an attack off: "ignores your magical assault", "shrugs off your spell".
 */
const DISMISS_NOUN = `${MISS_NOUN}|assault|spell|magic`;

interface OutcomePattern {
  re: RegExp;
  /** Soft verdict language ("manage to", "successful"): needs the rolled action named. */
  soft: boolean;
  /** A miss claim: skipped when the attack belongs to someone but the player. */
  miss: boolean;
  /**
   * A dismissal claim ("ignores your assault"): the DM narrating the player's attack as
   * having no effect. Like a miss, but only contradicts a hit — for a miss, "ignores your
   * assault" is consistent. The patterns anchor on "your", so no possessor/target check.
   */
  dismiss?: boolean;
}

/**
 * The DM asserting the player came off, contradicting a FAILED engine verdict. "you succeed"
 * is explicit verdict language; "you manage to" / "you are successful" are soft and need the
 * action anchoring below. Every pattern anchors on the player ("you …", "but succeed …") —
 * the character-name variants are built per outcome below. An NPC's success never matches.
 */
const YOU_SUCCESS: OutcomePattern[] = [
  { re: /\byou\s+succeed(?:s|ed)?\b/gi, soft: false, miss: false },
  { re: /\byou\s+manage[sd]?\s+to\b/gi, soft: true, miss: false },
  { re: /\byou\s+(?:are\s+)?successful(?:ly)?\b/gi, soft: true, miss: false },
  // "you fail to notice, but succeed in slipping past": the subject carries across the "but".
  { re: /\bbut\s+succeed(?:s|ed)?\b/gi, soft: false, miss: false },
];

/**
 * The DM asserting the player fell flat, contradicting a SUCCESSFUL engine verdict. "you fail"
 * is explicit; "you are unsuccessful" is soft (same action anchoring as the success side).
 */
const YOU_FAILURE: OutcomePattern[] = [
  { re: /\byou\s+fail(?:s|ed)?\b/gi, soft: false, miss: false },
  { re: /\byou\s+(?:are\s+)?unsuccessful(?:ly)?\b/gi, soft: true, miss: false },
];

/**
 * The DM narrating the player's attack as a miss, contradicting a SUCCESSFUL engine verdict
 * (an engine hit). A bare "miss" is deliberately absent: "you miss the sunrise" is not a
 * failed attack — a miss only counts with an attack noun in the same clause. And only the
 * PLAYER's attack counts: "the goblin's arrow misses you" is the monster's miss, not a
 * contradiction of the player's hit, so an attack noun possessed by anyone but the player is
 * skipped (see hasNonPlayerPossessor). "goes wide" / "falls short" likewise need the attack
 * noun: "his eyes go wide" is not a miss.
 */
const ATTACK_MISS: OutcomePattern[] = [
  { re: new RegExp(`\\b(?:${MISS_NOUN})s?\\b[^.!?]{0,40}?\\bmiss(?:es|ed)?\\b`, 'gi'), soft: false, miss: true },
  { re: new RegExp(`\\bmiss(?:es|ed)?\\b[^.!?]{0,40}?\\b(?:${MISS_NOUN})s?\\b`, 'gi'), soft: false, miss: true },
  { re: new RegExp(`\\b(?:${MISS_NOUN})s?\\b[^.!?]{0,40}?\\b(?:go|goes|went)\\s+wide\\b`, 'gi'), soft: false, miss: true },
  { re: new RegExp(`\\b(?:go|goes|went)\\s+wide\\b[^.!?]{0,40}?\\b(?:${MISS_NOUN})s?\\b`, 'gi'), soft: false, miss: true },
  { re: new RegExp(`\\b(?:${MISS_NOUN})s?\\b[^.!?]{0,40}?\\b(?:fall|falls|fell)\\s+short\\b`, 'gi'), soft: false, miss: true },
  { re: new RegExp(`\\b(?:fall|falls|fell)\\s+short\\b[^.!?]{0,40}?\\b(?:${MISS_NOUN})s?\\b`, 'gi'), soft: false, miss: true },
];

/**
 * The DM narrating the player's attack as having no effect, contradicting a SUCCESSFUL engine
 * verdict (an engine hit). "The mechanical server ignores your magical assault" after the
 * engine logged HIT 17+5=22 for 8 damage (#467, Hark NT-013). Only contradicts a hit: for a
 * miss, "ignores your assault" is consistent. Anchored on the player's attack ("your ..."),
 * and only on attack rolls like the miss patterns.
 */
const ATTACK_DISMISS: OutcomePattern[] = [
  {
    re: new RegExp(
      `\\bignor(?:e|es|ed|ing)\\s+your\\b[^.!?,;:]{0,40}?\\b(?:${DISMISS_NOUN})s?\\b`,
      'gi',
    ),
    soft: false,
    miss: false,
    dismiss: true,
  },
  {
    re: new RegExp(
      `\\bshrug(?:s|ged|ging)?\\s+off\\s+your\\b[^.!?,;:]{0,40}?\\b(?:${DISMISS_NOUN})s?\\b`,
      'gi',
    ),
    soft: false,
    miss: false,
    dismiss: true,
  },
  {
    re: new RegExp(
      `\\byour\\b[^.!?,;:]{0,40}?\\b(?:${DISMISS_NOUN})s?\\b[^.!?,;:]{0,40}?\\b(?:has|have|had)\\s+no\\s+effect\\b`,
      'gi',
    ),
    soft: false,
    miss: false,
    dismiss: true,
  },
  {
    re: new RegExp(
      `\\bunaffected\\s+by\\s+your\\b[^.!?,;:]{0,40}?\\b(?:${DISMISS_NOUN})s?\\b`,
      'gi',
    ),
    soft: false,
    miss: false,
    dismiss: true,
  },
];

/** Subject-anchored success/failure claims for the named player character. */
function namePatterns(name: string, success: boolean): OutcomePattern[] {
  const n = escapeRegExp(name);
  return success
    ? [
        { re: new RegExp(`\\b${n}\\s+fail(?:s|ed)?\\b`, 'gi'), soft: false, miss: false },
        {
          re: new RegExp(`\\b${n}\\s+(?:is\\s+|are\\s+)?unsuccessful(?:ly)?\\b`, 'gi'),
          soft: true,
          miss: false,
        },
        // "Mira's swing misses the goblin": the named character's attack narrated as a miss.
        {
          re: new RegExp(
            `\\b${n}['’]s\\s+(?:${MISS_NOUN})s?\\b[^.!?]{0,40}?\\bmiss(?:es|ed)?\\b`,
            'gi',
          ),
          soft: false,
          miss: true,
        },
        // "The server ignores Mira's assault": the named character's attack waved off (#467).
        {
          re: new RegExp(
            `\\bignor(?:e|es|ed|ing)\\s+${n}['’]s\\b[^.!?,;:]{0,40}?\\b(?:${DISMISS_NOUN})s?\\b`,
            'gi',
          ),
          soft: false,
          miss: false,
          dismiss: true,
        },
        // "The server shrugs off Mira's assault", "Mira's spell has no effect".
        {
          re: new RegExp(
            `\\bshrug(?:s|ged|ging)?\\s+off\\s+${n}['’]s\\b[^.!?,;:]{0,40}?\\b(?:${DISMISS_NOUN})s?\\b`,
            'gi',
          ),
          soft: false,
          miss: false,
          dismiss: true,
        },
        {
          re: new RegExp(
            `\\b${n}['’]s\\b[^.!?,;:]{0,40}?\\b(?:${DISMISS_NOUN})s?\\b[^.!?,;:]{0,40}?\\b(?:has|have|had)\\s+no\\s+effect\\b`,
            'gi',
          ),
          soft: false,
          miss: false,
          dismiss: true,
        },
      ]
    : [
        { re: new RegExp(`\\b${n}\\s+succeed(?:s|ed)?\\b`, 'gi'), soft: false, miss: false },
        { re: new RegExp(`\\b${n}\\s+manage[sd]?\\s+to\\b`, 'gi'), soft: true, miss: false },
        {
          re: new RegExp(`\\b${n}\\s+(?:is\\s+|are\\s+)?successful(?:ly)?\\b`, 'gi'),
          soft: true,
          miss: false,
        },
      ];
}

/** Words too generic to anchor a verdict on the rolled action. */
const ACTION_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'on',
  'in',
  'at',
  'by',
  'with',
  'and',
  'or',
  'your',
  'you',
  'my',
  'check',
  'roll',
  'test',
  'attempt',
  'action',
]);

/**
 * The rolled action's content words ("Stealth check to climb the shaft unheard" →
 * stealth, climb, shaft, unheard), for anchoring soft verdict language on the player's own
 * action. Empty when the outcome names no action, in which case soft claims stand as before.
 * Exported for the server's premature-claim pass (narration-outcome.ts), which must anchor
 * verdict sentences on the SAME vocabulary — a second copy of the stopword list would drift.
 */
export function actionKeywords(outcome: EngineOutcome): string[] {
  const text = `${outcome.requestType ?? ''} ${outcome.description ?? ''}`.toLowerCase();
  const words = text
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !ACTION_STOPWORDS.has(word));
  return [...new Set(words)];
}

/**
 * The spell or weapon name from an attack-roll description, as its content words
 * ("Chill Touch spell attack vs Mechanical Server" → chill, touch; "Longsword attack
 * vs Goblin — 1d20+7 vs AC 15" → longsword). The dynamic dismiss pattern ("ignores your
 * Chill Touch") must only match the thing the player attacked with — matching every
 * content word of the roll would also match the target's name ("ignores your Mechanical
 * Server"), which is not a dismissal of the attack (#467 nit).
 */
function attackNameKeywords(outcome: EngineOutcome): string[] {
  const description = outcome.description ?? '';
  const name = /^(.*?)\s+(?:spell\s+)?attack\s+(?:vs|on|against)\s+/i.exec(description)?.[1]?.trim();
  if (!name) return [];
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !ACTION_STOPWORDS.has(word));
  return [...new Set(words)];
}

/**
 * "the goblin's arrow", "an ogre's blow": an attack noun possessed by someone other than the
 * player. Their miss is not the player's miss and cannot contradict the player's engine hit.
 * "your arrow" and "<name>'s swing" are the player's own and pass through.
 */
function hasNonPlayerPossessor(sentence: string, name: string | undefined): boolean {
  const player = name ? `(?:your|${escapeRegExp(name)})` : 'your';
  // The possessor must start with a word char: without it the match can begin mid-possessor
  // (the "'s" of "Mira's") and the player's own attack would read as someone else's.
  return new RegExp(`\\b(?!${player}\\b)\\w[\\w'’-]*['’]s\\s+(?:${MISS_NOUN})s?\\b`, 'i').test(
    sentence,
  );
}

/**
 * The sentence (by `.`/`!`/`?`) containing `index`, for anchoring and splicing. Exported
 * for the server's premature-claim pass (narration-outcome.ts): a claim must be judged
 * against the same sentence the splicer would replace, so the boundary rule lives once.
 */
export function sentenceSpan(text: string, index: number): { start: number; end: number } {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
      start = i + 1;
      break;
    }
  }
  // Skip the separator's trailing whitespace so a splice does not glue sentences together.
  while (start < index && /\s/.test(text[start] ?? '')) start++;
  let end = text.length;
  for (let i = index; i < text.length; i++) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
      end = i + 1;
      break;
    }
  }
  return { start, end };
}

/**
 * Negation scoped to the matched verb phrase (#266 review): only a negator in the 3 words
 * immediately before the match can undo it. A "not" in an earlier clause ("The guard does not
 * notice you and you succeed") does not reach the verb. "not only"/"not just" is emphasis,
 * not negation ("Not only do you succeed").
 */
function isOutcomeClaimNegated(text: string, index: number): boolean {
  const words = text.slice(0, index).trim().split(/\s+/);
  const window = words.slice(-3).join(' ');
  if (/\bnot\s+(only|just)\b/i.test(window)) return false;
  return NEGATOR.test(window);
}

/**
 * Whether the outcome is for an attack roll (requestType names it). A miss narration only
 * contradicts an attack roll; a failed Stealth check is not contradicted by "an arrow misses".
 */
function isAttackRoll(outcome: EngineOutcome): boolean {
  return !!outcome.requestType && /attack/i.test(outcome.requestType);
}

/**
 * The dismissal names a spell ("ignores your spell", "unaffected by your magic") rather
 * than a weapon attack (#467 B4). Only contradicts when the rolled attack looks like a
 * spell — checked against the outcome's own words.
 */
function isSpellNounDismissal(matched: string): boolean {
  return /\b(?:spells?|magic)\b/i.test(matched);
}

/** The outcome's description suggests a spell attack ("Fireball spell", "magic missile"). */
function isSpellAttack(outcome: EngineOutcome): boolean {
  const text = `${outcome.requestType ?? ''} ${outcome.description ?? ''}`.toLowerCase();
  return /\b(?:spell|magic|cantrip)\b/.test(text);
}

/**
 * Generic verbs in a roll description that never name a target ("Roll 1d20 to attack the
 * goblin"). Alongside MISS_NOUN and requestType words, these are stripped from miss-target
 * matching so a generic word in the narration cannot anchor the player's attack.
 */
const MISS_TARGET_GENERIC_VERBS = new Set([
  'roll',
  'make',
  'makes',
  'made',
  'take',
  'takes',
  'took',
  'use',
  'uses',
  'used',
  'cast',
  'casts',
  'hurl',
  'hurls',
  'hurled',
  'throw',
  'throws',
  'threw',
  'thrown',
  'fire',
  'fires',
  'fired',
  'aim',
  'aims',
  'aimed',
  'lunge',
  'lunges',
  'lunged',
  'thrust',
  'thrusts',
  'slash',
  'slashes',
  'slashed',
  'stab',
  'stabs',
  'stabbed',
]);

/**
 * The rolled target's own words, for miss anchoring (strategist FIX round 4). Unlike
 * actionKeywords, this excludes the requestType ("attack") and generic words: "An attack
 * from the dark misses you" contains the word "attack" but names no target, so it must not
 * count as the player's attack missing. MISS_NOUN words are stripped in singular and
 * plural ("Attack the goblin with your sword" → goblin, sword).
 */
function missTargetKeywords(outcome: EngineOutcome): string[] {
  const missNouns = new Set(MISS_NOUN.split('|'));
  const requestWords = new Set(
    (outcome.requestType ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
  );
  const seen = new Set<string>();
  for (const word of (outcome.description ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length <= 2 || ACTION_STOPWORDS.has(word)) continue;
    const singular = word.endsWith('s') ? word.slice(0, -1) : word;
    if (missNouns.has(word) || missNouns.has(singular)) continue;
    if (requestWords.has(word) || requestWords.has(singular)) continue;
    if (MISS_TARGET_GENERIC_VERBS.has(word) || MISS_TARGET_GENERIC_VERBS.has(singular)) continue;
    seen.add(word);
  }
  return [...seen];
}

/**
 * "An arrow from the dark misses you": an unpossessed attack noun is not the player's miss
 * unless the clause names the player's target (the target's own words from the roll
 * description — not the requestType, not generic words). "Your arrow" / "<name>'s swing"
 * is the player's own and always counts.
 */
function isPlayerMiss(sentence: string, name: string | undefined, outcome: EngineOutcome): boolean {
  const player = name ? `(?:your|${escapeRegExp(name)})` : 'your';
  // "your arrow", "Mira's swing": the player's own attack.
  if (new RegExp(`\\b${player}(?:['\u2019]s)?\\s+(?:${MISS_NOUN})s?\\b`, 'i').test(sentence)) {
    return true;
  }
  // Unpossessed ("an arrow misses"): only if the clause names the rolled target.
  const targets = missTargetKeywords(outcome);
  return (
    targets.length > 0 &&
    targets.some((target) => sentence.toLowerCase().includes(target))
  );
}

/**
 * The phrases where the DM's text asserts the opposite of the engine's verdict (empty when the
 * text follows it). A failed check may still have a consequence — noise, a cost, damage — so
 * only explicit verdict language with the player as the subject contradicts; soft verdict
 * language ("you manage to") additionally needs the sentence to name the rolled action, and a
 * miss only counts for the player's own attack on an attack roll.
 */
export function contradictsEngineOutcome(
  text: string | null | undefined,
  outcome: EngineOutcome,
): OutcomeClaim[] {
  const source = text ?? '';
  const base = outcome.success
    ? [...YOU_FAILURE, ...ATTACK_MISS, ...ATTACK_DISMISS]
    : YOU_SUCCESS;
  // The name crosses the HTTP boundary on combatEntry (llm.ts), so it is validated here
  // rather than trusted: a non-string must not reach the pattern builder.
  const rawName = outcome.characterName;
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
  const patterns = name ? [...base, ...namePatterns(name, outcome.success)] : base;
  const keywords = actionKeywords(outcome);
  // "ignores your Chill Touch": the DM names the specific spell, not a generic noun.
  // Built from the spell/weapon name alone — not every content word of the roll — so
  // the target's name can never match (#467 nit).
  const nameKeywords = attackNameKeywords(outcome);
  if (outcome.success && nameKeywords.length > 0) {
    const kwAlt = nameKeywords.map(escapeRegExp).join('|');
    patterns.push({
      re: new RegExp(
        `\\bignor(?:e|es|ed|ing)\\s+your\\b[^.!?,;:]{0,40}?\\b(?:${kwAlt})\\b`,
        'gi',
      ),
      soft: false,
      miss: false,
      dismiss: true,
    });
  }
  const claims: OutcomeClaim[] = [];
  for (const { re, soft, miss, dismiss } of patterns) {
    for (const match of source.matchAll(re)) {
      const index = match.index ?? 0;
      if (isOutcomeClaimNegated(source, index)) continue;
      const span = sentenceSpan(source, index);
      const sentence = source.slice(span.start, span.end);
      // "the goblin's arrow misses you": someone else's attack missing is not the player's
      // miss, so it cannot contradict the player's engine hit.
      if (miss && hasNonPlayerPossessor(sentence, name)) continue;
      // "An arrow from the dark misses you": a miss only contradicts when the roll is an
      // attack, and the noun is the player's ("your"/name) or the clause names the rolled
      // target. A failed skill check is not contradicted by someone else's arrow.
      if (miss && (!isAttackRoll(outcome) || !isPlayerMiss(sentence, name, outcome))) continue;
      // "ignores your assault": a dismissal only contradicts an attack roll's hit. The
      // patterns anchor on the player's own attack ("your"), so no possessor/target check.
      // "unaffected by your magic" after a sword hit is consistent (B4): spell/magic nouns
      // only contradict when the rolled attack looks like a spell.
      if (dismiss && !isAttackRoll(outcome)) continue;
      if (dismiss && isSpellNounDismissal(match[0]) && !isSpellAttack(outcome)) continue;
      // "ignores your taunt, but your assault strikes true": the dismissal scopes to a
      // different clause than the attack noun (B5). The DM affirmed the hit.
      if (dismiss && CLAUSE_BREAK.test(match[0])) continue;
      // "you manage to catch your breath" after a failed Stealth check: soft verdict language
      // only contradicts when the sentence names the rolled action. With no action words on
      // the outcome there is nothing to anchor on, so the claim stands as before.
      if (
        soft &&
        keywords.length > 0 &&
        !keywords.some((keyword) => sentence.toLowerCase().includes(keyword))
      ) {
        continue;
      }
      claims.push({ match: match[0].trim().toLowerCase().slice(0, 80), index });
      if (claims.length >= 5) break;
    }
    if (claims.length >= 5) break;
  }
  return claims;
}

/**
 * Removes the contradicting sentences from a reply, stating the engine's truth once where the
 * first false claim stood (#266). Only the contradicting sentences go — the rest of the
 * narration is the DM's legitimate prose and stays. Claims carry their text indices, so the
 * splicer works in text order: reversed-order, repeated-phrase and negated-first cases all
 * resolve correctly.
 */
export function spliceContradictingSentences(
  text: string,
  claims: OutcomeClaim[],
  replacement: string,
): string {
  const spans: { start: number; end: number }[] = [];
  for (const { index } of claims) {
    if (index < 0 || index >= text.length) continue;
    spans.push(sentenceSpan(text, index));
  }
  if (!spans.length) return text;
  spans.sort((a, b) => a.start - b.start);
  // Merge overlaps: one claim per sentence is the norm, but a sentence can hold two.
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let out = '';
  let at = 0;
  merged.forEach((span, i) => {
    out += text.slice(at, span.start);
    if (i === 0) out += replacement;
    at = span.end;
  });
  out += text.slice(at);
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
