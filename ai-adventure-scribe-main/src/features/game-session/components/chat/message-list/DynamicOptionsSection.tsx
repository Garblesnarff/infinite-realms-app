import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ChatMessage } from '@/types/game';
import type { ActionOption } from '@/utils/parseMessageOptions';

import { ActionOptions } from '@/components/game/ActionOptions';
import { useCombat } from '@/contexts/CombatContext';
import { getAuthHeaders } from '@/services/auth/TokenService';
import { advanceNpcTurnsToPlayer } from '@/services/combat/advance-npc-turns-to-player';
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
  formatNpcTurnOutcome,
  formatWakeParts,
  npcTurnOptions,
} from '@/services/combat/combat-outcome-transcript';
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';
import { createPlayerMessageFromOption } from '@/utils/parseMessageOptions';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';
type LegalAction = {
  type: ClientCombatIntent['type'];
  label: string;
  weaponId?: string;
  targetIds?: string[];
  x?: number;
  y?: number;
};

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

    const refreshLegalActions = useCallback(async () => {
      if (!showCombatMenu || !encounter?.id) return;
      const response = await fetch(
        `${apiBase}/v1/combat/${encodeURIComponent(encounter.id)}/legal-actions`,
        {
          headers: getAuthHeaders(),
        },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { actorId?: string; actions?: LegalAction[] };
      // A dying player's only legal action is the death save, and the dying panel owns it: a
      // chip here would send the label as a typed action to a character who cannot act.
      setLegalState({
        actorId: payload.actorId,
        actions: (payload.actions ?? []).filter((action) => action.type !== 'death_save'),
      });
    }, [
      showCombatMenu,
      encounter?.id,
      encounter?.currentTurnParticipantId,
      encounter?.currentRound,
    ]);

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

    /** The creatures that follow the player's turn: run them, and put each one's result in the chat. */
    const advanceNpcsAndReport = async (currentParticipantId?: string | null): Promise<void> => {
      if (!encounter?.sessionId) return;
      const advanced = await advanceNpcTurnsToPlayer(
        encounter.sessionId,
        currentParticipantId ?? undefined,
      );
      const npcNotices = advanced.results.map((npcResult) =>
        formatNpcTurnOutcome(
          npcResult,
          roster,
          npcTurnOptions(encounter.participants, npcResult.action.target_ids?.[0]),
        ),
      );
      for (const [index, notice] of npcNotices.entries()) {
        const wake = formatWakeParts(advanced.results[index].engineResult);
        await sendEngineNotice(onSendMessage, {
          text: [...notice.lines, ...wake.map((part) => part.line)].join('\n\n'),
          cards: [...notice.cards, ...wake.map((part) => part.card)],
        });
      }
      const endLine = formatCombatEndLine(advanced.endedReason);
      if (endLine) await sendEngineNotice(onSendMessage, { text: endLine, cards: [] });
      if (advanced.capReached && advanced.transcriptLines.length) {
        await sendEngineNotice(onSendMessage, {
          text: advanced.transcriptLines.join('\n\n'),
          cards: [],
        });
      }
    };

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
          const result = await executeAuthoritativeCombatIntent(encounter.id, {
            type: 'end_turn',
            actorId,
          });
          // A death save settled at the boundary, and a stable hero waking once the fight
          // ended on them (#2518), are engine facts like any other: one row.
          const turnParts = [...formatDeathSaveParts(result, roster), ...formatWakeParts(result)];
          await sendEngineNotice(onSendMessage, {
            text: turnParts.map((part) => part.line).join('\n\n'),
            cards: turnParts.map((part) => part.card),
          });
          if ((result as { combatEnded?: boolean } | null)?.combatEnded) {
            const endLine = formatCombatEndLine(
              (result as { endedReason?: string | null } | null)?.endedReason,
            );
            if (endLine) await sendEngineNotice(onSendMessage, { text: endLine, cards: [] });
          } else {
            // The server has no auto-advance: without this the creature that is up waits for
            // the player to type something (#2641).
            await advanceNpcsAndReport(
              (result as { currentParticipant?: { id?: string } | null } | null)?.currentParticipant
                ?.id,
            );
          }
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
            const turn = (await executeAuthoritativeCombatIntent(encounter.id, {
              type: 'end_turn',
              actorId,
            })) as {
              currentParticipant?: { id?: string } | null;
              deathSaves?: unknown[];
              combatEnded?: boolean;
              endedReason?: string | null;
            } | null;
            const turnParts = [...formatDeathSaveParts(turn, roster), ...formatWakeParts(turn)];
            const turnEndLine = turn?.combatEnded ? formatCombatEndLine(turn.endedReason) : null;
            await sendEngineNotice(onSendMessage, {
              text: [
                ...turnParts.map((part) => part.line),
                ...(turnEndLine ? [turnEndLine] : []),
              ].join('\n\n'),
              cards: turnParts.map((part) => part.card),
            });
            if (!turn?.combatEnded) await advanceNpcsAndReport(turn?.currentParticipant?.id);
          }
          await refreshCombatState();
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
        await refreshLegalActions();
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
