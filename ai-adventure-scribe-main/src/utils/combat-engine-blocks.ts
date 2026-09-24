export type CombatEngineBlockSource = 'player' | 'npc';

export interface CombatEngineBlock {
  /** Local insertion order used when older payloads do not carry server ordering metadata. */
  sequence: number;
  /** Server ordering metadata, when the combat endpoint supplies it. */
  serverSequence?: number;
  round: number;
  source: CombatEngineBlockSource;
  actor?: string;
  lines: string[];
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads the round fields used by current and forward-compatible combat payloads. */
export function combatRoundFrom(value: unknown, fallback = 1): number {
  if (!value || typeof value !== 'object') return fallback;
  const record = value as Record<string, unknown>;
  const nestedEngine = record.engineResult;
  const candidates = [
    record.round,
    record.roundNumber,
    record.currentRound,
    record.turnRound,
    ...(nestedEngine && typeof nestedEngine === 'object'
      ? [
          (nestedEngine as Record<string, unknown>).round,
          (nestedEngine as Record<string, unknown>).roundNumber,
          (nestedEngine as Record<string, unknown>).currentRound,
        ]
      : []),
  ];
  return candidates.map(asFiniteNumber).find((candidate) => candidate !== undefined) ?? fallback;
}

/** Reads the monotonic sequence fields used by combat result payloads. */
export function combatSequenceFrom(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return [record.sequence, record.sequenceNumber, record.order]
    .map(asFiniteNumber)
    .find((candidate) => candidate !== undefined);
}

/**
 * Local insertion order is the baseline. Server-tagged blocks are reordered among themselves by
 * `serverSequence`, inside the slots they already occupy; untagged blocks keep their positions.
 *
 * The two numbers are on different scales (local 0, 1, 2… against the server's counter), so a
 * single `serverSequence ?? sequence` key misorders a batch where only some payloads are tagged —
 * which is exactly what a staggered server rollout produces.
 */
export function orderCombatEngineBlocks(blocks: CombatEngineBlock[]): CombatEngineBlock[] {
  const local = [...blocks].sort((left, right) => left.sequence - right.sequence);
  const tagged = local
    .filter((block) => block.serverSequence !== undefined)
    .sort(
      (left, right) =>
        (left.serverSequence ?? 0) - (right.serverSequence ?? 0) || left.sequence - right.sequence,
    );
  let nextTagged = 0;
  return local.map((block) => (block.serverSequence === undefined ? block : tagged[nextTagged++]));
}

export function combatEngineBlocksFromContext(
  context: Record<string, unknown> | undefined,
): CombatEngineBlock[] {
  const value = context?.combatEngineBlocks ?? context?.combat_engine_blocks;
  if (!Array.isArray(value)) return [];
  return orderCombatEngineBlocks(
    value.filter((block): block is CombatEngineBlock => {
      if (!block || typeof block !== 'object') return false;
      const candidate = block as Record<string, unknown>;
      return (
        typeof candidate.sequence === 'number' &&
        typeof candidate.round === 'number' &&
        (candidate.source === 'player' || candidate.source === 'npc') &&
        Array.isArray(candidate.lines) &&
        candidate.lines.every((line) => typeof line === 'string')
      );
    }),
  );
}

export function combatMessageEndedCombat(message: {
  sender?: string;
  context?: Record<string, unknown>;
}): boolean {
  return (
    message.sender === 'dm' &&
    Boolean(message.context?.combatEnded ?? message.context?.combat_ended)
  );
}
