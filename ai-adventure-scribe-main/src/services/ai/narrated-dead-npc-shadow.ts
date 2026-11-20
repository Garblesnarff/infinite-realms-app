import logger from '@/lib/logger';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

/** #1595 shadow: a DM reply narrates a ledger-dead named NPC acting. Reports only; changes nothing. */
export const NARRATED_DEAD_NPC_SHADOW_REASON = 'narrated_dead_npc_acting';

/**
 * Acting verbs a reply can give a dead NPC (#1595, Run M16: "Dutch Pellam steps into the ring").
 * Present and past forms. Each pattern carries a name; the shadow logs and reports names only.
 */
const ACTING_PATTERNS: ReadonlyArray<{ name: string; verbs: string }> = [
  {
    name: 'attack',
    // `hit`/`hits` count only when "you", a pronoun, or a non-ground object follows.
    verbs:
      '(?:attacks?|attacked|attacking|strikes?|struck|swings?|swung|slash(?:es|ed)?|lunges?|lunged|stabs?|stabbed|shoots?|shot|hurls?|hurled|fights?|fought|fighting|engages?|engaged|parr(?:y|ies|ied)|(?:hits?|hit)\\s+(?:you|your|him|her|them|(?:the|a|an)\\s+(?!(?:sand|ground|floor|stone|rock|dirt|wall|water|earth|ice|dust|mud|cobbles?)\\b)[a-z]+))',
  },
  {
    name: 'speech',
    verbs:
      '(?:says?|said|speaks?|spoke|replies|replied|shouts?|shouted|growls?|growled|asks?|asked|whispers?|whispered|answers?|answered|calls? out|called out)',
  },
  {
    name: 'return_or_entry',
    verbs:
      '(?:(?:steps?|stepped)(?: back)? (?:into|onto|forward|out)|enters?|entered|returns?|returned|comes? back|came back|rises?|rose|stands? up|stood up|approaches|approached|advances?|advanced|climbs?|climbed)',
  },
];

/** Double- and curly-quoted speech, stripped before the act and negation checks. */
const QUOTED_RE = /"[^"]*"|“[^”]*”/g;

/** A negated sentence ("does not attack") is not an act. */
const NEGATION_RE = /\b(?:not|never|no longer|cannot|nothing|nor)\b|n['’]t\b/i;

/** A status line the engine wrote and the scene shows as TRUE (not a `believes` line). */
const ENGINE_DEAD_STATUS_RE = /^\s*status = \{[^}]*"state":"dead"[^}]*\}\s+\(engine\b/m;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names of the NPCs the rendered `<scene_state>` marks dead by an engine-written status fact
 * (narrative-ledger-core.ts `renderSceneStateFromFacts`). A `believes` line does not count.
 */
export function deadNpcNamesFromSceneState(block: string | null | undefined): string[] {
  if (!block) return [];
  const names: string[] = [];
  for (const entity of block.matchAll(/<entity type="npc" name="([^"]+)">([\s\S]*?)<\/entity>/g)) {
    if (ENGINE_DEAD_STATUS_RE.test(entity[2] ?? '')) names.push(entity[1] ?? '');
  }
  return names.filter(Boolean);
}

/**
 * The acting-pattern for a dead NPC who is the subject of the sentence: the name, not followed by
 * a copula, then a verb later in the same sentence (a comma clause or "and" may sit between).
 * "X's body hits", "X is dead, and ... shouts" and a bare mention ("the late X") do not match.
 */
function subjectActRe(name: string, verbs: string): RegExp {
  return new RegExp(
    `\\b${escapeRegExp(name)}\\s+(?!(?:is|was|were|are|lies|lay|be)\\b)[^]*?\\b${verbs}\\b`,
    'i',
  );
}

/** The acting-pattern names found in a reply, sorted. Narration only: quoted speech is ignored. */
export function narratedDeadNpcActingPatterns(
  text: string | null | undefined,
  deadNames: readonly string[],
): string[] {
  if (!text || deadNames.length === 0) return [];
  const names = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const narration = sentence.replace(QUOTED_RE, ' ');
    if (NEGATION_RE.test(narration)) continue;
    for (const dead of deadNames) {
      for (const { name, verbs } of ACTING_PATTERNS) {
        if (subjectActRe(dead, verbs).test(narration)) names.add(name);
      }
    }
  }
  return [...names].sort();
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
