import { Wand2, Filter, ChevronDown, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import React, { useState, useEffect } from 'react';

import SpellcastingInfoCard from './spell-selection/SpellcastingInfoCard';
import SpellSelectionTabs from './spell-selection/SpellSelectionTabs';

import type { CharacterClass } from '@/types/character';

import SpellFilterPanel from '@/components/spells/SpellFilterPanel';
import SpellSearchBar from '@/components/spells/SpellSearchBar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useToast } from '@/hooks/use-toast';
import { useSpellSelection } from '@/hooks/useSpellSelection';
import logger from '@/lib/logger';

/**
 * Enhanced SpellSelection component for spellcasting classes during character creation
 * Features:
 * - Tabbed interface for cantrips, spells, and racial spells
 * - Advanced search and filtering capabilities
 * - Real-time validation with clear feedback
 * - Visual spell indicators and tooltips
 * - Mobile-responsive design
 * - Integration with comprehensive spell validation system
 */
const SpellSelection: React.FC = () => {
  const { toast } = useToast();
  const { scrollToNavigation } = useAutoScroll();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('cantrips');

  // Use the enhanced spell selection hook
  const {
    character,
    isSpellcaster,
    spellcastingInfo,
    availableCantrips,
    availableSpells,
    racialSpells,
    isLoadingSpells,
    spellsError,
    selectedCantrips,
    selectedSpells,
    toggleCantrip,
    toggleSpell,
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    filteredCantrips,
    filteredSpells,
    validation,
    canProceed,
    updateCharacterSpells,
    refetchSpells,
  } = useSpellSelection();

  const currentClass = character?.class as CharacterClass | undefined;

  // Get available schools for filtering
  const availableSchools = Array.from(
    new Set([...availableCantrips, ...availableSpells].map((spell) => spell.school)),
  ).sort();

  // Check if character has racial spells
  const hasRacialSpells = racialSpells.cantrips.length > 0 || racialSpells.bonusCantrips > 0;
  const totalRacialCantrips = racialSpells.cantrips.length + racialSpells.bonusCantrips;

  // Auto-save when valid selection is made
  useEffect(() => {
    logger.debug('🎯 [SpellSelection] Auto-save check:', {
      canProceed,
      validationValid: validation.valid,
      selectedCantrips: selectedCantrips,
      selectedSpells: selectedSpells,
      cantripCount: selectedCantrips.length,
      spellCount: selectedSpells.length,
    });

    if (canProceed && validation.valid) {
      logger.info('✅ [SpellSelection] Triggering updateCharacterSpells');
      updateCharacterSpells();
    }
  }, [canProceed, validation.valid, updateCharacterSpells]);

  // Show validation feedback
  useEffect(() => {
    if (validation.errors.length > 0) {
      const errorMessage = validation.errors[0].message;
      toast({
        title: 'Selection Issue',
        description: errorMessage,
        variant: 'destructive',
      });
    } else if (validation.valid && (selectedCantrips.length > 0 || selectedSpells.length > 0)) {
      toast({
        title: 'Spells Updated',
        description: 'Your spell selection has been saved.',
      });
      scrollToNavigation();
    }
  }, [validation, toast, scrollToNavigation, selectedCantrips.length, selectedSpells.length]);

  // Handle manual save
  const handleManualSave = () => {
    updateCharacterSpells();
  };

  // Show loading state
  if (isLoadingSpells) {
    return (
      <div className="text-center space-y-4">
        <Wand2 className="w-16 h-16 mx-auto text-purple-500 animate-pulse" />
        <h2 className="text-2xl font-bold">Loading Spells...</h2>
        <p className="text-muted-foreground">
          Fetching available spells for your {currentClass?.name} class.
        </p>
      </div>
    );
  }

  // Show error state
  if (spellsError) {
    return (
      <div className="text-center space-y-4">
        <AlertTriangle className="w-16 h-16 mx-auto text-red-500" />
        <h2 className="text-2xl font-bold">Failed to Load Spells</h2>
        <p className="text-muted-foreground">{spellsError}</p>
        <Button onClick={() => refetchSpells()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  // If not a spellcaster and no racial spells, don't show this step
  if (!isSpellcaster && !hasRacialSpells) {
    return (
      <div className="text-center space-y-4">
        <Wand2 className="w-16 h-16 mx-auto text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Spells to Select</h2>
        <p className="text-muted-foreground">
          Your {currentClass?.name} class is not a spellcasting class at 1st level.
        </p>
        <p className="text-sm text-muted-foreground">
          You can proceed to the next step of character creation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Choose Your Starting Spells</h2>
        <p className="text-muted-foreground">
          As a {currentClass?.name}, you begin with magical knowledge
        </p>
      </div>

      {/* Class Spellcasting Info */}
      <SpellcastingInfoCard
        currentClass={currentClass}
        spellcastingInfo={spellcastingInfo}
        totalRacialCantrips={totalRacialCantrips}
      />

      {/* Search and Filter Controls */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1">
          <SpellSearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search spells by name, description, or school..."
          />
        </div>
        <Collapsible open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="lg:w-auto w-full">
              <Filter className="w-4 h-4 mr-2" />
              Filters
              <ChevronDown
                className={`w-4 h-4 ml-2 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`}
              />
            </Button>
          </CollapsibleTrigger>

          {/* Filter Panel */}
          <CollapsibleContent>
            <SpellFilterPanel
              filters={filters}
              onChange={setFilters}
              availableSchools={availableSchools}
              isOpen={isFilterOpen}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Validation Alerts */}
      {validation.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {validation.errors.map((error, index) => (
                <p key={index}>{error.message}</p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {validation.warnings.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {validation.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {validation.valid && (selectedCantrips.length > 0 || selectedSpells.length > 0) && (
        <Alert className="border-emerald-500/30 bg-emerald-500/10">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          <AlertDescription className="text-emerald-400/90">
            Spell selection is valid and has been saved to your character.
          </AlertDescription>
        </Alert>
      )}

      {/* Enhanced Spell Selection Tabs */}
      <SpellSelectionTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        character={character}
        spellcastingInfo={spellcastingInfo}
        totalRacialCantrips={totalRacialCantrips}
        selectedCantrips={selectedCantrips}
        selectedSpells={selectedSpells}
        filteredCantrips={filteredCantrips}
        filteredSpells={filteredSpells}
        availableCantrips={availableCantrips}
        racialSpells={racialSpells}
        hasRacialSpells={hasRacialSpells}
        toggleCantrip={toggleCantrip}
        toggleSpell={toggleSpell}
      />

      {/* Manual Save Button (fallback) */}
      {!validation.valid && (selectedCantrips.length > 0 || selectedSpells.length > 0) && (
        <div className="flex justify-center">
          <Button onClick={handleManualSave} disabled={!canProceed}>
            Save Spell Selection
          </Button>
        </div>
      )}
    </div>
  );
};

export default SpellSelection;
