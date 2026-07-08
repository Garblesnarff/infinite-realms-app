import { Sparkles, Crown, Shield } from 'lucide-react';
import React from 'react';

import { MetamagicTab } from '@/components/character-creation/steps/advanced-spellcasting/MetamagicTab';
import { PactMagicTab } from '@/components/character-creation/steps/advanced-spellcasting/PactMagicTab';
import { PreparationTab } from '@/components/character-creation/steps/advanced-spellcasting/PreparationTab';
import { RitualTab } from '@/components/character-creation/steps/advanced-spellcasting/RitualTab';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { metamagicOptions } from '@/data/spellcastingFeatures';
import { useAdvancedSpellcasting } from '@/hooks/useAdvancedSpellcasting';
import { calculateProficiencyBonus } from '@/utils/character/basic-math';

/**
 * AdvancedSpellcastingSelection component for advanced spellcasting features
 * Handles spell preparation, metamagic, ritual casting, and pact magic
 */
const AdvancedSpellcastingSelection: React.FC = () => {
  const {
    characterClass,
    level,
    spellcastingAbility,
    abilityModifier,
    preparedSpells,
    selectedMetamagic,
    pactMagicSpells,
    isLoadingSpells,
    hasSpellcasting,
    canPrepareSpells,
    usesRitualCasting,
    usesPactMagic,
    usesMetamagic,
    maxPreparedSpells,
    availableSpells,
    availableRitualSpells,
    pactProgression,
    maxPactSpells,
    sorceryPoints,
    maxMetamagicOptions,
    allSelectionsComplete,
    handleSpellPreparation,
    handleMetamagicSelection,
    handlePactSpellSelection,
    applySpellcastingFeatures,
  } = useAdvancedSpellcasting();

  if (isLoadingSpells) {
    return (
      <div className="text-center space-y-4">
        <Sparkles className="w-16 h-16 mx-auto text-muted-foreground animate-pulse" />
        <h2 className="text-2xl font-bold">Loading Spells...</h2>
        <p className="text-muted-foreground">Fetching spell data from the library.</p>
      </div>
    );
  }

  // If no advanced features are needed, show completion message
  if (
    !hasSpellcasting ||
    (!canPrepareSpells && !usesMetamagic && !usesPactMagic && !usesRitualCasting)
  ) {
    return (
      <div className="text-center space-y-4">
        <Sparkles className="w-16 h-16 mx-auto text-muted-foreground" />
        <h2 className="text-2xl font-bold">
          {!hasSpellcasting ? 'No Spellcasting' : 'No Advanced Features'}
        </h2>
        <p className="text-muted-foreground">
          {!hasSpellcasting
            ? 'Your character class does not have spellcasting abilities.'
            : 'Your character does not have advanced spellcasting features at this level.'}
        </p>
        <p className="text-sm text-green-600 font-medium">
          ✓ This step is complete - you can continue to the next step.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Advanced Spellcasting</h2>
        <p className="text-muted-foreground">
          Configure your {characterClass?.name} spellcasting features
        </p>
      </div>

      {/* Spellcasting Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-purple-500" />
            Spellcasting Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold capitalize">
                {spellcastingAbility?.substring(0, 3)}
              </div>
              <div className="text-xs text-muted-foreground">Spellcasting Ability</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold">
                +{calculateProficiencyBonus(level) + abilityModifier}
              </div>
              <div className="text-xs text-muted-foreground">Spell Attack Bonus</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold">
                {8 + calculateProficiencyBonus(level) + abilityModifier}
              </div>
              <div className="text-xs text-muted-foreground">Spell Save DC</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold">{level}</div>
              <div className="text-xs text-muted-foreground">Caster Level</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs
        defaultValue={
          canPrepareSpells
            ? 'preparation'
            : usesPactMagic
              ? 'pact'
              : usesMetamagic
                ? 'metamagic'
                : 'ritual'
        }
      >
        <TabsList className="grid w-full grid-cols-4">
          {canPrepareSpells && <TabsTrigger value="preparation">Spell Preparation</TabsTrigger>}
          {usesPactMagic && <TabsTrigger value="pact">Pact Magic</TabsTrigger>}
          {usesMetamagic && <TabsTrigger value="metamagic">Metamagic</TabsTrigger>}
          {usesRitualCasting && <TabsTrigger value="ritual">Ritual Casting</TabsTrigger>}
        </TabsList>

        {/* Spell Preparation Tab */}
        {canPrepareSpells && (
          <PreparationTab
            preparedSpells={preparedSpells}
            maxPreparedSpells={maxPreparedSpells}
            availableSpells={availableSpells}
            handleSpellPreparation={handleSpellPreparation}
          />
        )}

        {/* Pact Magic Tab */}
        {usesPactMagic && (
          <PactMagicTab
            pactMagicSpells={pactMagicSpells}
            maxPactSpells={maxPactSpells}
            availableSpells={availableSpells}
            pactProgression={pactProgression}
            handlePactSpellSelection={handlePactSpellSelection}
          />
        )}

        {/* Metamagic Tab */}
        {usesMetamagic && (
          <MetamagicTab
            selectedMetamagic={selectedMetamagic}
            maxMetamagicOptions={maxMetamagicOptions}
            sorceryPoints={sorceryPoints}
            metamagicOptions={metamagicOptions}
            handleMetamagicSelection={handleMetamagicSelection}
          />
        )}

        {/* Ritual Casting Tab */}
        {usesRitualCasting && (
          <RitualTab
            characterClassId={characterClass?.id}
            availableRitualSpells={availableRitualSpells}
          />
        )}
      </Tabs>

      {/* Completion Status and Manual Apply Button */}
      <div className="mt-6 space-y-4">
        {allSelectionsComplete && (
          <div className="text-center p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-center gap-2 text-green-700">
              <Shield className="w-5 h-5" />
              <span className="font-medium">All selections complete!</span>
            </div>
            <p className="text-sm text-green-600 mt-1">
              Your advanced spellcasting features have been configured automatically.
            </p>
          </div>
        )}

        {!allSelectionsComplete && (
          <div className="text-center">
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700">
                Complete your selections above to continue to the next step.
              </p>
            </div>
            <Button onClick={applySpellcastingFeatures} variant="outline">
              Apply Current Selections
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvancedSpellcastingSelection;
