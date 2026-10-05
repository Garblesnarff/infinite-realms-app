/**
 * Client-side post-check for combat narration (#2236).
 *
 * The server appends a `<narration_contract>` block (with a machine-readable
 * `<contract_json>` envelope) to the tactical context on combat turns. This module parses
 * that envelope and validates the DM's narration text against it — cheaply, with regexes,
 * no model call. When it finds violations, the caller makes exactly one regeneration call;
 * if that still states a factual contradiction (`FACTUAL_RULES`), it falls back to
 * deterministic engine-grounded prose.
 *
 * Recorded failures this catches (issues #2230 run 10, #2231 run M4):
 * - one NPC attack roll (MISS) narrated as "a flurry of strikes" / "blows"
 * - a natural-2 miss narrated as "Your longsword swings true"
 * - "You dash across the room" when no Dash was declared or resolved
 * - "It is not your turn yet" while the tracker showed the player's turn
 * - rope-over-chasm scene drifting to "stone floor" / "chamber" / "halls"
 *
 * Pure and dependency-free so it can be unit-tested without a browser or network.
 */

export type ContractEnvelopeAction = {
  kind: string;
  count: number;
  /** Engine slugs of the actors that resolved this action kind, when the envelope carries them. */
  actors?: string[];
  /** True when every resolved instance succeeded, false when every one failed. */
  hit?: boolean;
  mixed?: boolean;
  damageScale?: 'scratch' | 'wounded' | 'grievous';
};

export type ContractEnvelope = {
  currentTurn: { slug: string; label?: string; isPlayer: boolean; round: number } | null;
  actions: ContractEnvelopeAction[];
  sceneDescription: string | null;
};

export type NarrationViolationRule =
  | 'unresolved_action'
  | 'false_turn_denial'
  | 'success_on_miss'
  | 'inflated_action_count'
  | 'damage_scale'
  | 'scene_drift';

export type NarrationViolation = {
  rule: NarrationViolationRule;
  /** The exact narration text that tripped the rule, for logging and measurement. */
  matched: string;
  detail: string;
};

const CONTRACT_JSON_RE = /<contract_json>([\s\S]*?)<\/contract_json>/;

/**
 * Extract the `<contract_json>` envelope from a tactical-context string.
 * Returns null when there is no contract (non-combat turns) — the caller skips the check.
 */
export function parseContractEnvelope(
  tacticalContext: string | null | undefined,
): ContractEnvelope | null {
  if (!tacticalContext) return null;
  const match = CONTRACT_JSON_RE.exec(tacticalContext);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<ContractEnvelope>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.actions)) return null;
    const rawActions = parsed.actions as Array<Record<string, unknown>>;
    const rawTurn = parsed.currentTurn as Record<string, unknown> | null | undefined;
    return {
      currentTurn: rawTurn
        ? {
            slug: typeof rawTurn.slug === 'string' ? rawTurn.slug : '',
            label: typeof rawTurn.label === 'string' ? rawTurn.label : undefined,
            isPlayer: rawTurn.isPlayer === true,
            round: typeof rawTurn.round === 'number' ? rawTurn.round : 0,
          }
        : null,
      actions: rawActions.map((action) => ({
        kind: typeof action.kind === 'string' ? action.kind : '',
        count: typeof action.count === 'number' ? action.count : 0,
        actors: Array.isArray(action.actors)
          ? action.actors.filter((slug): slug is string => typeof slug === 'string')
          : undefined,
        hit: typeof action.hit === 'boolean' ? action.hit : undefined,
        mixed: action.mixed === true,
        damageScale:
          action.damageScale === 'scratch' ||
          action.damageScale === 'wounded' ||
          action.damageScale === 'grievous'
            ? action.damageScale
            : undefined,
      })),
      sceneDescription:
        typeof parsed.sceneDescription === 'string' ? parsed.sceneDescription : null,
    };
  } catch {
    return null;
  }
}

/** The narration text out of a raw DM JSON response; falls back to the raw string. */
export function narrationTextFromRawResponse(rawResponse: string): string {
  try {
    const cleaned = rawResponse
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as { text?: unknown };
    if (typeof parsed.text === 'string') return parsed.text;
  } catch {
    // Not JSON — treat the whole response as narration text.
  }
  return rawResponse;
}

/**
 * Replace the `text` field of a raw DM JSON response, keeping every other field
 * (combat_actions, map_actions, options) intact. If the response is not a JSON object
 * with a `text` field, it is returned unchanged: replacing it wholesale would drop
 * whatever structured fields it carried.
 */
export function replaceNarrationText(rawResponse: string, text: string): string {
  try {
    const cleaned = rawResponse
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      return JSON.stringify({ ...parsed, text });
    }
  } catch {
    // Not JSON — fall through.
  }
  return rawResponse;
}

const hasKind = (contract: ContractEnvelope, kind: string): boolean =>
  contract.actions.some((action) => action.kind === kind);

/**
 * Rules that state a factual contradiction of the engine. Only these ever fall back to
 * deterministic prose; the stylistic rules keep the regenerated text even if it still
 * trips, because flat engine prose reads to a player as the game breaking.
 */
export const FACTUAL_RULES: ReadonlySet<NarrationViolationRule> = new Set([
  'unresolved_action',
  'false_turn_denial',
]);

/** True when any violation is a factual contradiction (see `FACTUAL_RULES`). */
export const hasFactualViolation = (violations: NarrationViolation[]): boolean =>
  violations.some((violation) => FACTUAL_RULES.has(violation.rule));

/**
 * The narrator's own voice: the narration with quoted speech removed. An NPC saying
 * "you cannot act rashly" or "you strike a match" is dialogue, not a claim about the
 * turn, so every rule reads only this text.
 *
 * Straight quotes are stripped per paragraph with an opener/closer heuristic, never
 * paired blindly first-to-second: a stray inch mark like `6"` once shifted every later
 * pair, turning quoted speech into narrator voice and firing false_turn_denial on
 * `The sign reads 6" tall. "You cannot act yet," the priest warns.` A `"` right after
 * a digit is an inch mark, never a quote; an opener must be followed by a non-space
 * character and a closer preceded by one, so a stray quote cannot shift later pairs;
 * an opener with no closer in its paragraph is left as literal text. Curly quotes pair
 * by their distinct glyphs and are stripped first.
 */
export function narratorVoice(narration: string): string {
  const noCurly = narration.replace(/“[^”]*”/g, ' ');
  return noCurly
    .split(/\n\s*\n/)
    .map(stripParagraphQuotes)
    .join('\n\n');
}

/** Remove straight-quoted spans from one paragraph; see `narratorVoice`. */
function stripParagraphQuotes(paragraph: string): string {
  const spans: Array<[number, number]> = [];
  let openAt = -1;
  for (let i = 0; i < paragraph.length; i++) {
    if (paragraph[i] !== '"') continue;
    if (i > 0 && /\d/.test(paragraph[i - 1])) continue; // inch mark, e.g. 6"
    const prev = i > 0 ? paragraph[i - 1] : '';
    const next = i + 1 < paragraph.length ? paragraph[i + 1] : '';
    const canOpen = next !== '' && !/\s/.test(next);
    const canClose = prev !== '' && !/\s/.test(prev);
    if (openAt === -1) {
      if (canOpen) openAt = i;
      // else: a stray closer with no opener — ignore it.
    } else if (canClose) {
      spans.push([openAt, i]);
      openAt = -1;
    }
    // else: a quote that looks like an opener while one is already open
    // (adjacent quoted spans) — ignore it rather than shifting the pair.
  }
  // An opener never closed within its paragraph stays literal text.
  if (spans.length === 0) return paragraph;
  const drop = new Set<number>();
  for (const [from, to] of spans) {
    for (let i = from; i <= to; i++) drop.add(i);
  }
  return [...paragraph].map((ch, i) => (drop.has(i) ? ' ' : ch)).join('');
}

const WEAPONS =
  '(?:sword|longsword|shortsword|greatsword|blade|axe|greataxe|handaxe|mace|hammer|warhammer|maul|dagger|rapier|scimitar|spear|staff|quarterstaff|club|flail|glaive|halberd|whip|weapon)';

/**
 * Claims that the player (or anyone) took an action type the engine did not resolve this
 * turn. Each pattern is the claim itself, not a word that happens to overlap it:
 * - dash: "you dash" / "dashes across" as movement, never "a dash of salt" or "a mad dash".
 * - attack: an attack aimed at something ("you swing at", "you drive your sword"), never
 *   a bare "you strike" ("you strike a match", "you swing your torch").
 * - spell: "you cast" a spell, never "you cast a glance".
 * `move`, `dodge` ("dodges the blow" is miss flavor) and `death_save` are not checked.
 */
const UNRESOLVED_ACTION_PATTERNS: Array<{ kind: string; pattern: RegExp; label: string }> = [
  {
    kind: 'dash',
    pattern:
      /\byou\s+dash\b|\bdash(?:es|ed)\s+(?:across|toward|towards|away|past|through|back)\b|\b(?:take|takes|took|taking)\s+the\s+dash\s+action\b/i,
    label: 'dash',
  },
  {
    kind: 'disengage',
    pattern: /\byou\s+disengage\b|\b(?:take|takes|took|taking)\s+the\s+disengage\s+action\b/i,
    label: 'disengage',
  },
  {
    kind: 'attack',
    pattern: new RegExp(
      `\\byou\\s+(?:attack|strike|swing|slash|stab|lunge)\\s+at\\b|\\byou\\s+attack\\s+(?:the|it|him|her|them)\\b|\\byou\\s+(?:swing|thrust|drive|plunge|slash|hurl|throw)\\s+your\\s+${WEAPONS}\\b`,
      'i',
    ),
    label: 'attack',
  },
  {
    kind: 'spell',
    pattern:
      /\byou\s+cast\b(?!\s+(?:a\s+|your\s+|one\s+)?(?:\w+\s+)?(?:glance|glances|look|looks|gaze|eye|eyes|shadow|shadows|net|line|lot|lots|vote|aside|off|about|around|doubt))|\bcasts?\s+(?:a\s+|the\s+)?spell\b/i,
    label: 'spell',
  },
];

/** Phrases that deny the player a turn that is theirs. Read in narrator voice only. */
const TURN_DENIAL_PATTERNS: RegExp[] = [
  /\bnot\s+your\s+turn\b/i,
  /\bwait\s+(?:for\s+)?your\s+turn\b/i,
  /\byou\s+can(?:not|['’]t)\s+act\s*(?:yet|now|until|this\s+turn|[.!;]|$)/i,
];

/**
 * Success language that must never describe a miss. Multi-word patterns only, to avoid
 * flagging ordinary prose ("lands on the ground" is not "your blow lands").
 */
const SUCCESS_ON_MISS_PATTERNS: RegExp[] = [
  /\bswings?\s+true\b/i,
  /\bflurry\s+of\s+(?:strikes|blows|attacks)\b/i,
  /\bfinds?\s+(?:its|his|her|their|the)\s+mark\b/i,
  new RegExp(`\\b(?:${WEAPONS}|fang|claw|bolt|arrow|steel)s?\\s+(?:bites?|biting)\\s+deep\\b`, 'i'),
  /\b(?:land|lands|landed|connect|connects|connected)\s+(?:a\s+|the\s+)?(?:blow|hit|strike)\b/i,
  /\b(?:blow|strike|hit)s?\s+(?:land|lands|landed|connect|connects|connected)\b/i,
];

/**
 * Multiplicity language for a single resolved action. Run 10 narrated one attack roll
 * as "a flurry of strikes" and as "blows raining down". Bound to combat nouns so
 * "a flurry of snow" or "a barrage of questions" is not a count claim.
 */
const INFLATED_COUNT_PATTERNS: RegExp[] = [
  /\b(?:flurry|barrage|volley|hail)\s+of\s+(?:strikes|blows|attacks|slashes|stabs|bites|swings|hits|arrows|bolts)\b/i,
  /\bmultiple\s+(?:blows|strikes|attacks|hits)\b/i,
  /\bblows\s+(?:rain|rains|raining|rained|hammer|hammering)\b/i,
];

/**
 * Scene drift is checked only when the engine's scene description names a specific
 * open-air setting and nothing enclosed. An indoor scene — the Academy's halls and
 * chambers, a cave, a tavern — never flags, and a description naming neither is too
 * vague to contradict. "Stone floor" contradicts only a suspended scene (run 10's rope
 * over a chasm); at the bottom of a chasm it is simply the ground.
 */
const OPEN_AIR_SETTING =
  /\b(?:chasm|cliff|cliffside|ravine|gorge|rope|bridge|forest|woods|meadow|field|fields|river|lake|shore|beach|sea|deck|sky|mountain|mountainside|hillside|road|swamp|marsh|desert|rooftop|open\s+air)\b/i;
const SUSPENDED_SETTING = /\b(?:rope|ropes|hanging|dangling|bridge|climbing)\b/i;
const ENCLOSED_SETTING =
  /\b(?:rooms?|chambers?|halls?|hallways?|corridors?|tavern|inn|kitchen|library|laborator(?:y|ies)|lab|cellar|dungeon|cave|cavern|tunnels?|temple|tower|keep|castle|academy|building|interior|indoors|vault|crypt)\b/i;
/** Indoor settings the narration may not relocate an open-air fight to. Word-bounded. */
const INDOOR_RELOCATION = /\b(?:chambers?|halls?|hallways?|corridors?|tavern)\b/i;
const FLOOR_RELOCATION = /\bstone\s+floor\b/i;

/**
 * Validate one narration against the contract. Returns every violation found, each with
 * the text it matched; an empty array means the narration stands and no second model
 * call is needed.
 */
export function checkNarrationAgainstContract(
  narration: string,
  contract: ContractEnvelope,
): NarrationViolation[] {
  const violations: NarrationViolation[] = [];
  if (!narration) return violations;
  const voice = narratorVoice(narration);

  // 1. Named action types the engine did not resolve this turn.
  for (const { kind, pattern, label } of UNRESOLVED_ACTION_PATTERNS) {
    const match = hasKind(contract, kind) ? null : pattern.exec(voice);
    if (match) {
      violations.push({
        rule: 'unresolved_action',
        matched: match[0],
        detail: `Narration describes a ${label} ("${match[0]}") but the engine resolved no ${label} this turn.`,
      });
    }
  }

  // 2. Denying the player a turn that is theirs.
  if (contract.currentTurn?.isPlayer === true) {
    const match = firstMatch(TURN_DENIAL_PATTERNS, voice);
    if (match) {
      violations.push({
        rule: 'false_turn_denial',
        matched: match,
        detail: `Narration denies the player's turn ("${match}") but the contract says it IS the player's turn (round ${contract.currentTurn.round}).`,
      });
    }
  }

  // 3 & 4. Outcome fidelity: success language for a miss, and one action told as many.
  // Only when attribution is unambiguous — every resolved attack/spell missed. Mixed
  // outcomes are left to the model; the contract's human-readable rules already cover it.
  const decisiveActions = contract.actions.filter(
    (action) => (action.kind === 'attack' || action.kind === 'spell') && action.mixed !== true,
  );
  const allMissed =
    decisiveActions.length > 0 && decisiveActions.every((action) => action.hit === false);
  if (allMissed) {
    const match = firstMatch(SUCCESS_ON_MISS_PATTERNS, voice);
    if (match) {
      violations.push({
        rule: 'success_on_miss',
        matched: match,
        detail: `Narration uses success language ("${match}") for an attack the engine resolved as a MISS.`,
      });
    }
  }
  const singleAction = contract.actions.find(
    (action) => (action.kind === 'attack' || action.kind === 'spell') && action.count === 1,
  );
  if (singleAction) {
    const match = firstMatch(INFLATED_COUNT_PATTERNS, voice);
    if (match) {
      violations.push({
        rule: 'inflated_action_count',
        matched: match,
        detail: `Narration describes multiple ${singleAction.kind}s ("${match}") but the engine resolved exactly one.`,
      });
    }
  }

  const scratchAction = contract.actions.find(
    (action) =>
      (action.kind === 'attack' || action.kind === 'spell') &&
      action.damageScale === 'scratch' &&
      action.hit !== false,
  );
  if (scratchAction) {
    const matched = damageScaleMismatch(voice);
    if (matched) {
      violations.push({
        rule: 'damage_scale',
        matched,
        detail: `Narration calls a scratch-tier hit ${matched}, but the engine says it was under 25% of target max HP.`,
      });
    }
  }

  // 5. Scene drift: an open-air scene relocated indoors.
  const scene = contract.sceneDescription ?? '';
  if (OPEN_AIR_SETTING.test(scene) && !ENCLOSED_SETTING.test(scene)) {
    const match =
      INDOOR_RELOCATION.exec(voice) ??
      (SUSPENDED_SETTING.test(scene) ? FLOOR_RELOCATION.exec(voice) : null);
    if (match) {
      violations.push({
        rule: 'scene_drift',
        matched: match[0],
        detail: `Narration relocates the fight to "${match[0]}" but the engine's scene is: ${scene}.`,
      });
    }
  }

  return violations;
}

function firstMatch(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

const DAMAGE_SCALE_WORD =
  /\b(?:devastat(?:e|ed|ing)|grievous|catastrophic|crippling|massive)\b/i;
/** Words that mean the sentence is describing the hit itself, not the scenery. */
const DAMAGE_ANCHOR =
  /\b(?:damages?|hit(?:s|ting)?|wounds?|wounded|strikes?|blows?|slash(?:es)?|gash(?:es)?|cuts?|pierc(?:e|es|ing)|crush(?:es|ed|ing)?|shatter(?:s|ed)?|rends?|cleaves?|batters?|harms?)\b/i;

/**
 * A scale word ("massive", "crippling", ...) only contradicts a scratch-tier
 * hit when it describes the hit. Require a damage anchor in the same
 * sentence, so "a massive door" in the scenery is not flagged (#2534).
 */
function damageScaleMismatch(voice: string): string | null {
  for (const sentence of voice.split(/[.!?]+\s+/)) {
    const scaleMatch = DAMAGE_SCALE_WORD.exec(sentence);
    if (!scaleMatch) continue;
    const withoutScale = sentence.replace(scaleMatch[0], ' ');
    if (DAMAGE_ANCHOR.test(withoutScale)) return scaleMatch[0];
  }
  return null;
}

/** "vitruvian-spider" -> "Vitruvian Spider". Deterministic; never invents a name. */
function displayNameForSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Prefix "The " unless the display name already carries an article ("The Veteran"). */
function titledName(name: string): string {
  return /^(the|a|an)\s/i.test(name) ? name : `The ${name}`;
}

/** "Vitruvian Spider" -> "the Vitruvian Spider"; "The Veteran" -> "the Veteran". */
function turnHolderName(name: string): string {
  const bare = name.replace(/^(the|a|an)\s+/i, '');
  return `the ${bare}`;
}

type ActorVoice = {
  /** "Your" for the player, "The Vitruvian Spider's" for anyone else. */
  possessive: string;
  /** "You" for the player, "The Vitruvian Spider" for anyone else. */
  subject: string;
  isPlayer: boolean;
};

/** How to address the actor of one resolved action in fallback prose. */
function actorVoice(
  actorSlug: string,
  currentTurn: ContractEnvelope['currentTurn'],
): ActorVoice {
  const isPlayer = currentTurn?.isPlayer === true && currentTurn.slug === actorSlug;
  if (isPlayer) return { possessive: 'Your', subject: 'You', isPlayer: true };
  const name = titledName(displayNameForSlug(actorSlug));
  return { possessive: `${name}'s`, subject: name, isPlayer: false };
}

/**
 * One plain sentence for a single actor's resolved action. States only what the
 * engine resolved — kind and outcome — with no counts-as-data ("x1") and no slugs.
 */
function actionSentence(
  action: ContractEnvelopeAction,
  voice: ActorVoice,
): string {
  const plural = action.count > 1;
  const s = voice.isPlayer ? '' : 's'; // "You dash" vs "The spider dashes"
  const noun = (word: string): string => `${voice.possessive} ${word}${plural ? 's' : ''}`;
  switch (action.kind) {
    case 'attack':
      if (action.hit === true) return `${noun('attack')} hit${plural ? '' : 's'}.`;
      if (action.hit === false) return `${noun('attack')} miss${plural ? '' : 'es'}.`;
      if (action.mixed) return `${noun('attack')} have mixed results.`;
      return `${voice.subject} attack${s}.`;
    case 'spell':
      if (action.hit === true) return `${noun('spell')} take${plural ? '' : 's'} effect.`;
      if (action.hit === false) return `${noun('spell')} fail${plural ? '' : 's'}.`;
      if (action.mixed) return `${noun('spell')} have mixed results.`;
      return `${voice.subject} cast${s} a spell.`;
    case 'dash':
      return `${voice.subject} dash${voice.isPlayer ? '' : 'es'}.`;
    case 'disengage':
      return `${voice.subject} disengage${s}.`;
    case 'dodge':
      return `${voice.subject} dodge${s}.`;
    case 'move':
      return `${voice.subject} move${s}.`;
    case 'death_save':
      return `${voice.subject} make${s} a death saving throw.`;
    default:
      return `${voice.subject} take${s} an action.`;
  }
}

/**
 * Deterministic fallback prose when regeneration still fails the check. Plain
 * sentences with display names — never engine internals like "attack x1 (MISS)",
 * raw slugs, or "The engine resolved". States only engine facts: what each actor did
 * and whose turn it is, so the worst case is flat, never false.
 */
export function buildDeterministicFallback(contract: ContractEnvelope): string {
  const sentences: string[] = [];
  for (const action of contract.actions) {
    const actorSlugs =
      action.actors && action.actors.length > 0
        ? action.actors
        : contract.currentTurn
          ? [contract.currentTurn.slug]
          : [];
    for (const actorSlug of actorSlugs) {
      sentences.push(actionSentence(action, actorVoice(actorSlug, contract.currentTurn)));
    }
  }
  if (contract.actions.length === 0) {
    sentences.push('No actions have been resolved this turn.');
  }
  if (contract.currentTurn) {
    const holderName =
      contract.currentTurn.label?.trim() || displayNameForSlug(contract.currentTurn.slug);
    sentences.push(
      contract.currentTurn.isPlayer ? 'It is your turn.' : `It is still ${turnHolderName(holderName)}'s turn.`,
    );
  }
  return sentences.join(' ');
}

/** Human-readable violation list for the regeneration prompt. */
export function formatViolationsForPrompt(violations: NarrationViolation[]): string {
  return violations.map((violation) => `- ${violation.detail}`).join('\n');
}

/**
 * The whole post-check policy for one DM response. Costs nothing when the narration is
 * clean — the single regeneration call happens only on violation. Only a factual
 * contradiction (`FACTUAL_RULES`) that survives the regen falls back to deterministic
 * prose; stylistic drift keeps the model's prose, because flat engine text reads to a
 * player as the game breaking. A failed or empty regen keeps the original prose unless
 * it contradicts the engine.
 */
export async function enforceNarrationContract(
  rawResponse: string,
  deps: {
    tacticalContext: string | null | undefined;
    generateText: (prompt: string) => Promise<string>;
    onViolation?: (violation: NarrationViolation, stage: 'original' | 'regen') => void;
    onRegenError?: (error: unknown) => void;
  },
): Promise<string> {
  const contract = parseContractEnvelope(deps.tacticalContext);
  if (!contract) return rawResponse;

  const narration = narrationTextFromRawResponse(rawResponse);
  const violations = checkNarrationAgainstContract(narration, contract);
  if (violations.length === 0) return rawResponse;
  violations.forEach((violation) => deps.onViolation?.(violation, 'original'));

  const fallback = replaceNarrationText(rawResponse, buildDeterministicFallback(contract));
  const repairPrompt = [
    'You are revising a Dungeon Master narration that violated engine-authoritative facts.',
    'Rewrite ONLY the narration prose below so it satisfies every rule. Keep the same',
    'characters, tone, and length; change nothing but what the violations require.',
    'Return ONLY the revised narration prose — no JSON, no commentary, no preamble.',
    '',
    'VIOLATIONS TO FIX:',
    formatViolationsForPrompt(violations),
    '',
    'ORIGINAL NARRATION:',
    narration,
  ].join('\n');

  let regenText: string;
  try {
    regenText = (await deps.generateText(repairPrompt)).trim();
  } catch (error) {
    deps.onRegenError?.(error);
    regenText = '';
  }
  if (!regenText) return hasFactualViolation(violations) ? fallback : rawResponse;

  const regenViolations = checkNarrationAgainstContract(regenText, contract);
  regenViolations.forEach((violation) => deps.onViolation?.(violation, 'regen'));
  return hasFactualViolation(regenViolations)
    ? fallback
    : replaceNarrationText(rawResponse, regenText);
}
