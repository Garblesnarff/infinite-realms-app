import { Users } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { MemoizedCharacterCard } from './character-card';
import { CharacterListHeroHeader } from './CharacterListHeroHeader';
import EmptyState from './empty-state';

import type { Character } from '@/types/character';

import { CharacterListSkeleton } from '@/components/skeletons/CharacterListSkeleton';
import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
import { useCharacterListData } from '@/features/character/hooks/use-character-list-data';

/**
 * CharacterList component displays all characters for the current user
 * Provides options to view existing characters or create new ones
 */
const CharacterList: React.FC = () => {
  const navigate = useNavigate();
  const {
    characters,
    filteredCharacters,
    loading,
    offlineMode,
    searchTerm,
    setSearchTerm,
    fetchCharacters,
  } = useCharacterListData();

  /**
   * Navigates to character creation page
   */
  const handleCreateNew = () => {
    navigate('/app/characters/create');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[image:var(--gradient-cosmic)]">
        {/* Hero Header - show during loading for consistency */}
        <CharacterListHeroHeader onCreateNew={handleCreateNew} disabled />

        <div
          className="container mx-auto px-4 py-8 -mt-10 relative"
          style={{ zIndex: Z_INDEX.DROPDOWN }}
        >
          <div className="flex justify-center items-center mb-6">
            <div className="flex items-center gap-2">
              <Users className="w-6 h-6 text-infinite-purple animate-pulse" />
              <h1 className="text-3xl font-bold text-foreground animate-pulse">Character Roster</h1>
            </div>
          </div>

          {/* Search Bar - disabled during loading */}
          <div className="mb-8">
            <div className="relative max-w-md">
              <input
                type="text"
                placeholder="Search characters by name, race, or class..."
                value=""
                disabled
                className="w-full px-4 py-3 pl-10 pr-4 rounded-xl border-2 border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-infinite-purple focus:border-transparent transition-all duration-200 opacity-50"
              />
              <Users className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
            </div>
          </div>

          {/* Skeleton Grid */}
          <CharacterListSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[image:var(--gradient-cosmic)]">
      {offlineMode && (
        <div className="bg-yellow-100 border-b border-yellow-300 text-yellow-900 text-center py-2 text-sm">
          You are currently offline. Showing the most recently cached characters.
        </div>
      )}
      {/* Hero Header */}
      <CharacterListHeroHeader onCreateNew={handleCreateNew} />

      <div
        className="container mx-auto px-4 py-8 -mt-10 relative"
        style={{ zIndex: Z_INDEX.DROPDOWN }}
      >
        <div className="flex justify-center items-center mb-6">
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-infinite-purple" />
            <h1 className="text-3xl font-bold text-foreground">Character Roster</h1>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative max-w-md">
            <label htmlFor="character-search" className="sr-only">
              Search characters
            </label>
            <input
              type="text"
              placeholder="Search characters by name, race, or class..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              id="character-search"
              aria-label="Search characters"
              className="w-full px-4 py-3 pl-10 pr-4 rounded-xl border-2 border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-infinite-purple focus:border-transparent transition-all duration-200"
            />
            <Users className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCharacters.map((character) => {
            // Type guard to ensure character has required id and name properties
            if (!character.id || !character.name) return null;

            // Now TypeScript knows these properties exist
            return (
              <MemoizedCharacterCard
                key={character.id}
                character={character as Partial<Character> & { id: string; name: string }}
                onDelete={fetchCharacters}
              />
            );
          })}
        </div>

        {filteredCharacters.length === 0 && characters.length > 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg mb-4">No characters match your search.</p>
            <Button variant="outline" onClick={() => setSearchTerm('')} className="mr-2">
              Clear Search
            </Button>
          </div>
        )}

        {characters.length === 0 && <EmptyState onCreateNew={handleCreateNew} />}
      </div>
    </div>
  );
};

export default CharacterList;
