import React from 'react';

import { useShowTargetNumbers } from '../../../hooks/use-show-target-numbers';

import { Button } from '@/components/ui/button';

/**
 * The player's "Show target numbers" setting (#2417). On, an engine result card shows the target's
 * AC and a save's DC; off, it shows `vs AC ?` and leaves the DC out. Easy and Medium start on,
 * Hard starts off.
 */
export const TargetNumbersToggle: React.FC = () => {
  const { showTargetNumbers, setShowTargetNumbers } = useShowTargetNumbers();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={showTargetNumbers}
      onClick={() => setShowTargetNumbers(!showTargetNumbers)}
    >
      Show target numbers: {showTargetNumbers ? 'On' : 'Off'}
    </Button>
  );
};
