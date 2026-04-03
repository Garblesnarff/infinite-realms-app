import { Sparkles, BookOpen, Clock, Zap, Star, Scroll, Crown, Shield } from 'lucide-react';
import React from 'react';

import type { Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { metamagicOptions } from '@/data/spellcastingFeatures';
import { useAdvancedSpellcasting } from '@/hooks/useAdvancedSpellcasting';

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

  const getSpellCard = (
    spell: Spell,
    isSelected: boolean,
    onSelectionChange: (id: string, checked: boolean) => void,
    disabled: boolean = false,
  ): React.ReactNode => (
    <div
      key={spell.id}
      className={`p-3 border rounded-lg cursor-pointer transition-all ${
        isSelected ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={() => !disabled && onSelectionChange(spell.id, !isSelected)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium">{spell.name}</span>
            <Badge variant="outline" className="text-xs">
              Level {spell.level}
            </Badge>
            {spell.ritual && (
              <Badge variant="secondary" className="text-xs">
                Ritual
              </Badge>
            )}
            {spell.concentration && (
              <Badge variant="secondary" className="text-xs">
                Concentration
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {spell.school} • {spell.castingTime} • {spell.range}
          </p>
          <p className="text-sm">{spell.description}</p>
        </div>
        <Checkbox
          checked={isSelected}
          disabled={disabled}
          onCheckedChange={(checked) => onSelectionChange(spell.id, checked === true)}
        />
      </div>
    </div>
  );

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
                +{Math.floor((level - 1) / 4) + 2 + abilityModifier}
              </div>
              <div className="text-xs text-muted-foreground">Spell Attack Bonus</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-2xl font-bold">
                {8 + Math.floor((level - 1) / 4) + 2 + abilityModifier}
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
          <TabsContent value="preparation">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-500" />
                  Spell Preparation
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Choose {maxPreparedSpells} spells to prepare. You can change your prepared spells
                  after a long rest.
                </p>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Spells Prepared</span>
                    <Badge variant="outline">
                      {preparedSpells.length} / {maxPreparedSpells}
                    </Badge>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2 mt-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${(preparedSpells.length / maxPreparedSpells) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {availableSpells.map((spell) =>
                    getSpellCard(
                      spell,
                      preparedSpells.includes(spell.id),
                      handleSpellPreparation,
                      !preparedSpells.includes(spell.id) &&
                        preparedSpells.length >= maxPreparedSpells,
                    ),
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Pact Magic Tab */}
        {usesPactMagic && (
          <TabsContent value="pact">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-purple-500" />
                  Pact Magic
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Choose {maxPactSpells} spells known. Your pact magic slots recharge on short
                  rests.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="text-center p-3 border rounded">
                    <div className="text-2xl font-bold">{pactProgression?.pactSlots || 0}</div>
                    <div className="text-xs text-muted-foreground">Pact Magic Slots</div>
                  </div>
                  <div className="text-center p-3 border rounded">
                    <div className="text-2xl font-bold">{pactProgression?.pactSlotLevel || 1}</div>
                    <div className="text-xs text-muted-foreground">Slot Level</div>
                  </div>
                  <div className="text-center p-3 border rounded">
                    <div className="text-2xl font-bold">{maxPactSpells}</div>
                    <div className="text-xs text-muted-foreground">Spells Known</div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Spells Known</span>
                    <Badge variant="outline">
                      {pactMagicSpells.length} / {maxPactSpells}
                    </Badge>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2 mt-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${(pactMagicSpells.length / maxPactSpells) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {availableSpells
                    .filter((spell: Spell) => spell.level <= (pactProgression?.pactSlotLevel || 1))
                    .map((spell: Spell) =>
                      getSpellCard(
                        spell,
                        pactMagicSpells.includes(spell.id),
                        handlePactSpellSelection,
                        !pactMagicSpells.includes(spell.id) &&
                          pactMagicSpells.length >= maxPactSpells,
                      ),
                    )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Metamagic Tab */}
        {usesMetamagic && (
          <TabsContent value="metamagic">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-gold-500" />
                  Metamagic
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Choose {maxMetamagicOptions} metamagic options. You have {sorceryPoints} sorcery
                  points to fuel them.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="text-center p-3 border rounded">
                    <div className="text-2xl font-bold">{sorceryPoints}</div>
                    <div className="text-xs text-muted-foreground">Sorcery Points</div>
                  </div>
                  <div className="text-center p-3 border rounded">
                    <div className="text-2xl font-bold">{maxMetamagicOptions}</div>
                    <div className="text-xs text-muted-foreground">Options Known</div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Metamagic Options</span>
                    <Badge variant="outline">
                      {selectedMetamagic.length} / {maxMetamagicOptions}
                    </Badge>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2 mt-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{
                        width: `${(selectedMetamagic.length / maxMetamagicOptions) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {metamagicOptions.map((option) => (
                    <div
                      key={option.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-all ${
                        selectedMetamagic.includes(option.id)
                          ? 'border-primary bg-primary/5'
                          : 'border-muted hover:border-primary/50'
                      } ${
                        !selectedMetamagic.includes(option.id) &&
                        selectedMetamagic.length >= maxMetamagicOptions
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                      onClick={() =>
                        handleMetamagicSelection(option.id, !selectedMetamagic.includes(option.id))
                      }
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium">{option.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {option.sorceryPointCost} SP
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{option.description}</p>
                        </div>
                        <Checkbox
                          checked={selectedMetamagic.includes(option.id)}
                          disabled={
                            !selectedMetamagic.includes(option.id) &&
                            selectedMetamagic.length >= maxMetamagicOptions
                          }
                          onCheckedChange={(checked) =>
                            handleMetamagicSelection(option.id, checked === true)
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Ritual Casting Tab */}
        {usesRitualCasting && (
          <TabsContent value="ritual">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-500" />
                  Ritual Casting
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  You can cast spells with the ritual tag as rituals, taking an extra 10 minutes but
                  not expending a spell slot.
                </p>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <Scroll className="w-4 h-4" />
                    <span className="text-sm font-medium">Available Ritual Spells</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {characterClass?.id === 'wizard'
                      ? 'You can cast any ritual spell in your spellbook without preparing it.'
                      : 'You can cast ritual spells you have prepared without expending spell slots.'}
                  </p>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {availableRitualSpells.map((spell: Spell) => (
                    <div key={spell.id} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{spell.name}</span>
                            <Badge variant="outline" className="text-xs">
                              Level {spell.level}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              Ritual
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">
                            {spell.school} • {spell.castingTime} (+10 min as ritual) • {spell.range}
                          </p>
                          <p className="text-sm">{spell.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
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
