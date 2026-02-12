import { Search, Grid, List, Eye, Check, Users, Zap } from 'lucide-react';
import React, { useState, useMemo } from 'react';

import {
  RaceCardListView,
  RaceCardCompactView,
  RaceCardGridView,
} from './race-selection/RaceCard';
import { buildRaceCategories, filterRaces } from './race-selection/raceFilters';
import { HalfElfAbilityChoice } from '../modals/HalfElfAbilityChoice';
import { VariantHumanChoice } from '../modals/VariantHumanChoice';

import type { CharacterRace, Subrace } from '@/types/character';
import type { AbilityScoreName } from '@/utils/racialAbilityBonuses';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Z_INDEX } from '@/constants/z-index';
import { useCharacter } from '@/contexts/CharacterContext';
import { baseRaces } from '@/data/raceOptions';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import logger from '@/lib/logger';

const RaceSelection: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const { scrollToNavigation } = useAutoScroll();
  const [selectedBaseRace, setSelectedBaseRace] = useState<CharacterRace | null>(null);
  const [showSubraces, setShowSubraces] = useState(false);

  // New state for UX improvements
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('compact');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [comparisonRaces, setComparisonRaces] = useState<CharacterRace[]>([]);

  // Half-Elf ability choice modal state
  const [showHalfElfModal, setShowHalfElfModal] = useState(false);

  // Variant Human ability + feat choice modal state
  const [showVariantHumanModal, setShowVariantHumanModal] = useState(false);

  // Race categories for filtering (using extracted utility)
  const raceCategories = useMemo(() => buildRaceCategories(baseRaces), []);

  // Filter and search logic (using extracted utility)
  const filteredRaces = useMemo(
    () => filterRaces(baseRaces, searchQuery, selectedCategory),
    [searchQuery, selectedCategory]
  );

  // Helper functions
  const toggleFavorite = (raceId: string) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(raceId)) {
      newFavorites.delete(raceId);
    } else {
      newFavorites.add(raceId);
    }
    setFavorites(newFavorites);
  };

  const addToComparison = (race: CharacterRace) => {
    if (comparisonRaces.length < 3 && !comparisonRaces.find((r) => r.id === race.id)) {
      setComparisonRaces([...comparisonRaces, race]);
    }
  };

  const removeFromComparison = (raceId: string) => {
    setComparisonRaces(comparisonRaces.filter((r) => r.id !== raceId));
  };

  const handleBaseRaceSelect = (baseRace: CharacterRace) => {
    logger.info('Selecting base race:', baseRace);
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { race: baseRace, subrace: null },
    });
    setSelectedBaseRace(baseRace);

    // Check if this is Half-Elf - requires ability choice
    if (baseRace.id === 'half-elf') {
      setShowHalfElfModal(true);
      return;
    }

    if (baseRace.subraces && baseRace.subraces.length > 0) {
      setShowSubraces(true);
      toast({
        title: 'Base Race Selected',
        description: `You have chosen ${baseRace.name}. Now select a subrace.`,
        duration: 1000,
      });
      // Do NOT auto-scroll when showing subrace selection - user stays on same page
    } else {
      toast({
        title: 'Race Selected',
        description: `You have chosen the ${baseRace.name} race.`,
        duration: 1000,
      });
      // Auto-scroll to navigation to proceed to next step
      scrollToNavigation();
    }
  };

  const handleSubraceSelect = (subrace: Subrace) => {
    logger.info('Selecting subrace:', subrace);

    // Check if this is Variant Human - requires ability + feat choice
    if (subrace.id === 'variant-human') {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { subrace },
      });
      setShowSubraces(false);
      setShowVariantHumanModal(true);
      return;
    }

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { subrace },
    });
    setShowSubraces(false);
    toast({
      title: 'Subrace Selected',
      description: `You have chosen ${subrace.name}.`,
      duration: 1000,
    });
    // Auto-scroll to navigation to proceed to next step
    scrollToNavigation();
  };

  const handleHalfElfAbilityChoice = (abilities: [AbilityScoreName, AbilityScoreName]) => {
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        racialAbilityChoices: {
          ...state.character?.racialAbilityChoices,
          halfElf: abilities,
        },
      },
    });
    toast({
      title: 'Abilities Selected',
      description: `You have chosen +1 to ${abilities[0]} and ${abilities[1]}.`,
      duration: 2000,
    });
    scrollToNavigation();
  };

  const handleVariantHumanChoice = (
    abilities: [AbilityScoreName, AbilityScoreName],
    feat: string,
  ) => {
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        racialAbilityChoices: {
          ...state.character?.racialAbilityChoices,
          variantHuman: abilities,
        },
        feats: [feat],
      },
    });

    // Format feat name for display (convert kebab-case to Title Case)
    const featName = feat
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    toast({
      title: 'Variant Human Customization Complete',
      description: `You have chosen +1 to ${abilities[0]} and ${abilities[1]}, plus the ${featName} feat.`,
      duration: 3000,
    });
    scrollToNavigation();
  };

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
            <div className="flex flex-wrap gap-2">
              {raceCategories.map((category) => (
                <Button
                  key={category.id}
                  variant={selectedCategory === category.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(category.id)}
                  className="text-xs"
                >
                  {category.name} ({category.count})
                </Button>
              ))}
            </div>

            {/* View Mode Toggles */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">View:</span>
              <div
                className="flex border rounded-md"
                role="group"
                aria-label="View mode"
              >
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
              const canAddToComparison = comparisonRaces.length < 3 || comparisonRaces.some((r) => r.id === baseRace.id);

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
              {selectedBaseRace?.subraces?.map((subrace) => {
                const isSelected = state.character?.subrace?.id === subrace.id;

                return (
                  <Card
                    key={subrace.id}
                    className={`cursor-pointer transition-all hover:shadow-lg border-2 relative overflow-hidden ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-lg'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => handleSubraceSelect(subrace)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        handleSubraceSelect(subrace);
                      }
                    }}
                    style={
                      subrace.backgroundImage
                        ? {
                            backgroundImage: `url(${subrace.backgroundImage})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }
                        : undefined
                    }
                  >
                    {subrace.backgroundImage && (
                      <div
                        className="absolute inset-0 bg-black/50"
                        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
                      />
                    )}
                    {isSelected && (
                      <div
                        className="absolute top-3 right-3"
                        style={{ zIndex: Z_INDEX.CARD_HOVER }}
                      >
                        <div className="bg-primary text-primary-foreground rounded-full p-1">
                          <Check className="w-4 h-4" />
                        </div>
                      </div>
                    )}

                    <CardHeader
                      className="relative"
                      style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
                    >
                      <div className="flex items-center gap-2">
                        <Users
                          className={`w-5 h-5 ${subrace.backgroundImage ? 'text-yellow-400' : 'text-primary'}`}
                        />
                        <h3
                          className={`text-2xl font-bold ${subrace.backgroundImage ? 'text-white' : ''}`}
                        >
                          {subrace.name}
                        </h3>
                      </div>
                    </CardHeader>

                    <CardContent
                      className="space-y-4 relative"
                      style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
                    >
                      <p
                        className={`${subrace.backgroundImage ? 'text-gray-200' : 'text-muted-foreground'}`}
                      >
                        {subrace.description}
                      </p>

                      {/* Ability Score Increases */}
                      {Object.keys(subrace.abilityScoreIncrease).length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Zap
                              className={`w-4 h-4 ${subrace.backgroundImage ? 'text-yellow-400' : 'text-orange-500'}`}
                            />
                            <h4
                              className={`font-semibold ${subrace.backgroundImage ? 'text-white drop-shadow' : ''}`}
                            >
                              Subrace Ability Increases
                            </h4>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(subrace.abilityScoreIncrease).map(
                              ([ability, bonus]) => (
                                <Badge
                                  key={ability}
                                  variant="secondary"
                                  className={`capitalize ${subrace.backgroundImage ? 'bg-black/60 text-white border-white/20 backdrop-blur-sm' : ''}`}
                                >
                                  {ability.substring(0, 3)} +{bonus}
                                </Badge>
                              ),
                            )}
                          </div>
                        </div>
                      )}

                      {/* Speed Override */}
                      {subrace.speed && (
                        <div>
                          <p className="text-sm">
                            <span className="font-medium">Speed:</span> {subrace.speed} feet
                          </p>
                        </div>
                      )}

                      {/* Subrace Traits */}
                      <div>
                        <h4
                          className={`font-semibold mb-2 ${subrace.backgroundImage ? 'text-white drop-shadow' : ''}`}
                        >
                          Subrace Traits
                        </h4>
                        <div className="space-y-1">
                          {subrace.traits.map((trait: string, index: number) => (
                            <div
                              key={index}
                              className={`text-sm p-2 rounded ${subrace.backgroundImage ? 'bg-white/20 text-white' : 'bg-muted/30'}`}
                            >
                              <span className="font-medium">{trait.split(':')[0]}:</span>
                              <span
                                className={`${subrace.backgroundImage ? 'text-gray-100' : 'text-muted-foreground'} ml-1`}
                              >
                                {trait.split(':')[1] || trait}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Comparison Mode */}
      {comparisonRaces.length > 0 && (
        <Card className="p-4 bg-blue-50 dark:bg-blue-950/20">
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
                  >
                    ×
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
