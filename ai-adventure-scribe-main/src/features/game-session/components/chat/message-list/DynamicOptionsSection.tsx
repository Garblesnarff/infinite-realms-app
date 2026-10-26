import React, { useMemo } from 'react';

import type { ChatMessage } from '@/types/game';
import type { ActionOption } from '@/utils/parseMessageOptions';

import { ActionOptions } from '@/components/game/ActionOptions';
import { useCombat } from '@/contexts/CombatContext';
import { useCombatLegalActions } from '@/features/game-session/hooks/use-combat-legal-actions';
import { createPlayerMessageFromOption } from '@/utils/parseMessageOptions';

interface DynamicOptionsSectionProps {
  options: ActionOption[];
  onOptionSelect: (optionText: string) => Promise<void>;
  hasDynamicOverlay: boolean;
  onSendMessage?: (message: ChatMessage) => Promise<void>;
  /** False for a past message: it keeps its own options and never turns into the combat menu. */
  isLatest?: boolean;
  /**
   * GP-015 (#219): the DM's narration turn carried no action choices. Say why
   * instead of rendering nothing — but only on the latest message.
   */
  showNoOptionsNotice?: boolean;
  /**
   * The opening renders its choices with the scene text (#1023). Later
   * narration keeps the roleplay delay.
   */
  showImmediately?: boolean;
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
  ({
    options,
    onOptionSelect,
    hasDynamicOverlay,
    onSendMessage,
    isLatest = true,
    showNoOptionsNotice = false,
    showImmediately = false,
  }) => {
    const { state: combatState } = useCombat();
    const showCombatMenu = isLatest && combatState.isInCombat;
    const encounter = combatState.activeEncounter;
    const { actions, isPlayerTurn, isRefreshing, error, runAction } = useCombatLegalActions({
      enabled: showCombatMenu,
      onSendMessage,
      onSendText: onOptionSelect,
    });

    const renderedOptions = useMemo<ActionOption[]>(() => {
      if (!showCombatMenu) return options;
      if (!isPlayerTurn) return [];
      return actions.map((action, index) => ({
        id: `combat-${action.type}-${index}`,
        number: index + 1,
        text: action.label,
        fullText: action.label,
      }));
    }, [showCombatMenu, isPlayerTurn, actions, options]);

    if (!renderedOptions || renderedOptions.length === 0) {
      // GP-015 (#219): a narration turn with no suggested actions says why,
      // explicitly, on the latest message only — past turns stay quiet. Never
      // while the combat menu owns this slot (legal actions loading, or
      // another participant's turn): the "story is open" copy would be wrong
      // in a fight.
      if (showNoOptionsNotice && isLatest && !showCombatMenu) {
        return (
          <div
            data-testid="no-action-options-notice"
            className="mt-2 text-sm text-muted-foreground italic"
          >
            No suggested actions for this beat — the story is open, so tell the DM what you do.
          </div>
        );
      }
      return null;
    }

    const handleSelection = async (option: ActionOption) => {
      if (!showCombatMenu || !encounter?.id) {
        await onOptionSelect(createPlayerMessageFromOption(option));
        return;
      }
      const action = actions[option.number - 1];
      if (!action) return;
      await runAction(action);
    };

    return (
      <div className="w-full mt-3">
        {error && <p role="alert">{error}</p>}
        <ActionOptions
          options={renderedOptions}
          disabled={!isLatest}
          onOptionSelect={handleSelection}
          resetSelectionAfterCompletion={showCombatMenu}
          delay={hasDynamicOverlay || showCombatMenu || showImmediately ? 0 : 10000}
          isLoading={isRefreshing}
        />
      </div>
    );
  },
);
