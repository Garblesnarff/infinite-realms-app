import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatMessage } from '@/types/game';
import type { ActionOption } from '@/utils/parseMessageOptions';

import { ActionOptions } from '@/components/game/ActionOptions';
import { useCombat } from '@/contexts/CombatContext';
import { getAuthHeaders } from '@/services/auth/TokenService';
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
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';
import { resolvePlayerCombatSpell } from '@/services/combat/player-combat-spell';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';
import { createPlayerMessageFromOption } from '@/utils/parseMessageOptions';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';
type LegalAction = {
  type: ClientCombatIntent['type'];
  label: string;
  weaponId?: string;
  spellId?: string;
  targetIds?: string[];
  x?: number;
  y?: number;
};

type LegalActionsResponse = { actorId?: string; actions?: LegalAction[] };

const inFlightLegalActions = new Map<string, Promise<LegalActionsResponse | null>>();

export function fetchLegalActions(
  encounterId: string,
  actorId: string | undefined,
  round: number | undefined,
  options?: { force?: boolean },
): Promise<LegalActionsResponse | null> {
  const key = `${encounterId}:${actorId ?? ''}:${round ?? ''}`;
  if (!options?.force) {
    const existing = inFlightLegalActions.get(key);
    if (existing) return existing;
  }

  const request = fetch(`${apiBase}/v1/combat/${encodeURIComponent(encounterId)}/legal-actions`, {
    headers: getAuthHeaders(),
  }).then(async (response) => {
    if (!response.ok) return null;
    return (await response.json()) as LegalActionsResponse;
  });
  inFlightLegalActions.set(key, request);
  const clear = (): void => {
    if (inFlightLegalActions.get(key) === request) inFlightLegalActions.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

interface DynamicOptionsSectionProps {
  options: ActionOption[];
  onOptionSelect: (optionText: string) => Promise<void>;
  hasDynamicOverlay: boolean;
  onSendMessage?: (message: ChatMessage) => Promise<void>;
  /** False for a past message: it keeps its own options and never turns into the combat menu. */
  isLatest?: boolean;
}

type EngineNotice = {
  text: string;
  cards: ReturnType<typeof formatCombatActionParts>[number]['card'][];
};

async function sendEngineNotice(
  onSendMessage: DynamicOptionsSectionProps['onSendMessage'],
  notice: EngineNotice,
): Promise<void> {
  if (!onSendMessage || !notice.text) return;
  const message: ChatMessage = {
    text: notice.text,
    sender: 'system',
    timestamp: new Date().toISOString(),
    persist: true,
    context: {
      intent: 'combat_pending_intent',
      ...(notice.cards.length ? { engineCards: notice.cards } : {}),
    },
  };
  try {
    await onSendMessage(message);
  } catch {
    // The action already resolved authoritatively; a persistence failure must not turn it into a
    // retryable combat action or leave the action bar stuck in its pending state.
  }
}

/**
 * DynamicOptionsSection Component
 * Displays action suggestions parsed inline from the DM message text
 * (see parseMessageOptions / ActionOptions).
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the options
 * section when unrelated message list state changes.
 */
export const DynamicOptionsSection: React.FC<DynamicOptionsSectionProps> = React.memo(
  ({ options, onOptionSelect, hasDynamicOverlay, onSendMessage, isLatest = true }) => {
    const { state: combatState, refreshCombatState } = useCombat();
    const showCombatMenu = isLatest && combatState.isInCombat;
    const [error, setError] = useState<string | null>(null);
    const encounter = combatState.activeEncounter;
    const roster = useMemo(
      () => engineRosterOf(encounter?.participants),
      [encounter?.participants],
    );
    const [legalState, setLegalState] = useState<{ actorId?: string; actions: LegalAction[] }>({
      actions: [],
    });

    // Monotonic id of the latest legal-actions GET. A forced refresh does
    // not stop an older GET from landing last, so only the latest request
    // may write its payload; a stale one is dropped.
    const legalRequestSeq = useRef(0);

    const refreshLegalActions = useCallback(
      async (force = false) => {
        if (!showCombatMenu || !encounter?.id) return;
        const seq = (legalRequestSeq.current += 1);
        const payload = await fetchLegalActions(
          encounter.id,
          encounter.currentTurnParticipantId,
          encounter.currentRound,
          { force },
        );
        if (!payload) return;
        if (seq !== legalRequestSeq.current) return;
        setLegalState({ actorId: payload.actorId, actions: (payload.actions ?? []).filter((action) => action.type !== 'death_save') });
      },
      [
        showCombatMenu,
        encounter?.id,
        encounter?.currentTurnParticipantId,
        encounter?.currentRound,
      ],
    );

    useEffect(() => {
      void refreshLegalActions();
    }, [refreshLegalActions]);

    const renderedOptions = useMemo<ActionOption[]>(() => {
      if (!showCombatMenu) return options;
      if (
        legalState.actorId !== encounter?.currentTurnParticipantId ||
        !encounter?.participants.some(
          (participant) =>
            participant.id === legalState.actorId && participant.participantType === 'player',
        )
      )
        return [];
      return legalState.actions.map((action, index) => ({
        id: `combat-${action.type}-${index}`,
        number: index + 1,
        text: action.label,
        fullText: action.label,
      }));
    }, [showCombatMenu, legalState.actions, legalState.actorId, encounter?.participants, options]);

    if (!renderedOptions || renderedOptions.length === 0) {
      return null;
    }

    const handleSelection = async (option: ActionOption) => {
      if (!showCombatMenu || !encounter?.id) {
        await onOptionSelect(createPlayerMessageFromOption(option));
        return;
      }
      const action = legalState.actions[option.number - 1];
      const actorId = legalState.actorId || encounter.currentTurnParticipantId;
      if (
        !action ||
        !actorId ||
        !encounter.participants.some(
          (participant) => participant.id === actorId && participant.participantType === 'player',
        )
      )
        return;
      setError(null);
      try {
        if (action.type === 'end_turn') {
          // The server writes the boundary's row (death saves, a stable hero waking, the
          // ending) and runs the creatures that follow before it answers (#2658).
          await executeAuthoritativeCombatIntent(encounter.id, {
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
          await sendEngineNotice(onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          await refreshCombatState();
        } else if (action.type === 'flee' || action.type === 'yield') {
          // #2580: the way out of a fight the end guard holds open. The one-line confirm names
          // the attacker the engine put in the legal-action label, and is asked only when one is
          // in reach — so a flee into empty space is never dressed up as dangerous, and a real
          // opportunity attack is never sprung on a player who was not warned first.
          const provoked = action.label.match(/\((.+?) attacks\)/)?.[1];
          if (
            action.type === 'flee' &&
            provoked &&
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
          await sendEngineNotice(onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          // No `end_turn` after it: the exit has already taken the player out of the turn order,
          // and a turn boundary for a participant who no longer has one is a second refusal.
          await refreshCombatState();
        } else if (
          action.type === 'dash' ||
          action.type === 'dodge' ||
          action.type === 'disengage'
        ) {
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
          await sendEngineNotice(onSendMessage, {
            text: parts.map((part) => part.line).join('\n\n'),
            cards: parts.map((part) => part.card),
          });
          await refreshCombatState();
        } else if (action.type === 'attack' && action.targetIds?.[0]) {
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
          if (!die.movementOnly && (die.autoRolled || die.d20 == null)) {
            setError('The attack could not be made. Nothing was spent.');
            return;
          }
          const execution = await executeStructuredCombatActionWithBoundary(
            encounter.id,
            structuredAction,
            die.d20,
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
          await sendEngineNotice(onSendMessage, {
            text: [
              ...playerParts.map((part) => part.line),
              ...(playerEndLine ? [playerEndLine] : []),
            ].join('\n\n'),
            cards: playerParts.map((part) => part.card),
          });
          const movementOnly =
            die.movementOnly ||
            (execution.result as { resolvedAs?: string } | null)?.resolvedAs === 'movement_only';
          // A resolved attack settles the turn, the same settlement the DM pipeline
          // performs. A movement-only approach spent no Action, so the turn stays
          // open and the refreshed menu offers the attack again — now in reach.
          if (!movementOnly && execution.boundary === null) {
            await executeAuthoritativeCombatIntent(encounter.id, {
              type: 'end_turn',
              actorId,
              actionId: crypto.randomUUID(),
            });
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
            await onOptionSelect(action.label);
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
            if (!cast.movementOnly && (cast.autoRolled || cast.d20 == null)) {
              setError(
                cast.cancelled
                  ? 'The cast was cancelled. Nothing was spent.'
                  : 'The spell could not be cast. Nothing was spent.',
              );
              return;
            }
            const execution = await executeStructuredCombatActionWithBoundary(
              encounter.id,
              structuredAction,
              cast.d20,
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
            await sendEngineNotice(onSendMessage, {
              text: [
                ...playerParts.map((part) => part.line),
                ...(playerEndLine ? [playerEndLine] : []),
              ].join('\n\n'),
              cards: playerParts.map((part) => part.card),
            });
            const movementOnly =
              (execution.result as { resolvedAs?: string } | null)?.resolvedAs === 'movement_only';
            // A resolved cast settles the turn, the same settlement the DM pipeline
            // performs. A movement-only resolution spent no Action, so the turn stays
            // open.
            if (!movementOnly && execution.boundary === null) {
              await executeAuthoritativeCombatIntent(encounter.id, {
                type: 'end_turn',
                actorId,
                actionId: crypto.randomUUID(),
              });
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
          await onOptionSelect(action.label);
        } else {
          await onOptionSelect(action.label);
        }
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'The action could not be completed. You can end your turn.',
        );
      } finally {
        // The action may have changed the engine state under the same
        // encounter/actor/round key, so recompute instead of reusing any
        // legal-actions GET that is still in flight.
        await refreshLegalActions(true);
      }
    };

    return (
      <div className="w-full mt-3">
        {error && <p role="alert">{error}</p>}
        <ActionOptions
          options={renderedOptions}
          onOptionSelect={handleSelection}
          resetSelectionAfterCompletion={showCombatMenu}
          delay={hasDynamicOverlay || showCombatMenu ? 0 : 10000}
        />
      </div>
    );
  },
);
