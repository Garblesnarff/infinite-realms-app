import { Wand2, BookOpen, Clock, Zap, Star, Crown, Circle } from 'lucide-react';
import React from 'react';

import EnhancedSpellCard from './components/EnhancedSpellCard';

import type { Character, Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEnhancedSpellcasting } from '@/features/character/hooks/use-enhanced-spellcasting';

interface EnhancedSpellsTabProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * Enhanced Spells tab with advanced spellcasting features
 * Supports metamagic, pact magic, spell preparation, ritual casting
 */
const EnhancedSpellsTab: React.FC<EnhancedSpellsTabProps> = ({ character, onUpdate }): JSX.Element => {
  const {
    isLoadingSpells,
    spellAttackBonus,
    spellSaveDC,
    spellcastingAbility,
    spellSlots,
    pactSlots,
    sorceryPoints,
    hasSpellcasting,
    hasPactMagic,
    hasMetamagic,
    canCastRituals,
    knownCantrips,
    knownSpells,
    preparedSpells,
    pactMagicSpells,
    ritualSpells,
    availableMetamagic,
    consumeSpellSlot,
    restoreSpellSlot,
    consumePactSlot,
    spendSorceryPoints,
    longRest,
    shortRest,
  } = useEnhancedSpellcasting(character, onUpdate);

  const activeTabCount = 2 + (hasPactMagic ? 1 : 0) + (hasMetamagic ? 1 : 0) + (canCastRituals ? 1 : 0);

  if (isLoadingSpells) {
    return (
      <div className="text-center space-y-4">
        <Wand2 className="w-16 h-16 mx-auto text-muted-foreground animate-pulse" aria-hidden="true" />
        <h2 className="text-2xl font-bold">Loading Spells...</h2>
        <p className="text-muted-foreground">Fetching spell data from the library.</p>
      </div>
    );
  }

  if (!hasSpellcasting) {
    return (
      <div className="text-center space-y-4">
        <Wand2 className="w-16 h-16 mx-auto text-muted-foreground" aria-hidden="true" />
        <h2 className="text-2xl font-bold">No Spellcasting</h2>
        <p className="text-muted-foreground">
          This character does not have spellcasting abilities.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
      {/* Spellcasting Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">+{spellAttackBonus}</div>
            <div className="text-sm text-muted-foreground">Spell Attack Bonus</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{spellSaveDC}</div>
            <div className="text-sm text-muted-foreground">Spell Save DC</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold capitalize">
              {spellcastingAbility?.substring(0, 3)}
            </div>
            <div className="text-sm text-muted-foreground">Spellcasting Ability</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={hasPactMagic ? 'pact' : 'spells'}>
        <TabsList
          className="grid w-full"
          style={{ gridTemplateColumns: `repeat(${activeTabCount}, minmax(0, 1fr))` }}
        >
          <TabsTrigger value="spells">Spells</TabsTrigger>
          <TabsTrigger value="cantrips">Cantrips</TabsTrigger>
          {hasPactMagic && <TabsTrigger value="pact">Pact Magic</TabsTrigger>}
          {hasMetamagic && <TabsTrigger value="metamagic">Metamagic</TabsTrigger>}
          {canCastRituals && <TabsTrigger value="rituals">Rituals</TabsTrigger>}
        </TabsList>

        {/* Regular Spells Tab */}
        <TabsContent value="spells">
          <div className="space-y-4">
            {/* Spell Slots */}
            {!hasPactMagic && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Circle className="w-5 h-5 text-purple-500" aria-hidden="true" />
                    Spell Slots
                  </CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        onClick={longRest}
                        aria-label="Recover all spell slots and sorcery points"
                      >
                        Long Rest
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Recover all spell slots and sorcery points</p>
                    </TooltipContent>
                  </Tooltip>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(spellSlots).map(([level, slots]) => (
                      <div key={level} className="flex items-center gap-4">
                        <div className="w-16 text-sm font-medium">Level {level}</div>
                        <div className="flex-1">
                          <div className="flex gap-1 mb-1">
                            {Array.from({ length: slots.total }).map((_, i) => {
                              const isUsed = i < slots.used;
                              return (
                                <Tooltip key={i}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className={`w-6 h-6 rounded border-2 transition-all focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 outline-none ${
                                        isUsed
                                          ? 'bg-gray-300 border-gray-400'
                                          : 'bg-purple-500 border-purple-600'
                                      }`}
                                      onClick={() =>
                                        isUsed
                                          ? restoreSpellSlot(parseInt(level))
                                          : consumeSpellSlot(parseInt(level))
                                      }
                                      aria-label={`Level ${level} spell slot ${
                                        isUsed ? 'expended' : 'available'
                                      }`}
                                      aria-pressed={!isUsed}
                                    >
                                      <span className="sr-only">
                                        {isUsed ? 'Restore spell slot' : 'Consume spell slot'}
                                      </span>
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{isUsed ? 'Restore spell slot' : 'Consume spell slot'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {slots.total - slots.used} / {slots.total} remaining
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Prepared Spells */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-500" aria-hidden="true" />
                  {preparedSpells.length > 0 ? 'Prepared Spells' : 'Known Spells'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(preparedSpells.length > 0 ? preparedSpells : knownSpells).map((spell) => (
                    <EnhancedSpellCard
                      key={spell.id}
                      spell={spell}
                      showPreparedBadge={preparedSpells.length > 0}
                      hasPactMagic={hasPactMagic}
                      pactSlots={pactSlots}
                      spellSlots={spellSlots}
                      consumePactSlot={consumePactSlot}
                      consumeSpellSlot={consumeSpellSlot}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Cantrips Tab */}
        <TabsContent value="cantrips">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-blue-500" aria-hidden="true" />
                Cantrips
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {knownCantrips.map((cantrip) => (
                  <EnhancedSpellCard
                    key={cantrip.id}
                    spell={cantrip}
                    hasPactMagic={hasPactMagic}
                    pactSlots={pactSlots}
                    spellSlots={spellSlots}
                    consumePactSlot={consumePactSlot}
                    consumeSpellSlot={consumeSpellSlot}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pact Magic Tab */}
        {hasPactMagic && (
          <TabsContent value="pact">
            <div className="space-y-4">
              {/* Pact Slots */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-purple-500" aria-hidden="true" />
                    Pact Magic Slots
                  </CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        onClick={shortRest}
                        aria-label="Recover pact magic slots"
                      >
                        Short Rest
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Recover pact magic slots</p>
                    </TooltipContent>
                  </Tooltip>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-medium">Level {pactSlots.level} Slots</div>
                    <div className="flex-1">
                      <div className="flex gap-1 mb-1">
                        {Array.from({ length: pactSlots.maximum }).map((_, i) => {
                          const isExpended = i >= pactSlots.current;
                          return (
                            <Tooltip key={i}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className={`w-8 h-8 rounded border-2 transition-all focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 outline-none ${
                                    isExpended
                                      ? 'bg-gray-300 border-gray-400'
                                      : 'bg-purple-500 border-purple-600'
                                  }`}
                                  onClick={consumePactSlot}
                                  aria-label={`Pact magic slot ${
                                    isExpended ? 'expended' : 'available'
                                  }`}
                                  aria-pressed={!isExpended}
                                >
                                  <span className="sr-only">
                                    {isExpended ? 'Expended' : 'Consume pact slot'}
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{isExpended ? 'Expended' : 'Consume pact slot'}</p>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {pactSlots.current} / {pactSlots.maximum} remaining
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pact Spells */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Crown className="w-5 h-5 text-purple-500" aria-hidden="true" />
                    Pact Magic Spells
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {pactMagicSpells.map((spell) => (
                      <EnhancedSpellCard
                        key={spell.id}
                        spell={spell}
                        hasPactMagic={hasPactMagic}
                        pactSlots={pactSlots}
                        spellSlots={spellSlots}
                        consumePactSlot={consumePactSlot}
                        consumeSpellSlot={consumeSpellSlot}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Metamagic Tab */}
        {hasMetamagic && (
          <TabsContent value="metamagic">
            <div className="space-y-4">
              {/* Sorcery Points */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-gold-500" aria-hidden="true" />
                    Sorcery Points
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <Progress
                        value={(sorceryPoints.current / sorceryPoints.maximum) * 100}
                        className="w-full h-4"
                        aria-label={`Sorcery Points: ${sorceryPoints.current} of ${sorceryPoints.maximum} remaining`}
                      />
                      <div className="text-sm text-muted-foreground mt-1">
                        {sorceryPoints.current} / {sorceryPoints.maximum} points remaining
                      </div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          onClick={longRest}
                          aria-label="Recover all spell slots and sorcery points"
                        >
                          Long Rest
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Recover all spell slots and sorcery points</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </CardContent>
              </Card>

              {/* Metamagic Options */}
              <Card>
                <CardHeader>
                  <CardTitle>Available Metamagic</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {availableMetamagic.map((option) => (
                      <div key={option.id} className="p-3 border rounded-lg">
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => spendSorceryPoints(option.sorceryPointCost)}
                                disabled={sorceryPoints.current < option.sorceryPointCost}
                                aria-label={`Use ${option.name} metamagic`}
                              >
                                Use
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Use {option.name} metamagic</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}

        {/* Ritual Casting Tab */}
        {canCastRituals && (
          <TabsContent value="rituals">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-500" aria-hidden="true" />
                  Ritual Spells
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Cast these spells as rituals (extra 10 minutes, no spell slot required)
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {ritualSpells.map((spell: Spell) => (
                    <EnhancedSpellCard
                      key={spell.id}
                      spell={spell}
                      hasPactMagic={hasPactMagic}
                      pactSlots={pactSlots}
                      spellSlots={spellSlots}
                      consumePactSlot={consumePactSlot}
                      consumeSpellSlot={consumeSpellSlot}
                      isRitualDisplay={true}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
      </div>
    </TooltipProvider>
  );
};

export default EnhancedSpellsTab;
