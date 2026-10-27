import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { ChatMessage } from '@/types/game';

import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { getAuthHeaders } from '@/services/auth/TokenService';
import { equipCharacterItem } from '@/services/character-equipment-api';
import {
  combatBoundaryFromResult,
  resultCarriesPersistedPlayerRow,
} from '@/services/combat/combat-action-boundary';
import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
  type ClientCombatIntent,
  type StructuredCombatAction,
} from '@/services/combat/combat-action-executor';
import {
  engineRosterOf,
  formatCombatActionParts,
  formatCombatEndLine,
  formatDeathSaveParts,
  formatWakeParts,
} from '@/services/combat/combat-outcome-transcript';
import { endTurnUnlessAlreadyMoved } from '@/services/combat/end-turn-already-moved';
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';
import { resolvePlayerCombatSpell } from '@/services/combat/player-combat-spell';
import { actorMovementRemaining } from '@/services/combat/player-movement-remaining';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export function fleeProvokerOf(label: string): string | null {
  return label.match(/\((.+?) attacks\)/)?.[1] ?? null;
}

export type LegalAction = {
  type: ClientCombatIntent['type'];
  label: string;
  weaponId?: string;
  spellId?: string;
  /** #1147: the inventory item a Use chip spends. */
  itemId?: string;
  targetIds?: string[];
  x?: number;
  y?: number;
  /** #1059: an 'Equip and attack' choice — equip the weapon before declaring the attack. */
  equipFirst?: boolean;
  /**
   * A sheet spell `getLegalCombatActions` will not resolve (#1171). The Cast menu shows it
   * greyed. `runAction` does not send it.
   */
  narrated?: boolean;
};

type EngineNotice = {
  text: string;
  cards: ReturnType<typeof formatCombatActionParts>[number]['card'][];
  /** True when the notice carries the combat end line: it is this fight's terminal message (#976). */
  combatEnded?: boolean;
};

async function sendEngineNotice(
  onSendMessage: ((message: ChatMessage) => Promise<void>) | undefined,
  notice: EngineNotice,
): Promise<void> {
  if (!onSendMessage || !notice.text) return;
  const message: ChatMessage = {
    // A stable id from creation (#976 self-review): the deferred summary's
    // baseline keys messages by id, and a notice keyed by `timestamp|text`
    // until hydration re-keys it to the saved uuid — a previous fight's notice
    // could then fall outside the next fight's baseline and release its
    // summary early. The queue preserves a supplied id end-to-end. uuidv4,
    // not crypto.randomUUID: the latter is undefined on non-secure origins.
    id: uuidv4(),
    text: notice.text,
    sender: 'system',
    timestamp: new Date().toISOString(),
    persist: true,
    context: {
      intent: 'combat_pending_intent',
      ...(notice.cards.length ? { engineCards: notice.cards } : {}),
      ...(notice.combatEnded ? { combatEnded: true } : {}),
    },
  };
  try {
    await onSendMessage(message);
  } catch {
    // The action already resolved authoritatively; a persistence failure must not turn it into a
    // retryable combat action or leave the action bar stuck in its pending state.
  }
}

export function useCombatLegalActions(input: {
  enabled: boolean;
  onSendMessage?: (message: ChatMessage) => Promise<void>;
  onSendText: (text: string) => Promise<void>;
}): {
  actorId?: string;
  actions: LegalAction[];
  isPlayerTurn: boolean;
  isRefreshing: boolean;
  error: string | null;
  /** #1143: the last legal-action fetch failed (network or non-2xx); `retryLoad` asks again. */
  loadFailed: boolean;
  retryLoad: () => Promise<void>;
  runAction: (action: LegalAction, options?: { exitConfirmed?: boolean }) => Promise<void>;
} {
  const { state: combatState, refreshCombatState } = useCombat();
  const showCombatMenu = input.enabled;
  const [error, setError] = useState<string | null>(null);
  const encounter = combatState.activeEncounter;
  const roster = useMemo(() => engineRosterOf(encounter?.participants), [encounter?.participants]);
  const [legalState, setLegalState] = useState<{ actorId?: string; actions: LegalAction[] }>({
    actions: [],
  });
  // Explicit loading signal for the action-options menu (#118): true from the
  // moment a combat action is dispatched (or a legal-action re-fetch starts)
  // until that re-fetch settles, so ActionOptions retains disabled old options
  // only during an actual refresh and clears a settled empty menu immediately.
  const [isRefreshingLegalActions, setIsRefreshingLegalActions] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refreshLegalActions = useCallback(async () => {
    if (!showCombatMenu || !encounter?.id) {
      setIsRefreshingLegalActions(false);
      return;
    }
    setIsRefreshingLegalActions(true);
    try {
      const response = await fetch(
        `${apiBase}/v1/combat/${encodeURIComponent(encounter.id)}/legal-actions`,
        {
          headers: getAuthHeaders(),
        },
      );
      if (!response.ok) {
        setLoadFailed(true);
        setLegalState((previous) => ({ actorId: previous.actorId, actions: [] }));
        return;
      }
      const payload = (await response.json()) as { actorId?: string; actions?: LegalAction[] };
      setLoadFailed(false);
      // A dying player's only legal action is the death save, and the dying panel owns it: a
      // chip here would send the label as a typed action to a character who cannot act.
      setLegalState({
        actorId: payload.actorId,
        actions: (payload.actions ?? []).filter((action) => action.type !== 'death_save'),
      });
    } catch (loadError) {
      // #1143: a failed fetch used to leave the bar silently empty. Say so and offer a retry;
      // the chat box stays open either way.
      logger.warn('[CombatLegalActions] legal-action fetch failed', loadError);
      setLoadFailed(true);
      setLegalState((previous) => ({ actorId: previous.actorId, actions: [] }));
    } finally {
      setIsRefreshingLegalActions(false);
    }
  }, [showCombatMenu, encounter?.id, encounter?.currentTurnParticipantId, encounter?.currentRound]);

  useEffect(() => {
    void refreshLegalActions();
  }, [refreshLegalActions]);

  const isPlayerTurn =
    legalState.actorId === encounter?.currentTurnParticipantId &&
    !!encounter?.participants.some(
      (participant) =>
        participant.id === legalState.actorId && participant.participantType === 'player',
    );

  const runAction = useCallback(
    async (action: LegalAction, options?: { exitConfirmed?: boolean }) => {
      if (!encounter?.id) return;
      const actorId = legalState.actorId || encounter.currentTurnParticipantId;
      if (
        !action ||
        !actorId ||
        !encounter.participants.some(
          (participant) => participant.id === actorId && participant.participantType === 'player',
        )
      )
        return;
      // A greyed Cast row is a description, not an intent (#1171).
      if (action.narrated) return;
      setError(null);
      // The refresh cycle starts with the dispatch: every path below re-fetches
      // legal actions in the finally, and the combat-state update in between can
      // commit while the fetch has not started yet (#118).
      setIsRefreshingLegalActions(true);
      try {
        if (action.type === 'end_turn') {
          // The server writes the boundary's row (death saves, a stable hero waking, the
          // ending) and runs the creatures that follow before it answers (#2658).
          await endTurnUnlessAlreadyMoved(encounter.id, {
            type: 'end_turn',
            actorId,
            actionId: crypto.randomUUID(),
          });
          await refreshCombatState();
        } else if (
          action.type === 'move' &&
          typeof action.x === 'number' &&
          typeof action.y === 'number'
        ) {
          const result = await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: 'move', actorId, x: action.x, y: action.y },
            'dm',
            Date.now(),
            'typed',
          );
          const parts = [
            ...formatCombatActionParts({ actor_id: actorId, action_type: 'move' }, result, roster),
            ...formatWakeParts(result),
          ];
          await sendEngineNotice(input.onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          await refreshCombatState();
        } else if (action.type === 'flee' || action.type === 'yield') {
          // #2580: the way out of a fight the end guard holds open. The one-line confirm names
          // the attacker the engine put in the legal-action label, and is asked only when one is
          // in reach — so a flee into empty space is never dressed up as dangerous, and a real
          // opportunity attack is never sprung on a player who was not warned first.
          const provoked = fleeProvokerOf(action.label);
          if (
            action.type === 'flee' &&
            provoked &&
            !options?.exitConfirmed &&
            !window.confirm(`Flee? ${provoked} gets one attack as you turn.`)
          )
            return;
          const result = await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: action.type, actorId },
            'dm',
            Date.now(),
            'action_bar',
          );
          const parts = [
            ...formatCombatActionParts(
              { actor_id: actorId, action_type: action.type },
              result,
              roster,
            ),
            ...formatWakeParts(result),
          ];
          // #262: a yield that ends the fight must carry the engine end line with its
          // reason — the same line the attack/spell branches append when the boundary
          // reports combat_ended. Without it the yield dead-ends at "X yielded.".
          const endLine =
            combatBoundaryFromResult(result) === 'combat_ended'
              ? formatCombatEndLine((result as { endedReason?: string | null } | null)?.endedReason)
              : null;
          // #1169: the server already persisted the exit row.
          if (!resultCarriesPersistedPlayerRow(result)) {
            await sendEngineNotice(input.onSendMessage, {
              text: [...parts.map((part) => part.line), ...(endLine ? [endLine] : [])].join('\n\n'),
              cards: parts.map((part) => part.card),
              combatEnded: endLine != null,
            });
          }
          // No `end_turn` after it: the exit has already taken the player out of the turn order,
          // and a turn boundary for a participant who no longer has one is a second refusal.
          await refreshCombatState();
        } else if (action.type === 'dodge') {
          // #262: Dodge ends the turn. The DM pipeline crosses the turn boundary
          // after every executed action; the inline option has to do the same or
          // the turn stays open on a spent action. Disadvantage on attacks against
          // the dodger is applied by the engine until their next turn.
          const result = await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: 'dodge', actorId },
            'dm',
            Date.now(),
            'typed',
          );
          const parts = [
            ...formatCombatActionParts({ actor_id: actorId, action_type: 'dodge' }, result, roster),
            ...formatWakeParts(result),
          ];
          await sendEngineNotice(input.onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          if (!(result as { combatEnded?: boolean } | null)?.combatEnded) {
            await executeAuthoritativeCombatIntent(encounter.id, {
              type: 'end_turn',
              actorId,
              actionId: crypto.randomUUID(),
            });
          }
          await refreshCombatState();
        } else if (action.type === 'dash' || action.type === 'disengage') {
          const result = await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: action.type, actorId },
            'dm',
            Date.now(),
            'typed',
          );
          const parts = [
            ...formatCombatActionParts(
              { actor_id: actorId, action_type: action.type },
              result,
              roster,
            ),
            ...formatWakeParts(result),
          ];
          await sendEngineNotice(input.onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          await refreshCombatState();
        } else if (action.type === 'second_wind' || action.type === 'action_surge') {
          // #975: the Fighter features, like Dash — the engine spends the tracked
          // use and applies the effect, the notice prints the engine line, and the
          // turn stays open (Second Wind costs only the bonus action; Action Surge
          // exists to take another action this turn). No `end_turn` after either.
          const result = await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: action.type, actorId },
            'dm',
            Date.now(),
            'typed',
          );
          const parts = [
            ...formatCombatActionParts(
              { actor_id: actorId, action_type: action.type },
              result,
              roster,
            ),
            ...formatWakeParts(result),
          ];
          await sendEngineNotice(input.onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          await refreshCombatState();
        } else if (action.type === 'use_item') {
          // #1147: drinking a healing consumable, like Second Wind — the engine
          // heals and spends the item, the notice prints the engine line. Unlike
          // Second Wind it costs the Action, so the turn settles like an attack:
          // with no movement left and the fight still open, the turn ends here.
          if (!action.itemId) {
            setError('That item could not be used. Nothing was spent.');
            return;
          }
          const result = await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: 'use_item', actorId, itemId: action.itemId },
            'dm',
            Date.now(),
            'typed',
          );
          const parts = [
            ...formatCombatActionParts(
              { actor_id: actorId, action_type: 'use_item' },
              result,
              roster,
            ),
            ...formatWakeParts(result),
          ];
          await sendEngineNotice(input.onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          if (combatBoundaryFromResult(result) === null) {
            const movementLeft = await actorMovementRemaining(encounter.sessionId, actorId);
            if (movementLeft === null || movementLeft <= 0) {
              await executeAuthoritativeCombatIntent(encounter.id, {
                type: 'end_turn',
                actorId,
                actionId: crypto.randomUUID(),
              });
            }
          }
          await refreshCombatState();
        } else if (action.type === 'attack' && action.targetIds?.[0]) {
          // #1059: an 'Equip and attack' choice readies the weapon first —
          // the same equip write the sheet's Equip control makes (drawing is
          // the turn's free object interaction) — so the commit below finds
          // it equipped instead of refusing 'not equipped'. A failed equip
          // stops the pipeline: nothing is declared and nothing is spent.
          if (action.equipFirst && action.weaponId) {
            const actorParticipant = encounter.participants.find(
              (participant) => participant.id === actorId,
            );
            if (!actorParticipant?.characterId) {
              setError('The weapon could not be equipped. Nothing was spent.');
              return;
            }
            try {
              await equipCharacterItem(actorParticipant.characterId, action.weaponId);
            } catch {
              setError('The weapon could not be equipped. Nothing was spent.');
              return;
            }
          }
          // #2563: an attack option runs the declare → dialog → commit pipeline
          // itself. It used to send "I attack with … against …" as chat text, which
          // made the DM the first to see the attack: in run D5 round 2 the DM's
          // envelope carried the swing but nothing ever rolled it — no dialog, no
          // intent — and the fight closed on narration. The engine legal-action chip
          // already knows the actor, weapon and target, so it declares directly.
          const structuredAction: StructuredCombatAction = {
            actor_id: actorId,
            action_type: 'attack',
            target_ids: [action.targetIds[0]],
            weapon_id: action.weaponId ?? null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          };
          const actor = encounter.participants.find((participant) => participant.id === actorId);
          const die = await askPlayerForAttackDie({
            encounterId: encounter.id,
            action: structuredAction,
            actorLabel: actor?.name ?? 'You',
          });
          // #2652 round 4: same gap as the spell branch — if the proposal was
          // refused/failed or the popup did not produce a die, stop here.
          // A movement-only approach needs no die.
          // #566: the 45 s timer is the exception — its countdown promised the game
          // rolls for the player, so the commit below runs with no player die and the
          // engine rolls. A dismissed or refused popup still stops here.
          if (!die.movementOnly && !die.timedOut && (die.autoRolled || die.d20 == null)) {
            setError(
              action.equipFirst
                ? 'The attack could not be made. The weapon stays equipped.'
                : 'The attack could not be made. Nothing was spent.',
            );
            return;
          }
          const execution = await executeStructuredCombatActionWithBoundary(
            encounter.id,
            structuredAction,
            die.d20,
            die.d20Rolls,
            'action_bar',
          );
          const playerParts = [
            ...formatCombatActionParts(structuredAction, execution.result, roster),
            ...formatDeathSaveParts(execution.result, roster),
            ...formatWakeParts(execution.result),
          ];
          const playerEndLine =
            execution.boundary === 'combat_ended'
              ? formatCombatEndLine(
                  (execution.result as { endedReason?: string | null } | null)?.endedReason,
                )
              : null;
          // #570: a killing attack's row is already persisted by the server (the
          // Victory notice posts behind it); this notice would print the blow twice.
          if (!resultCarriesPersistedPlayerRow(execution.result)) {
            await sendEngineNotice(input.onSendMessage, {
              text: [
                ...playerParts.map((part) => part.line),
                ...(playerEndLine ? [playerEndLine] : []),
              ].join('\n\n'),
              cards: playerParts.map((part) => part.card),
              combatEnded: playerEndLine != null,
            });
          }
          const movementOnly =
            die.movementOnly ||
            (execution.result as { resolvedAs?: string } | null)?.resolvedAs === 'movement_only';
          // A resolved attack settles the turn only when the player has nothing left to do —
          // one swing does not spend the whole turn (#263 CB-011). With movement remaining
          // the turn stays open and the refreshed menu offers Move / End turn. A
          // movement-only approach spent no Action, so the turn stays open and the
          // refreshed menu offers the attack again — now in reach.
          if (!movementOnly && execution.boundary === null) {
            const movementLeft = await actorMovementRemaining(encounter.sessionId, actorId);
            if (movementLeft === null || movementLeft <= 0) {
              await endTurnUnlessAlreadyMoved(encounter.id, {
                type: 'end_turn',
                actorId,
                actionId: crypto.randomUUID(),
              });
            }
          }
          await refreshCombatState();
        } else if (action.type === 'spell' && action.targetIds?.[0]) {
          // #2581: an attack-roll spell chip runs the same declare → dialog → commit
          // pipeline as a weapon attack. It used to send "Cast Fire Bolt" as chat text
          // for the DM to declare, so a spell attack could be narrated as a hit before
          // any roll (run M2's Chill Touch). Save-based and auto-hit spells keep the
          // text path below.
          const spell = resolvePlayerCombatSpell(action.spellId, action.spellId);
          if (spell?.kind !== 'attack') {
            await input.onSendText(action.label);
          } else {
            const structuredAction: StructuredCombatAction = {
              actor_id: actorId,
              action_type: 'cast_spell',
              target_ids: [action.targetIds[0]],
              weapon_id: null,
              spell_id: action.spellId ?? null,
              slot_level: null,
              movement_feet: 0,
            };
            const actor = encounter.participants.find((participant) => participant.id === actorId);
            const cast = await askPlayerForSpellCast({
              encounterId: encounter.id,
              action: structuredAction,
              actorLabel: actor?.name ?? 'You',
              participants: encounter.participants,
            });
            // #2652 round 4: if the proposal was refused/failed or the popup did not
            // produce a die, stop here. Committing with an undefined d20 would let the
            // engine roll for the player — the bug this PR exists to close.
            // A movement-only cast needs no die.
            // #566: the 45 s timer is the exception — its countdown promised the game
            // rolls for the player, so the commit below runs with no player die and the
            // engine rolls. A dismissed or refused popup still stops here.
            if (!cast.movementOnly && !cast.timedOut && (cast.autoRolled || cast.d20 == null)) {
              setError(
                cast.cancelled
                  ? 'The cast was cancelled. Nothing was spent.'
                  : cast.refusal
                    ? `${cast.refusal}. Nothing was spent.`
                    : 'The spell could not be cast. Nothing was spent.',
              );
              return;
            }
            const execution = await executeStructuredCombatActionWithBoundary(
              encounter.id,
              structuredAction,
              cast.d20,
              cast.d20Rolls,
              'action_bar',
            );
            // The cast's engine result persists like a weapon attack's (#2622): one row.
            const playerParts = [
              ...formatCombatActionParts(structuredAction, execution.result, roster),
              ...formatDeathSaveParts(execution.result, roster),
              ...formatWakeParts(execution.result),
            ];
            const playerEndLine =
              execution.boundary === 'combat_ended'
                ? formatCombatEndLine(
                    (execution.result as { endedReason?: string | null } | null)?.endedReason,
                  )
                : null;
            // #570: same as the attack branch — a killing cast's row is already
            // persisted by the server; this notice would print the cast twice.
            if (!resultCarriesPersistedPlayerRow(execution.result)) {
              await sendEngineNotice(input.onSendMessage, {
                text: [
                  ...playerParts.map((part) => part.line),
                  ...(playerEndLine ? [playerEndLine] : []),
                ].join('\n\n'),
                cards: playerParts.map((part) => part.card),
                combatEnded: playerEndLine != null,
              });
            }
            const movementOnly =
              (execution.result as { resolvedAs?: string } | null)?.resolvedAs === 'movement_only';
            // A resolved cast settles the turn only when the player has nothing left to do
            // (#263 CB-011). With movement remaining the turn stays open and the refreshed
            // menu offers Move / End turn. A movement-only resolution spent no Action,
            // so the turn stays open.
            if (!movementOnly && execution.boundary === null) {
              const movementLeft = await actorMovementRemaining(encounter.sessionId, actorId);
              if (movementLeft === null || movementLeft <= 0) {
                await endTurnUnlessAlreadyMoved(encounter.id, {
                  type: 'end_turn',
                  actorId,
                  actionId: crypto.randomUUID(),
                });
              }
            }
            await refreshCombatState();
          }
        } else if (action.type === 'spell' && action.spellId) {
          // #2652 round 4: an attack-kind spell with no target must not be sent to
          // the DM as chat text, even from a stale menu. The server withholds such
          // chips, but the client refuses them too.
          const spell = resolvePlayerCombatSpell(action.spellId, action.spellId);
          if (spell?.kind === 'attack') {
            setError('That spell needs a target. Nothing was spent.');
            return;
          }
          await input.onSendText(action.label);
        } else {
          await input.onSendText(action.label);
        }
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'The action could not be completed. You can end your turn.',
        );
      } finally {
        await refreshLegalActions();
      }
    },
    [encounter, legalState, roster, input, refreshCombatState, refreshLegalActions],
  );

  return {
    actorId: legalState.actorId,
    actions: legalState.actions,
    isPlayerTurn,
    isRefreshing: isRefreshingLegalActions,
    loadFailed,
    retryLoad: refreshLegalActions,
    error,
    runAction,
  };
}
