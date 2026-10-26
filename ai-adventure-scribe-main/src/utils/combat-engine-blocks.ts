import type { EngineResultCard } from '@/services/combat/engine-result-card';

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
  /** One card per engine result among `lines`, built from the engine result fields (#2417). */
  cards?: EngineResultCard[];
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
  if (!(message.context?.combatEnded ?? message.context?.combat_ended)) return false;
  // The flag is stamped by three producers: use-ai-response on the DM reply that
  // narrates the end, buildNpcEngineMessage on the terminal row it persists for
  // a server-ended fight, and useCombatLegalActions on the local notice it posts
  // when no row was persisted (#976). Engine presentations are 'system'
  // messages; without them a server-ended fight never matches this gate and its
  // Combat Summary waits out the fallback timer.
  return message.sender === 'dm' || message.sender === 'system';
}

function combatMessageIsSummary(message: {
  sender?: string;
  context?: Record<string, unknown>;
}): boolean {
  if (message.sender !== 'system') return false;
  const combatData = message.context?.combatData as
    | { type?: unknown; summary?: unknown }
    | undefined;
  return combatData?.type === 'summary' || Boolean(combatData?.summary);
}

/**
 * The messages whose saved options a later combat end has made stale (#864): everything before
 * a combat-end boundary — a message that ended a fight (a DM reply, or the terminal engine
 * row/notice of a server-ended fight), or that fight's Combat Summary —
 * belongs to the pre-fight world, so its options must stop rendering once the fight is over.
 * The message that ended the fight is the boundary, not a victim of it: its options are the
 * post-combat ones. A summary closes only the world before its fight's terminal message:
 * the deferred summary posts late (it awaits the damage-summary fetch, or the fallback
 * timer), and DM replies the player already drew from the terminal's options can sit between
 * the two — those are current, not stale. A summary whose fight's terminal message never
 * landed (or lands after it) closes everything before itself.
 */
export function messagesSupersededByCombatEnd<
  M extends { sender?: string; context?: Record<string, unknown> },
>(messages: readonly M[]): Set<M> {
  const superseded = new Set<M>();
  // For each summary, the index it closes up to: the last terminal DM message before it,
  // or its own index when no terminal precedes it.
  const summaryBound = new Map<number, number>();
  let lastTerminal = -1;
  messages.forEach((message, index) => {
    if (combatMessageEndedCombat(message)) lastTerminal = index;
    if (combatMessageIsSummary(message))
      summaryBound.set(index, lastTerminal === -1 ? index : lastTerminal);
  });
  let laterTerminal = false;
  let summaryReach = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (laterTerminal || summaryReach > index) superseded.add(message);
    if (combatMessageEndedCombat(message)) laterTerminal = true;
    const bound = summaryBound.get(index);
    if (bound !== undefined && bound > summaryReach) summaryReach = bound;
  }
  return superseded;
}

/**
 * What the chat divider compares: the round and the actor. A block with no actor (the NPC loop's
 * safety line) is not an actor's turn, so it never starts a divider.
 */
export function engineBlockDividerKey(block: CombatEngineBlock): string | undefined {
  return block.actor ? `${block.round}|${block.actor}` : undefined;
}

/**
 * For each DM or engine message that carries engine blocks, the divider key of the last block before it
 * (`undefined` at the start of a fight), so a divider prints only where the round or the actor
 * changes, across messages as well as inside one. A message that ends combat starts the next
 * fight afresh.
 */
export function previousEngineDividerKeys<
  M extends { sender?: string; context?: Record<string, unknown> },
>(messages: readonly M[]): Map<M, string | undefined> {
  const previous = new Map<M, string | undefined>();
  let last: string | undefined;
  for (const message of messages) {
    if (message.sender !== 'dm' && message.sender !== 'system') continue;
    const blocks = combatEngineBlocksFromContext(message.context);
    if (blocks.length) {
      previous.set(message, last);
      for (const block of blocks) last = engineBlockDividerKey(block) ?? last;
    }
    if (combatMessageEndedCombat(message)) last = undefined;
  }
  return previous;
}
