import React from 'react';

import type { ChatMessage } from '@/types/game';

import { ActionOptions } from '@/components/game/ActionOptions';
import { useCombat } from '@/contexts/CombatContext';
import { useCombatLegalActions } from '@/features/game-session/hooks/use-combat-legal-actions';

/**
 * #90: the legal-action pipeline lost its chat-message menu (DynamicOptionsSection's combat
 * branch); the ActionBar drives it now. The pipeline tests pick an action by its engine label,
 * so this harness lists the hook's legal actions through the same ActionOptions the old menu
 * used, and every pick goes to the hook's `runAction` — the function the ActionBar calls.
 * The bar's own button → action mapping is covered in CombatActionBar(.Live).test.tsx.
 */
export function CombatLegalActionsHarness({
  onSendMessage,
  onSendText,
}: {
  onSendMessage?: (message: ChatMessage) => Promise<void>;
  onSendText: (text: string) => Promise<void>;
}): React.JSX.Element {
  const { state } = useCombat();
  const { actions, isPlayerTurn, isRefreshing, error, runAction } = useCombatLegalActions({
    enabled: state.isInCombat,
    onSendMessage,
    onSendText,
  });
  const options = isPlayerTurn
    ? actions.map((action, index) => ({
        id: `combat-${action.type}-${index}`,
        number: index + 1,
        text: action.label,
        fullText: action.label,
      }))
    : [];
  return (
    <div className="w-full mt-3">
      {error && <p role="alert">{error}</p>}
      <ActionOptions
        options={options}
        onOptionSelect={async (option) => {
          const action = actions[option.number - 1];
          if (action) await runAction(action);
        }}
        resetSelectionAfterCompletion
        delay={0}
        isLoading={isRefreshing}
      />
    </div>
  );
}
