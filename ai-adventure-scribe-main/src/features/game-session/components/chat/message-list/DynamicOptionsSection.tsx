import React from 'react';

import type { ActionOption } from '@/utils/parseMessageOptions';

import { ActionOptions } from '@/components/game/ActionOptions';
import { createPlayerMessageFromOption } from '@/utils/parseMessageOptions';

interface DynamicOptionsSectionProps {
  options: ActionOption[];
  onOptionSelect: (optionText: string) => Promise<void>;
  hasDynamicOverlay: boolean;
  /** False for a past message: its options stay as the DM offered them, disabled. */
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
 * #90: out of combat only. While an encounter is active MessageRenderer does not mount it; the
 * ActionBar above the chat box is the one place to act (useCombatLegalActions).
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the options
 * section when unrelated message list state changes.
 */
export const DynamicOptionsSection: React.FC<DynamicOptionsSectionProps> = React.memo(
  ({
    options,
    onOptionSelect,
    hasDynamicOverlay,
    isLatest = true,
    showNoOptionsNotice = false,
    showImmediately = false,
  }) => {
    if (!options || options.length === 0) {
      // GP-015 (#219): a narration turn with no suggested actions says why,
      // explicitly, on the latest message only — past turns stay quiet.
      if (showNoOptionsNotice && isLatest) {
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

    return (
      <div className="w-full mt-3">
        <ActionOptions
          options={options}
          disabled={!isLatest}
          onOptionSelect={(option) => onOptionSelect(createPlayerMessageFromOption(option))}
          delay={hasDynamicOverlay || showImmediately ? 0 : 10000}
        />
      </div>
    );
  },
);
