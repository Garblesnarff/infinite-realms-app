/**
 * #913: one in-flight seating for a pending entry.
 *
 * The generate handler and the open tab's poll can both see the same proposal.
 * Each used to confirm, roll initiative, and POST /enter on its own. The second
 * confirmation declined the first card, and the second POST was refused because
 * the encounter already existed. The first caller runs the prompts. A later
 * caller for the same actors waits for that result.
 */
import type { AIResponse } from '@/services/ai/shared/types';

import { confirmCombatEntry } from '@/hooks/ai/combat-entry-hold';
import { SessionExpiredError } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { requestPlayerInitiativeRoll } from '@/services/combat/player-roll-bridge';
import {
  buildCombatEntryPlayer,
  type CombatEntryPayload,
  type CombatEntryPlayerPayload,
} from '@/services/combat/structured-combat-payload';
import { userDataApi } from '@/services/user-data-api';

export type DeliverableCombatEntry = NonNullable<AIResponse['combat_entry_pending']> & {
  seatingHint?: CombatEntryPayload['seatingHint'];
};

export type CombatEntryDeliveryResult =
  | { kind: 'declined' }
  | { kind: 'seated'; entryPayload: unknown; encounterId: string }
  | { kind: 'already-seated'; encounterId: string };

const COMBAT_ENTRY_FAILURE_NOTICE = 'Combat entry failed. No encounter was seated.';

type DeliveryArgs = {
  sessionId: string;
  pending: DeliverableCombatEntry;
  player: CombatEntryPlayerPayload;
  playerMessage?: string;
  /** The player already chose Strike before the DM was called. */
  entryConfirmed?: boolean;
  signal?: AbortSignal;
  confirm?: () => Promise<boolean>;
  rollInitiative?: () => Promise<{ d20: number | null }>;
};

let inflight: { key: string; promise: Promise<CombatEntryDeliveryResult> } | null = null;
/**
 * The poll can finish confirm, initiative, and `/enter` while generate is still
 * hung. A later handler call must see that seated result and resolve the opening
 * attack. A fresh call would get 409 and skip it. Forgotten after the DM reply
 * watchdog so a later fight is not handed this promise.
 */
const remembered = new Map<string, { at: number; promise: Promise<CombatEntryDeliveryResult> }>();
const REMEMBERED_DELIVERY_MS = 130_000;

function rememberedDelivery(key: string): Promise<CombatEntryDeliveryResult> | null {
  const row = remembered.get(key);
  if (!row) return null;
  if (Date.now() - row.at > REMEMBERED_DELIVERY_MS) {
    remembered.delete(key);
    return null;
  }
  return row.promise;
}

type PlayerSource = () => CombatEntryPlayerPayload | null;
let playerSource: PlayerSource | null = null;
const playerSourceListeners = new Set<() => void>();

/** The playing session registers the character the poll seats with. */
export function registerCombatEntryPlayerSource(source: PlayerSource): () => void {
  playerSource = source;
  for (const listener of playerSourceListeners) listener();
  return () => {
    if (playerSource !== source) return;
    playerSource = null;
    for (const listener of playerSourceListeners) listener();
  };
}

export function currentCombatEntryPlayer(): CombatEntryPlayerPayload | null {
  return playerSource?.() ?? null;
}

export function onCombatEntryPlayerSourceChange(listener: () => void): () => void {
  playerSourceListeners.add(listener);
  return () => {
    playerSourceListeners.delete(listener);
  };
}

export function combatEntryActorKey(pending: DeliverableCombatEntry): string {
  return pending.combatants
    .map((combatant) => combatant.name.trim().toLocaleLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
}

function enterBody(args: DeliveryArgs, d20: number | null): CombatEntryPayload {
  return {
    combatants: args.pending.combatants,
    sceneSpec: args.pending.sceneSpec,
    player: args.player,
    ...(args.pending.declaredAttack ? { declaredAttack: args.pending.declaredAttack } : {}),
    ...(args.pending.seatingHint ? { seatingHint: args.pending.seatingHint } : {}),
    ...(d20 === null ? {} : { playerInitiativeRoll: d20 }),
  };
}

async function encounterIdFromActive(sessionId: string): Promise<string | null> {
  if (typeof userDataApi.getActiveCombat !== 'function') return null;
  const active = await userDataApi.getActiveCombat(sessionId);
  if (!active.ok) return null;
  const body = (await active.json().catch(() => null)) as { combat?: { id?: unknown } } | null;
  return typeof body?.combat?.id === 'string' ? body.combat.id : null;
}

async function runDelivery(args: DeliveryArgs): Promise<CombatEntryDeliveryResult> {
  // A fight already on the board does not get another Strike card. The poll
  // reaches this after the handler has seated; the handler's own late call
  // joins the remembered poll result above and never gets here.
  const alreadySeated = await encounterIdFromActive(args.sessionId);
  if (alreadySeated) return { kind: 'already-seated', encounterId: alreadySeated };
  const confirmed =
    args.entryConfirmed === true ||
    (await (
      args.confirm ?? (() => confirmCombatEntry(args.pending, args.player, args.playerMessage))
    )());
  if (!confirmed) {
    await userDataApi.declinePendingCombatEntry?.(args.sessionId);
    return { kind: 'declined' };
  }
  const initiative = await (
    args.rollInitiative ??
    (() =>
      requestPlayerInitiativeRoll({
        actorLabel: args.player.name,
        initiativeModifier: args.player.initiativeModifier,
      }))
  )();
  const payload = enterBody(args, initiative.d20);
  const enterResponse = args.signal
    ? await userDataApi.enterCombat(args.sessionId, payload, args.signal)
    : await userDataApi.enterCombat(args.sessionId, payload);
  if (!enterResponse.ok) {
    if (enterResponse.status === 401) throw new SessionExpiredError();
    if (enterResponse.status === 409) {
      const encounterId = await encounterIdFromActive(args.sessionId);
      if (encounterId) {
        await userDataApi.declinePendingCombatEntry?.(args.sessionId);
        return { kind: 'already-seated', encounterId };
      }
    }
    logger.warn('[CombatEntry] server refused explicit entry', { status: enterResponse.status });
    throw Object.assign(new Error(COMBAT_ENTRY_FAILURE_NOTICE), {
      name: 'CombatEntryFailedError',
      status: enterResponse.status,
    });
  }
  const entryPayload = await enterResponse.json().catch(() => null);
  const encounterId =
    typeof (entryPayload as { encounter?: { id?: unknown } } | null)?.encounter?.id === 'string'
      ? (entryPayload as { encounter: { id: string } }).encounter.id
      : args.sessionId;
  return { kind: 'seated', entryPayload, encounterId };
}

/**
 * Seat this proposal once. A second call for the same actors shares the first
 * call. A poll that already finished is remembered so the generate handler,
 * which passes its own `confirm`, still receives that seated result.
 */
export function startCombatEntryDelivery(args: DeliveryArgs): Promise<CombatEntryDeliveryResult> {
  const key = `${args.sessionId}:${combatEntryActorKey(args.pending)}`;
  if (inflight?.key === key) return inflight.promise;
  if (args.confirm) {
    const prior = rememberedDelivery(key);
    if (prior) return prior;
  }
  const promise = runDelivery(args).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { key, promise };
  // Only the poll (no handler closures) is remembered. The handler's own call
  // must stay uncached so unit tests can enter twice in one process.
  if (!args.confirm) remembered.set(key, { at: Date.now(), promise });
  return promise;
}

export function playerFromCharacter(
  character: Record<string, unknown> | null | undefined,
): CombatEntryPlayerPayload | null {
  return buildCombatEntryPlayer(character);
}
