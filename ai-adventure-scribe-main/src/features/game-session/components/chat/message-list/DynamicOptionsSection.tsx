import React, { useMemo } from 'react';

import { useStageComposerDraft } from '../composer-draft';

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
   * A roll tray is open (#760). Option clicks must not start another action,
   * or the tray is set aside.
   */
  rollTrayOpen?: boolean;
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
    rollTrayOpen = false,
  }) => {
    const { state: combatState } = useCombat();
    const stageComposerDraft = useStageComposerDraft();
    const showCombatMenu = isLatest && combatState.isInCombat;
    const encounter = combatState.activeEncounter;
    const { actions, isPlayerTurn, isRefreshing, error, runAction } = useCombatLegalActions({
      enabled: showCombatMenu,
      onSendMessage,
      onSendText: onOptionSelect,
    });

    // A greyed Cast row is a description on the action bar, not a numbered choice (#1171).
    // The same filter feeds the click, so a later chip keeps the action it names.
    const choosableActions = useMemo(() => actions.filter((action) => !action.narrated), [actions]);
    const renderedOptions = useMemo<ActionOption[]>(() => {
      if (!showCombatMenu) return options;
      if (!isPlayerTurn) return [];
      return choosableActions.map((action, index) => ({
        id: `combat-${action.type}-${index}`,
        number: index + 1,
        text: action.label,
        fullText: action.label,
      }));
    }, [showCombatMenu, isPlayerTurn, choosableActions, options]);

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

    const handleSelection = async (option: ActionOption): Promise<void> => {
      // An open tray owns the turn. A click must not send, and must not run an engine action.
      if (rollTrayOpen) return;
      if (!showCombatMenu || !encounter?.id) {
        const text = createPlayerMessageFromOption(option);
        // Ordinary choices wait in the composer (#760). A combat chip never
        // reaches this branch. The engine runs it, or onOptionSelect sends the
        // label. That callback is MessageList's send, so a mounted composer
        // must not swallow the chip.
        if (stageComposerDraft) {
          stageComposerDraft(text);
          return;
        }
        await onOptionSelect(text);
        return;
      }
      const action = choosableActions[option.number - 1];
      if (!action) return;
      await runAction(action);
    };

    // Free-text choices fill the composer (#760). A second click has to replace
    // that text, so the first choice must not lock the row. Combat chips still
    // run at once, and they already clear the lock after each action.
    const stagesInComposer = !showCombatMenu && stageComposerDraft != null;

    return (
      <div className="w-full mt-3">
        {error && <p role="alert">{error}</p>}
        <ActionOptions
          options={renderedOptions}
          disabled={!isLatest || rollTrayOpen}
          onOptionSelect={handleSelection}
          resetSelectionAfterCompletion={showCombatMenu || stagesInComposer}
          instructions={
            stagesInComposer
              ? 'Choose an option to put it in the message box. Send it when you are ready.'
              : undefined
          }
          delay={hasDynamicOverlay || showCombatMenu || showImmediately ? 0 : 10000}
          isLoading={isRefreshing}
        />
      </div>
    );
  },
);
