/**
 * #841: binds corrective model calls to the DM reply that produced the action.
 *
 * When /v1/llm/generate produces a DM reply, it records the reply's
 * handout/map actions here keyed by (sessionId, messageId). The corrective
 * reprompts in the handout-actions and tactical-map/dm-actions routes only run
 * when the refused action came from a DM reply the server itself generated
 * for this session — a fabricated action batch cannot summon a paid call.
 *
 * In-memory and process-local, like the rate limiter: the authoritative
 * binding is "the server generated this reply", which holds only while the
 * generating process is up. Entries expire after a TTL and the map is capped,
 * so a pathological session cannot grow it without bound.
 */

export interface RecordedDmTurnActions {
  /** Every authored handout key the DM's reply used. */
  handoutKeys: Set<string>;
  hasHandoutActions: boolean;
  hasMapActions: boolean;
  recordedAt: number;
}

/** A correction is only useful while the turn it corrects is still being handled. */
const ENTRY_TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 2_000;

const registry = new Map<string, RecordedDmTurnActions>();

const keyOf = (sessionId: string, messageId: string): string => `${sessionId}::${messageId}`;

function prune(): void {
  if (registry.size <= MAX_ENTRIES) return;
  const ordered = [...registry.entries()].sort((a, b) => a[1].recordedAt - b[1].recordedAt);
  for (let i = 0; i < ordered.length - MAX_ENTRIES; i += 1) {
    registry.delete(ordered[i]![0]);
  }
}

export function recordDmTurnActions(params: {
  sessionId: string;
  messageId: string;
  handoutActions?: unknown[];
  mapActions?: unknown[];
}): void {
  const handoutKeys = new Set<string>();
  const handoutActions = Array.isArray(params.handoutActions) ? params.handoutActions : [];
  for (const action of handoutActions) {
    if (action && typeof action === 'object') {
      const key = (action as Record<string, unknown>).key;
      if (typeof key === 'string' && key.length > 0) handoutKeys.add(key);
    }
  }
  registry.set(keyOf(params.sessionId, params.messageId), {
    handoutKeys,
    hasHandoutActions: handoutActions.length > 0,
    hasMapActions: Array.isArray(params.mapActions) && params.mapActions.length > 0,
    recordedAt: Date.now(),
  });
  prune();
}

export function dmTurnActions(
  sessionId: string,
  messageId: string,
  now = Date.now(),
): RecordedDmTurnActions | null {
  const entry = registry.get(keyOf(sessionId, messageId));
  if (!entry) return null;
  if (now - entry.recordedAt > ENTRY_TTL_MS) {
    registry.delete(keyOf(sessionId, messageId));
    return null;
  }
  return entry;
}

/** Test hook: clear the registry between tests. */
export function __resetDmTurnActionRegistryForTests(): void {
  registry.clear();
}
