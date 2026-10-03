import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ActionOption } from '@/utils/parseMessageOptions';

import { ActionOptions } from '@/components/game/ActionOptions';
import { useCombat } from '@/contexts/CombatContext';
import { getAuthHeaders } from '@/services/auth/TokenService';
import {
  executeAuthoritativeCombatIntent,
  type ClientCombatIntent,
} from '@/services/combat/combat-action-executor';
import { createPlayerMessageFromOption } from '@/utils/parseMessageOptions';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';
type LegalAction = {
  type: ClientCombatIntent['type'];
  label: string;
  weaponId?: string;
  targetIds?: string[];
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
      setLegalState({ actorId: payload.actorId, actions: payload.actions ?? [] });
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
        } else if (action.type === 'attack' && action.targetIds?.[0]) {
          const targetId = action.targetIds[0];
          const target = encounter.participants.find((participant) => participant.id === targetId);
          await onOptionSelect(
            `I ${action.label.replace(/^Attack/, 'attack')} against ${target?.name ?? targetId}.`,
          );
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
