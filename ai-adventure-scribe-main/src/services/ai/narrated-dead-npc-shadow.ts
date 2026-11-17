import logger from '@/lib/logger';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

/** #1595 shadow: a DM reply narrates a ledger-dead named NPC acting. Reports only; changes nothing. */
export const NARRATED_DEAD_NPC_SHADOW_REASON = 'narrated_dead_npc_acting';

/**
 * Acting verbs a reply can give a dead NPC (#1595, Run M16: "Dutch Pellam steps into the ring").
 * Each pattern carries a name; the shadow logs and reports names only, never the matched text.
 */
const ACTING_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  {
    name: 'attack',
    re: /\b(?:attacks?|attacking|strikes?|struck|swings?|slash(?:es|ed)?|lunges?|stabs?|shoots?|hurls?|hits?|fights?|fighting|engages?|parr(?:y|ies|ied))\b/i,
  },
  {
    name: 'speech',
    re: /\b(?:says?|said|speaks?|spoke|replies|replied|shouts?|shouted|growls?|asks?|asked|whispers?|answers?|answered|calls? out)\b/i,
  },
  {
    name: 'return_or_entry',
    re: /\b(?:steps? (?:back )?(?:into|onto|forward|out)|enters?|entered|returns?|returned|comes? back|rises?|rose|stands? up|stood up|approaches|advances?|climbs?)\b/i,
  },
];

/** Double- and curly-quoted speech, stripped before the act and negation checks. */
const QUOTED_RE = /"[^"]*"|“[^”]*”/g;

/** A negated sentence ("does not attack") is not an act. */
const NEGATION_RE = /\b(?:not|never|no longer|cannot|nothing|nor)\b|n['’]t\b/i;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names of the NPCs the rendered `<scene_state>` marks dead (ledger `status = {"state":"dead"}`).
 * Renderer format: narrative-ledger-core.ts `renderSceneStateFromFacts`. Names only.
 */
export function deadNpcNamesFromSceneState(block: string | null | undefined): string[] {
  if (!block) return [];
  const names: string[] = [];
  for (const entity of block.matchAll(/<entity type="npc" name="([^"]+)">([\s\S]*?)<\/entity>/g)) {
    if (/\bstatus = \{[^}]*"state":"dead"[^}]*\}/.test(entity[2] ?? '')) {
      names.push(entity[1] ?? '');
    }
  }
  return names.filter(Boolean);
}

/**
 * The acting-pattern names found in a reply, for a dead NPC named in the same sentence. A bare
 * mention ("his body", "the late Dutch Pellam") is not an act and reports nothing.
 */
export function narratedDeadNpcActingPatterns(
  text: string | null | undefined,
  deadNames: readonly string[],
): string[] {
  if (!text || deadNames.length === 0) return [];
  const names = new Set<string>();
  const dead = deadNames.map((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i'));
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!dead.some((re) => re.test(sentence))) continue;
    // Quoted speech is what the NPC says, not the narration's own claim: read the narration only.
    const narration = sentence.replace(QUOTED_RE, ' ');
    if (NEGATION_RE.test(narration)) continue;
    for (const { name, re } of ACTING_PATTERNS) {
      if (re.test(narration)) names.add(name);
    }
  }
  return [...names];
}

export interface NarratedDeadNpcShadowParams {
  narration: string | null | undefined;
  sessionId: string | undefined;
  sceneStateBlock: string | null | undefined;
}

/**
 * #1595 shadow: logs `DM_NARRATION_SHADOW` and reports `narrated_dead_npc_acting` (pattern names
 * only) when a reply narrates a dead NPC acting. It returns nothing and never edits the reply.
 * Fails open: any error is swallowed, so the turn goes through as it would without the shadow.
 */
export function shadowNarratedDeadNpcActing(params: NarratedDeadNpcShadowParams): void {
  try {
    const dead = deadNpcNamesFromSceneState(params.sceneStateBlock);
    if (dead.length === 0) return;
    const patterns = narratedDeadNpcActingPatterns(params.narration, dead);
    if (patterns.length === 0) return;
    logger.warn('DM_NARRATION_SHADOW', {
      reason: NARRATED_DEAD_NPC_SHADOW_REASON,
      sessionId: params.sessionId,
      branch: 'narrative',
      patterns,
    });
    reportNarrationShadowHit('narrated_dead_npc_acting', params.sessionId, patterns);
  } catch {
    // Fail open: a shadow must never break the turn.
  }
}
