import { Search, Grid, List, Eye, X } from 'lucide-react';
import React from 'react';

import { RaceCardListView, RaceCardCompactView, RaceCardGridView } from './race-selection/RaceCard';
import { SubraceCard } from './race-selection/SubraceCard';
import { useRaceSelection } from './race-selection/use-race-selection';
import { HalfElfAbilityChoice } from '../modals/HalfElfAbilityChoice';
import { VariantHumanChoice } from '../modals/VariantHumanChoice';

import type { AbilityScoreName } from '@/utils/racialAbilityBonuses';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { baseRaces } from '@/data/raceOptions';

const RaceSelection: React.FC = () => {
  const {
    state,
    selectedBaseRace,
    setSelectedBaseRace,
    showSubraces,
    setShowSubraces,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    viewMode,
    setViewMode,
    favorites,
    comparisonRaces,
    setComparisonRaces,
    showHalfElfModal,
    setShowHalfElfModal,
    showVariantHumanModal,
    setShowVariantHumanModal,
    raceCategories,
    filteredRaces,
    toggleFavorite,
    addToComparison,
    removeFromComparison,
    handleBaseRaceSelect,
    handleSubraceSelect,
    handleHalfElfAbilityChoice,
    handleVariantHumanChoice,
  } = useRaceSelection();

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Choose Your Race</h2>
        <p className="text-muted-foreground">
          Your race determines ability score bonuses, traits, and cultural background
        </p>
      </div>

      {/* Enhanced Navigation & Controls */}
      {!showSubraces && (
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search races, traits, or descriptions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Category Filters & View Controls */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            {/* Category Filters */}
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Filter races by category"
            >
              {raceCategories.map((category) => (
                <Button
                  key={category.id}
                  variant={selectedCategory === category.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(category.id)}
                  className="text-xs"
                  aria-pressed={selectedCategory === category.id}
                >
                  {category.name} ({category.count})
                </Button>
              ))}
            </div>

            {/* View Mode Toggles */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">View:</span>
              <div className="flex border rounded-md" role="group" aria-label="View mode">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="rounded-r-none"
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                  title="Grid view"
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="rounded-none border-x"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  title="List view"
                >
                  <List className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'compact' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('compact')}
                  className="rounded-l-none"
                  aria-label="Compact view"
                  aria-pressed={viewMode === 'compact'}
                  title="Compact view"
                >
                  <Eye className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Results Summary */}
          <div className="text-sm text-muted-foreground">
            Showing {filteredRaces.length} of {baseRaces.length} races
            {searchQuery && ` for "${searchQuery}"`}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {!showSubraces ? (
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-1 lg:grid-cols-2 gap-6'
                : viewMode === 'list'
                  ? 'space-y-4'
                  : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
            }
          >
            {filteredRaces.map((baseRace) => {
              const isSelected = state.character?.race?.id === baseRace.id;
              const isFavorite = favorites.has(baseRace.id);
              const canAddToComparison =
                comparisonRaces.length < 3 || comparisonRaces.some((r) => r.id === baseRace.id);

              const cardProps = {
                race: baseRace,
                isSelected,
                isFavorite,
                onSelect: handleBaseRaceSelect,
                onToggleFavorite: toggleFavorite,
                onAddToComparison: addToComparison,
                canAddToComparison,
              };

              if (viewMode === 'list') {
                return <RaceCardListView key={baseRace.id} {...cardProps} />;
              }

              if (viewMode === 'compact') {
                return <RaceCardCompactView key={baseRace.id} {...cardProps} />;
              }

              // Default grid view
              return <RaceCardGridView key={baseRace.id} {...cardProps} />;
            })}
          </div>
        ) : (
          <>
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-2">Choose Your Subrace</h2>
              <p className="text-muted-foreground">
                Select a subrace for {selectedBaseRace?.name} to gain additional abilities
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setShowSubraces(false);
                  setSelectedBaseRace(null);
                }}
                className="mt-4"
              >
                Back to Base Races
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {selectedBaseRace?.subraces?.map((subrace) => (
                <SubraceCard
                  key={subrace.id}
                  subrace={subrace}
                  isSelected={state.character?.subrace?.id === subrace.id}
                  onSelect={handleSubraceSelect}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Comparison Mode */}
      {comparisonRaces.length > 0 && (
        <Card className="p-4 bg-blue-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Race Comparison ({comparisonRaces.length}/3)</h3>
            <Button variant="outline" size="sm" onClick={() => setComparisonRaces([])}>
              Clear All
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {comparisonRaces.map((race) => (
              <Card key={race.id} className="p-3 border-2">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm">{race.name}</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFromComparison(race.id)}
                    className="p-1 h-auto"
                    aria-label={`Remove ${race.name} from comparison`}
                    title="Remove from comparison"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(race.abilityScoreIncrease).map(([ability, bonus]) => (
                      <Badge key={ability} variant="secondary" className="text-xs">
                        {ability.substring(0, 3)} +{bonus}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{race.description}</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>Speed: {race.speed}ft</span>
                    <span>{race.languages.length} languages</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {/* Selected Race/Subrace Summary */}
      {(state.character?.race || state.character?.subrace) && (
        <Card className="p-4 bg-primary/5">
          <h3 className="font-semibold mb-2">
            Selected:{' '}
            {state.character.subrace
              ? `${state.character.subrace.name} (${state.character.race?.name})`
              : state.character.race?.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            You'll gain the racial traits and ability score bonuses shown above when you complete
            character creation.
          </p>
        </Card>
      )}

      {/* Half-Elf Ability Choice Modal */}
      <HalfElfAbilityChoice
        isOpen={showHalfElfModal}
        onClose={() => setShowHalfElfModal(false)}
        onConfirm={handleHalfElfAbilityChoice}
        currentChoices={
          state.character?.racialAbilityChoices?.halfElf as
            | [AbilityScoreName, AbilityScoreName]
            | undefined
        }
      />

      {/* Variant Human Ability + Feat Choice Modal */}
      <VariantHumanChoice
        isOpen={showVariantHumanModal}
        onClose={() => setShowVariantHumanModal(false)}
        onConfirm={handleVariantHumanChoice}
        currentChoices={{
          abilities: state.character?.racialAbilityChoices?.variantHuman as
            | [AbilityScoreName, AbilityScoreName]
            | undefined,
          feat: state.character?.feats?.[0],
        }}
      />
    </div>
  );
};

export default RaceSelection;
