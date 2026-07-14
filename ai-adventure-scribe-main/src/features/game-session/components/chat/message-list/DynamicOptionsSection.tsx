import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ActionOptions } from '@/components/game/ActionOptions';
import { createPlayerMessageFromOption } from '@/utils/parseMessageOptions';
import type { ActionOption } from '@/utils/parseMessageOptions';

import { useCombat } from '@/contexts/CombatContext';
import { executeAuthoritativeCombatIntent, type ClientCombatIntent } from '@/services/combat/combat-action-executor';

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
    const { state: combatState } = useCombat();
    const encounter = combatState.activeEncounter;
    const [legalState, setLegalState] = useState<{ actorId?: string; actions: LegalAction[] }>({ actions: [] });

    const refreshLegalActions = useCallback(async () => {
      if (!combatState.isInCombat || !encounter?.id) return;
      const token = window.localStorage.getItem('workos_access_token');
      const response = await fetch(`${apiBase}/v1/combat/${encodeURIComponent(encounter.id)}/legal-actions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const payload = await response.json() as { actorId?: string; actions?: LegalAction[] };
      setLegalState({ actorId: payload.actorId, actions: payload.actions ?? [] });
    }, [combatState.isInCombat, encounter?.id]);

    useEffect(() => { void refreshLegalActions(); }, [refreshLegalActions]);

    const renderedOptions = useMemo<ActionOption[]>(() => {
      if (!combatState.isInCombat) return options;
      return legalState.actions.map((action, index) => ({
        id: `combat-${action.type}-${index}`,
        number: index + 1,
        text: action.label,
        fullText: action.label,
      }));
    }, [combatState.isInCombat, legalState.actions, options]);

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
      if (!action || !actorId) return;
      if (action.type === 'attack' && action.targetIds?.[0]) {
        await executeAuthoritativeCombatIntent(encounter.id, {
          type: 'attack', actorId, targetId: action.targetIds[0], weaponId: action.weaponId,
        });
      } else if (action.type === 'dash' || action.type === 'dodge' || action.type === 'disengage' || action.type === 'end_turn') {
        await executeAuthoritativeCombatIntent(encounter.id, { type: action.type, actorId });
      } else {
        await onOptionSelect(action.label);
      }
      await refreshLegalActions();
    };

    return (
      <div className="w-full mt-3">
        <ActionOptions
          options={renderedOptions}
          onOptionSelect={(option) => void handleSelection(option)}
          delay={hasDynamicOverlay ? 0 : 10000}
        />
      </div>
    );
  },
);
