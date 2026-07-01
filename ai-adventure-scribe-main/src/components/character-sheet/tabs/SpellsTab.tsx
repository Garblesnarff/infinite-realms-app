import React from 'react';

import type { Character } from '@/types/character';

import FeaturesSpellsTab from '@/features/character/components/sheet/tabs/SpellsTab';

interface SpellsTabProps {
  character: Character;
  onUpdate: () => void;
}

/**
 * Legacy SpellsTab (now redirecting to refactored feature component)
 */
const SpellsTab: React.FC<SpellsTabProps> = (props) => {
  return <FeaturesSpellsTab {...props} />;
};

export default SpellsTab;
