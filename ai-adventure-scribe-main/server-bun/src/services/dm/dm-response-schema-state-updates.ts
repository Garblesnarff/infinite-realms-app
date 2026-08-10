/**
 * `state_updates` — the model-proposed narrative delta (the `dm_delta` source).
 *
 * Target architecture: docs/memory-system-design-v2.md §3.1 (source precedence) and §3.2
 * steps 5–7 (the turn transaction that will consume this). Pre-Phase-1 slice: session-keyed,
 * name-keyed — see #1670 Phase 1.
 *
 * Phase-B groundwork: this module is deliberately not wired into any prompt, route, or
 * processor yet. It exists so the schema extension and its runtime validator can be reviewed
 * and tested before the gateway that will consume them is built.
 *
 * Kept out of `dm-response-schema.ts` so the live contract stays byte-identical until the
 * gateway lands. Like that module it must remain runtime-neutral: no Bun- or DOM-only APIs.
 */
import { createDmResponseSchema } from './dm-response-schema.js';

export const STATE_SUBJECT_TYPES = [
  'npc',
  'location',
  'item',
  'quest',
  'faction',
  'party',
  'world',
  'thread',
] as const;

export type StateSubjectType = (typeof STATE_SUBJECT_TYPES)[number];

/** One proposed fact. `audience` maps to `narrative_facts.known_by` ('dm', 'player', 'npc:<id>'). */
export type StateUpdate = {
  subject_type: StateSubjectType;
  subject: string;
  predicate: string;
  value: string;
  audience: string[];
};

const stateUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject_type: { type: 'string', enum: [...STATE_SUBJECT_TYPES] },
    subject: { type: 'string' },
    predicate: { type: 'string' },
    value: { type: 'string' },
    audience: { type: 'array', items: { type: 'string' } },
  },
  required: ['subject_type', 'subject', 'predicate', 'value', 'audience'],
} as const;

/** Extension properties for `createDmResponseSchema` — strict, like every other top-level field. */
export const stateUpdatesExtension = {
  state_updates: { type: 'array', items: stateUpdateSchema },
} as const;

export const dmResponseSchemaWithState = createDmResponseSchema(stateUpdatesExtension, [
  'state_updates',
]);

const isStateSubjectType = (value: unknown): value is StateSubjectType =>
  STATE_SUBJECT_TYPES.includes(value as StateSubjectType);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isStateUpdate = (value: unknown): value is StateUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return (
    isStateSubjectType(update.subject_type) &&
    isNonEmptyString(update.subject) &&
    isNonEmptyString(update.predicate) &&
    typeof update.value === 'string' &&
    Array.isArray(update.audience) &&
    update.audience.every((member) => typeof member === 'string')
  );
};

/**
 * Row-wise, not all-or-nothing: extraction is expected to be wrong some of the time (the EMNLP
 * D&D tracker managed 58% joint accuracy), so one malformed delta must not discard the four
 * good ones beside it. Rejected rows come back as issues for staging/telemetry rather than
 * throwing — the caller decides whether to log, review, or drop them.
 */
export function parseStateUpdates(value: unknown): { updates: StateUpdate[]; issues: string[] } {
  if (value === undefined || value === null) return { updates: [], issues: [] };
  if (!Array.isArray(value)) return { updates: [], issues: ['state_updates must be an array'] };

  const updates: StateUpdate[] = [];
  const issues: string[] = [];
  value.forEach((candidate, index) => {
    if (isStateUpdate(candidate)) {
      updates.push(candidate);
      return;
    }
    issues.push(`state_updates[${index}] is not a valid state update`);
  });

  return { updates, issues };
}
