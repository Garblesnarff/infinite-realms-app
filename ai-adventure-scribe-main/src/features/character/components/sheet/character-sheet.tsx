import React from 'react';
import { useParams } from 'react-router-dom';

import CharacterSheetTabs from './character-sheet-tabs';

import { CharacterSheetSkeleton } from '@/components/skeletons/CharacterSheetSkeleton';
import { IRPanel } from '@/components/ui/ir-primitives';
import { useCharacterData } from '@/hooks/use-character-data';

/**
 * CharacterSheet component displays all character information
 * Now uses the new tabbed layout for better organization and Roll20-style functionality
 * Uses useCharacterData hook for data fetching and state management
 */
const CharacterSheet: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { character, loading, refetch } = useCharacterData(id);

  // Show loading state while fetching data
  if (loading) {
    return <CharacterSheetSkeleton />;
  }

  // Early return if no character data is available
  if (!character) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <IRPanel className="p-6">
        <CharacterSheetTabs character={character} onCharacterUpdate={refetch} />
      </IRPanel>
    </div>
  );
};

export default CharacterSheet;
