/**
 * Pure narrative-ledger logic - no database, no drizzle. Split from the
 * service so the supersession policy and <scene_state> renderer are unit-
 * testable without a db.
 *
 * Target architecture: docs/memory-system-design-v2.md SS3.1-SS3.3. This module implements
 * the pre-Phase-1 slice - session-keyed and name-keyed - not v2's playthrough_id +
 * entity_id target (see #1670 Phase 1 for the re-key).
 */

export type FactSource = 'engine' | 'dm_delta' | 'player_correction';

export type FactSubjectType =
  | 'npc'
  | 'location'
  | 'item'
  | 'quest'
  | 'faction'
  | 'party'
  | 'world'
  | 'thread';

export interface AssertFactInput {
  sessionId: string;
  campaignId?: string;
  subjectType: FactSubjectType;
  subjectName: string;
  predicate: string;
  value: unknown;
  knownBy?: string[];
  isBelief?: boolean;
  source: FactSource;
  turnIndex?: number;
  messageId?: string;
  needsReview?: boolean;
}

export type AssertFactResult<TFact = unknown> =
  | { rejected: false; action: 'inserted' | 'superseded' | 'unchanged'; fact: TFact }
  | { rejected: true; action: 'rejected'; reason: string };

/** Shape the pure helpers need - satisfied by a full row and by test fixtures. */
export interface FactLike {
  subjectType: string;
  subjectName: string;
  predicate: string;
  value: unknown;
  source: string;
  knownBy: string[];
  isBelief: boolean;
  needsReview: boolean;
  turnIndex: number | null;
}

export type SupersessionDecision =
  | { action: 'insert' }
  | { action: 'unchanged' }
  | { action: 'supersede' }
  | { action: 'reject'; reason: string };

/**
 * Sources a `dm_delta` may not overturn. Prose cannot resurrect what the engine
 * killed, nor undo a correction the player made by hand (precedence order:
 * memory-system-design-v2.md §3.1, applied by the turn transaction in §3.2 steps 5-7 —
 * engine > player_correction > dm_delta).
 */
const DM_DELTA_BLOCKED_BY: readonly string[] = ['engine', 'player_correction'];

/** Deterministic JSON so value equality does not depend on key insertion order. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

/**
 * Case-folded canonical key for a subject. Pre-Phase-1 slice: `subject_name` IS the identity.
 * memory-system-design-v2.md §3.1 targets `entity_id` resolution instead — see #1670 Phase 1.
 */
export function canonicalSubjectName(subjectName: string): string {
  return subjectName.trim().toLowerCase();
}

/**
 * Pure supersession policy. `current` is the live (invalidatedAt IS NULL) row
 * for the same (session, subjectType, subjectName, predicate), or null.
 */
export function resolveSupersession(
  current: Pick<FactLike, 'value' | 'source'> | null,
  incoming: Pick<FactLike, 'value' | 'source'>,
): SupersessionDecision {
  if (!current) return { action: 'insert' };
  if (stableStringify(current.value) === stableStringify(incoming.value)) {
    return { action: 'unchanged' };
  }
  if (incoming.source === 'dm_delta' && DM_DELTA_BLOCKED_BY.includes(current.source)) {
    return {
      action: 'reject',
      reason: `dm_delta may not supersede a fact sourced from ${current.source}`,
    };
  }
  return { action: 'supersede' };
}

/** A fact is visible to an audience when its knownBy intersects it. */
function isVisibleTo(fact: Pick<FactLike, 'knownBy'>, audience: string[]): boolean {
  const knownBy = fact.knownBy ?? [];
  return knownBy.some((viewer) => audience.includes(viewer));
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : stableStringify(value);
}

function compareFacts(a: FactLike, b: FactLike): number {
  return (
    a.subjectType.localeCompare(b.subjectType) ||
    a.subjectName.localeCompare(b.subjectName) ||
    a.predicate.localeCompare(b.predicate)
  );
}

/**
 * Render the `<scene_state>` ground-truth block (target architecture:
 * memory-system-design-v2.md §3.3, which places it at the true end of the prompt beside
 * player_input) from already-current
 * facts. Staged (`needsReview`) facts are never rendered; facts the audience does
 * not know are withheld so NPCs cannot metagame. Output is fully sorted so the
 * block is byte-stable for a given fact set.
 */
export function renderSceneStateFromFacts(facts: FactLike[], audience: string[] = ['dm']): string {
  const visible = facts
    .filter((fact) => !fact.needsReview && isVisibleTo(fact, audience))
    .sort(compareFacts);

  const lines = [
    '<scene_state>',
    '<authority>These facts are TRUE. Never contradict them. They override memories and history.</authority>',
  ];

  let openKey: string | null = null;
  for (const fact of visible) {
    const key = `${fact.subjectType}|${fact.subjectName}`;
    if (key !== openKey) {
      if (openKey !== null) lines.push('  </entity>');
      lines.push(`  <entity type="${fact.subjectType}" name="${fact.subjectName}">`);
      openKey = key;
    }
    const turn = fact.turnIndex === null ? '' : `, turn ${fact.turnIndex}`;
    const belief = fact.isBelief ? 'believes ' : '';
    lines.push(
      `    ${belief}${fact.predicate} = ${formatValue(fact.value)}  (${fact.source}${turn})`,
    );
  }
  if (openKey !== null) lines.push('  </entity>');

  lines.push('</scene_state>');
  return lines.join('\n');
}
