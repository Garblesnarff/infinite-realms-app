import logger from '@/lib/logger';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

/** #1704 shadow: a DM reply narrates a confrontation without starting combat. Reports only; changes nothing. */
export const CONFRONTATION_WITHOUT_COMBAT_ENTRY_SHADOW_REASON =
  'confrontation_without_combat_entry';

/**
 * A word that makes the next word a noun, not a verb: an article, a possessive or a quantifier
 * ("an attack", "a rush", "his swing", "no charge"), plus "in" for "in charge". "that" is left out
 * on purpose: "the wolf that charges at you" is the verb.
 */
const NOUN_LEAD = String.raw`(?<!\b(?:a|an|the|no|his|her|its|their|my|your|our|this|any|another|each|every|in)\s+)`;

/** A verb pattern that skips the noun use (see NOUN_LEAD) and any `notAfter` continuation. */
function verb(forms: string, notAfter?: string): RegExp {
  const tail = notAfter ? `(?!\\s+(?:${notAfter})\\b)` : '';
  return new RegExp(`${NOUN_LEAD}\\b(?:${forms})\\b${tail}`, 'i');
}

/**
 * "charged with" is skipped only after a form of "be" ("was charged with theft"); an active
 * "the orc charged with his axe raised" still counts.
 */
const CHARGE_FORMS = String.raw`charg(?:e|es|ing)|charged(?!\s+with\b)|(?<!\b(?:is|are|was|were|be|been|being)\s+)charged`;

/**
 * Hostile verbs a reply can use when narrating a fight in prose without starting an encounter
 * (#1704, Hark 11-21). Present, past, and progressive forms. Each pattern carries a name; the
 * shadow logs and reports names only, never the reply text.
 *
 * attack, rush, charge and swing are everyday words too, so their noun uses are skipped, and so
 * are "an attack of nerves", "a rush of wind", "was charged with theft" and "the door swings open"
 * ("swings wide" alone is a missed blow and still counts).
 */
const CONFRONTATION_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'attacks', re: verb('attack(?:s|ed|ing)?', 'of') },
  { name: 'rushes', re: verb('rush(?:es|ed|ing)?', 'of') },
  { name: 'charges', re: verb(CHARGE_FORMS) },
  {
    name: 'swings',
    re: verb('sw(?:ings?|ung|inging)', 'open|shut|closed|ajar|wide open|inwards?|outwards?'),
  },
  { name: 'punches', re: /\bpunch(?:es|ed|ing)?\b/i },
  { name: 'squares_up', re: /\bsquar(?:e|es|ed|ing)\s+up\b/i },
  { name: 'lunges', re: /\blung(?:e|es|ed|ing)\b/i },
];

/** Double- and curly-quoted speech, stripped before the verb and negation checks. */
const QUOTED_RE = /"[^"]*"|“[^”]*”/g;

/** A negated sentence ("does not attack") is not a confrontation. */
const NEGATION_RE = /\b(?:not|never|no longer|cannot|nothing|nor)\b|n['’]t\b/i;

export interface ConfrontationReplyShape {
  text?: string | null;
  combat_transition?: string | null;
  map_actions?: ReadonlyArray<unknown> | null;
  combat_actions?: ReadonlyArray<unknown> | null;
  roll_requests?: ReadonlyArray<unknown> | null;
}

function hasMapActionTarget(action: unknown): boolean {
  if (!action || typeof action !== 'object') return false;
  const record = action as { action?: unknown; target?: unknown; entityId?: unknown };
  if (record.action === 'forced_move') {
    return typeof record.target === 'string' && record.target.trim().length > 0;
  }
  return typeof record.entityId === 'string' && record.entityId.trim().length > 0;
}

function isCombatRollRequest(request: unknown): boolean {
  if (!request || typeof request !== 'object') return false;
  const type = (request as { type?: unknown }).type;
  return type === 'attack' || type === 'initiative';
}

/**
 * Mirrors `detectCombatEntryTrigger` in `server-bun/src/services/combat/combat-entry-gate.ts`:
 * true when the reply carries any signal that starts an encounter (`combat_transition === 'start'`,
 * a targeted `map_action`, a `combat_action`, or an `attack`/`initiative` roll request).
 */
export function hasCombatEntrySignal(reply: ConfrontationReplyShape): boolean {
  if (reply.combat_transition === 'start') return true;
  if (Array.isArray(reply.map_actions) && reply.map_actions.some(hasMapActionTarget)) return true;
  if (Array.isArray(reply.combat_actions) && reply.combat_actions.length > 0) return true;
  if (Array.isArray(reply.roll_requests) && reply.roll_requests.some(isCombatRollRequest)) {
    return true;
  }
  return false;
}

/** The hostile-verb pattern names found in a reply, sorted. Narration only: quoted speech is ignored. */
export function confrontationVerbPatterns(text: string | null | undefined): string[] {
  if (!text) return [];
  const names = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const narration = sentence.replace(QUOTED_RE, ' ');
    if (NEGATION_RE.test(narration)) continue;
    for (const { name, re } of CONFRONTATION_PATTERNS) {
      if (re.test(narration)) names.add(name);
    }
  }
  return [...names].sort();
}

export interface ConfrontationWithoutCombatEntryShadowParams {
  reply: ConfrontationReplyShape;
  sessionId: string | undefined;
  /** True when an encounter is already active; in-combat replies are not shadowed. */
  inCombat: boolean;
}

/**
 * #1704 shadow: logs `DM_NARRATION_SHADOW` and reports `confrontation_without_combat_entry`
 * (pattern names only) when no encounter is active, the reply carries no combat-entry signal,
 * and the reply text narrates a confrontation. Returns nothing and never edits the reply.
 * Fails open: any error is swallowed so the turn proceeds unchanged.
 */
export function shadowConfrontationWithoutCombatEntry(
  params: ConfrontationWithoutCombatEntryShadowParams,
): void {
  try {
    if (params.inCombat) return;
    if (hasCombatEntrySignal(params.reply)) return;
    const patterns = confrontationVerbPatterns(params.reply.text);
    if (patterns.length === 0) return;
    logger.warn('DM_NARRATION_SHADOW', {
      reason: CONFRONTATION_WITHOUT_COMBAT_ENTRY_SHADOW_REASON,
      sessionId: params.sessionId,
      branch: 'narrative',
      patterns,
    });
    reportNarrationShadowHit('confrontation_without_combat_entry', params.sessionId, patterns);
  } catch {
    // Fail open: a shadow must never break the turn.
  }
}
