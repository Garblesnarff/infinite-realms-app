import React, { useCallback, useEffect, useMemo, useState } from 'react';

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
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';
import { userDataApi } from '@/services/user-data-api';
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
  ({ options, onOptionSelect, hasDynamicOverlay }) => {
    const { state: combatState, refreshCombatState } = useCombat();
    const [error, setError] = useState<string | null>(null);
    const encounter = combatState.activeEncounter;
    const [legalState, setLegalState] = useState<{ actorId?: string; actions: LegalAction[] }>({
      actions: [],
    });

    const refreshLegalActions = useCallback(async () => {
      if (!combatState.isInCombat || !encounter?.id) return;
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
      combatState.isInCombat,
      encounter?.id,
      encounter?.currentTurnParticipantId,
      encounter?.currentRound,
    ]);

    useEffect(() => {
      void refreshLegalActions();
    }, [refreshLegalActions]);

    const renderedOptions = useMemo<ActionOption[]>(() => {
      if (!combatState.isInCombat) return options;
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
    }, [
      combatState.isInCombat,
      legalState.actions,
      legalState.actorId,
      encounter?.participants,
      options,
    ]);

    if (!renderedOptions || renderedOptions.length === 0) {
      return null;
    }

    const handleSelection = async (option: ActionOption) => {
      if (!combatState.isInCombat || !encounter?.id) {
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
          await executeAuthoritativeCombatIntent(encounter.id, { type: 'end_turn', actorId });
          await refreshCombatState();
        } else if (
          action.type === 'move' &&
          typeof action.x === 'number' &&
          typeof action.y === 'number'
        ) {
          await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: 'move', actorId, x: action.x, y: action.y },
            'dm',
            Date.now(),
            'typed',
          );
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
          await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: action.type, actorId },
            'dm',
            Date.now(),
            'action_bar',
          );
          // No `end_turn` after it: the exit has already taken the player out of the turn order,
          // and a turn boundary for a participant who no longer has one is a second refusal.
          await refreshCombatState();
        } else if (action.type === 'dash') {
          await executeAuthoritativeCombatIntent(
            encounter.id,
            { type: 'dash', actorId },
            'dm',
            Date.now(),
            'typed',
          );
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
            })) as { currentParticipant?: { id?: string } | null } | null;
            if (encounter.sessionId) {
              await userDataApi.advanceNpcTurns(
                encounter.sessionId,
                turn?.currentParticipant?.id ?? undefined,
              );
            }
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
          resetSelectionAfterCompletion={combatState.isInCombat}
          delay={hasDynamicOverlay ? 0 : 10000}
        />
      </div>
    );
  },
);
