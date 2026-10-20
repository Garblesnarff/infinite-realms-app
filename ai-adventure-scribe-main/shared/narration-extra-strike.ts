/**
 * Extra strike detection for combat narration (#716).
 *
 * The engine shows one enemy hit on the player, but the DM prose narrates a second one. Two
 * things must agree on what counts: the count of engine hits on the player, and the phrases in
 * the prose that claim a repeat hit. Pure text and cards in, phrases out; no imports except the
 * EngineResultCard type.
 *
 * Every pattern is explicit repeat language ("a second", "another", "again", "twice", "follow-up")
 * aimed at the player ("you"/"your"), so a single legitimately-narrated hit is never flagged. The
 * reach verbs "land"/"connect" carry no object of their own, so the same clause must name the
 * player ("lands across your ribs", "connects with your shoulder", "lands on you") and must not
 * aim at a companion ("on your companion Mira"). A false positive costs a regeneration, so
 * negations ("before a second strike can land"), hypotheticals ("would have landed a second
 * blow"), and recaps ("Earlier, a second blow landed across your ribs") are skipped.
 */
import type { EngineResultCard } from './engine-result-card';

const HIT_BADGE_WORDS = new Set(['HIT', 'CRITICAL HIT', 'AUTO-HIT']);

/**
 * The engine hits that landed on the player this turn: a card carrying the player's HP, or an
 * enemy attack card whose math names the player as the target and whose badge is a hit.
 *
 * An HP block names who was hit, and that name is the checkable fact: producers set the block
 * from a caller-supplied "the target is the player" flag, so a companion's hit can arrive
 * carrying HP too. Counting it as the player's inflates the count — at two it switches
 * `inventedExtraStrikeClaims` off entirely, and a fake second strike on the player ships
 * (#716, the #771 follow-up). When `playerName` is given, an HP card counts only if it names
 * the player; callers with a roster always pass it. Without a name there is nothing to check
 * the block against, so it counts as before.
 */
export function engineHitsOnPlayer(
  cards: EngineResultCard[],
  playerName?: string,
): number {
  let count = 0;
  for (const card of cards) {
    if (!card) continue;
    if (card.hp) {
      if (playerName === undefined || card.hp.name === playerName) count += 1;
      continue;
    }
    if (
      card.side === 'enemy' &&
      card.math?.kind === 'attack' &&
      card.math.targetIsPlayer &&
      card.badge?.word &&
      HIT_BADGE_WORDS.has(card.badge.word)
    ) {
      count += 1;
    }
  }
  return count;
}

const ATTACK_NOUN = 'strike|blow|hit|attack|slash|swing|bite|claw';
const ATTACK_VERB = 'strikes|struck|hits|slashes|swings|bites|claws';

/** After "your", these name someone other than the player: the strike is not aimed at the player. */
const COMPANION_AFTER_YOUR =
  'companion|ally|friend|party|ward|familiar|mount|horse|ranger|cleric|wizard|fighter|rogue';

/**
 * "land"/"connect" carry no object on their own, so they only reach the player when the same
 * clause names the player: "lands across your ribs", "connects with your shoulder", "lands on
 * you". A "your <companion>" target is someone else, not the player.
 */
const REACH_LAND_CONNECT =
  `(?:land(?:s|ed)?|connect(?:s|ed)?)\\s+(?:on|across|into|against|with)\\s+` +
  `(?:you\\b|your\\s+(?!(?:${COMPANION_AFTER_YOUR})\\b)\\w+)`;

/** The verbs a repeat strike uses when it reaches the player. */
const REACH_YOU =
  `${REACH_LAND_CONNECT}|catch(?:es|ing)?\\s+you|caught\\s+you|find(?:s)?\\s+you|` +
  'found\\s+you|hit(?:s)?\\s+you|strikes?\\s+you|struck\\s+you';

const EXTRA_STRIKE_PATTERNS: RegExp[] = [
  // "a second strike lands across your ribs", "a second blow catches you".
  new RegExp(`\\ba\\s+second\\s+(?:${ATTACK_NOUN})\\b[^.!?]{0,40}?\\b(?:${REACH_YOU})\\b`, 'gi'),
  // "another strike slams into you", "another blow finds your side".
  new RegExp(
    `\\banother\\s+(?:${ATTACK_NOUN})\\b[^.!?]{0,60}?\\b(?:lands|connects|catches|finds|slams\\s+into|strikes|hits)\\s+(?:with\\s+)?(?:you\\b|your\\s+(?!(?:${COMPANION_AFTER_YOUR})\\b)\\w+)`,
    'gi',
  ),
  // "the goblin hits you again", "it slashes you again".
  new RegExp(`\\b(?:${ATTACK_VERB})\\s+you\\s+again\\b`, 'gi'),
  // "it strikes you twice".
  /\b(?:strikes|hits)\s+you\s+twice\b/gi,
  // "a follow-up strike lands on you", "a follow-up blow catches you".
  new RegExp(
    `\\ba\\s+follow-up\\s+(?:${ATTACK_NOUN})\\b[^.!?]{0,30}?\\b(?:${REACH_LAND_CONNECT}|catches\\s+you|hits\\s+you)\\b`,
    'gi',
  ),
];

const NEGATOR = /\b(?:no|not|never|without|nor|neither|cannot|fails?|failed|fail)\b|n['’]t\b/i;
/** A negation does not reach across these: "does not respond, but a second blow lands". */
const CLAUSE_BREAK = /[,;:]|\b(?:but|though|although|yet|however|before|if|unless)\b/i;
/** "would have landed a second strike", "could land a second blow": a warning, not a claim. */
const HYPOTHETICAL = /\b(?:would|could|might|can|may)\b/i;
/** "Earlier, a second blow landed": the strike already happened, so the DM is recapping it. */
const RECAP = /\b(?:earlier|previously|last turn|last round|before that|a moment ago|had)\b/i;
/** "the goblin had landed a second strike": the reach verb is a justified past-tense recap. */
const HAD_REACH = /\bhad\s+(?:landed|connected)\b/i;

export interface ExtraStrikeClaim {
  match: string;
  index: number;
}

/** The sentence (by `.`/`!`/`?`) containing `index`. */
function sentenceSpan(text: string, index: number): { start: number; end: number } {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
      start = i + 1;
      break;
    }
  }
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

/** "before a second strike can land", "no second blow": the DM honouring the truth. */
function isNegated(text: string, index: number): boolean {
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
  return NEGATOR.test(clause);
}

/**
 * The repeat-hit phrases the DM text asserts, empty when the engine already resolved two hits or
 * more, or when the text follows the engine. `match` is the matched phrase, `index` where it
 * occurs, so the caller can splice the sentence it sits in.
 */
export function inventedExtraStrikeClaims(
  text: string | null | undefined,
  engineHits: number,
): ExtraStrikeClaim[] {
  const source = text ?? '';
  if (engineHits >= 2) return [];
  const claims: ExtraStrikeClaim[] = [];
  const seen = new Set<number>();
  for (const pattern of EXTRA_STRIKE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (seen.has(index)) continue;
      if (isNegated(source, index)) continue;
      // Only the claim's own clause: "Before you can recover, a second strike lands" is a claim.
      const span = sentenceSpan(source, index);
      const before = source.slice(span.start, index);
      if (RECAP.test(before) || HAD_REACH.test(match[0])) continue;
      const clause = before.split(CLAUSE_BREAK).pop() ?? '';
      if (HYPOTHETICAL.test(`${clause}${match[0]}`)) continue;
      seen.add(index);
      claims.push({ match: match[0].trim().toLowerCase().slice(0, 120), index });
      if (claims.length >= 5) return claims;
    }
  }
  return claims;
}
