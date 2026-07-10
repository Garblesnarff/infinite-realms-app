import React from 'react';

import { ActionOptions } from '@/components/game/ActionOptions';
import { createPlayerMessageFromOption } from '@/utils/parseMessageOptions';

interface DynamicOptionsSectionProps {
  options: string[];
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
    if (!options || options.length === 0) {
      return null;
    }

    return (
      <div className="w-full mt-3">
        <ActionOptions
          options={options}
          onOptionSelect={(option) => onOptionSelect(createPlayerMessageFromOption(option))}
          delay={hasDynamicOverlay ? 0 : 10000}
        />
      </div>
    );
  },
);
