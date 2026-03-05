import { Wand2, BookOpen, Clock, Zap, Star, Crown, Circle } from 'lucide-react';
import React from 'react';

import type { Character, Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DiceRoller from '@/components/ui/dice-roller';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

  if (isLoadingSpells) {
    return (
      <div className="text-center space-y-4">
        <Wand2 className="w-16 h-16 mx-auto text-muted-foreground animate-pulse" />
        <h2 className="text-2xl font-bold">Loading Spells...</h2>
        <p className="text-muted-foreground">Fetching spell data from the library.</p>
      </div>
    );
  }

  if (!hasSpellcasting) {
    return (
      <div className="text-center space-y-4">
        <Wand2 className="w-16 h-16 mx-auto text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Spellcasting</h2>
        <p className="text-muted-foreground">
          This character does not have spellcasting abilities.
        </p>
      </div>
    );
  }

  const getSpellCard = (spell: Spell | undefined, showPreparedBadge = false) => {
    if (!spell) return null;

    return (
      <div key={spell?.id} className="p-3 border rounded-lg">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{spell?.name}</span>
              <Badge variant="outline" className="text-xs">
                Level {spell?.level}
              </Badge>
              {spell?.ritual && (
                <Badge variant="secondary" className="text-xs">
                  Ritual
                </Badge>
              )}
              {spell?.concentration && (
                <Badge variant="secondary" className="text-xs">
                  Concentration
                </Badge>
              )}
              {showPreparedBadge && (
                <Badge variant="default" className="text-xs">
                  Prepared
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {spell?.school} • {spell?.castingTime} • {spell?.range}
            </p>
            <p className="text-sm">{spell?.description}</p>
          </div>
          <div className="flex flex-col gap-2">
            {spell?.damage && <DiceRoller dice={spell.damage} label="Damage" />}
            {spell?.level > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => (hasPactMagic ? consumePactSlot() : consumeSpellSlot(spell.level))}
                disabled={
                  hasPactMagic
                    ? pactSlots.current === 0
                    : !spellSlots[spell.level] ||
                      spellSlots[spell.level].used >= spellSlots[spell.level].total
                }
              >
                Cast
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
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
        <TabsList className="grid w-full grid-cols-5">
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
                    <Circle className="w-5 h-5 text-purple-500" />
                    Spell Slots
                  </CardTitle>
                  <Button size="sm" onClick={longRest}>
                    Long Rest
                  </Button>
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
                                <button
                                  key={i}
                                  className={`w-6 h-6 rounded border-2 ${
                                    isUsed
                                      ? 'bg-gray-300 border-gray-400'
                                      : 'bg-purple-500 border-purple-600'
                                  }`}
                                  onClick={() =>
                                    isUsed
                                      ? restoreSpellSlot(parseInt(level))
                                      : consumeSpellSlot(parseInt(level))
                                  }
                                  aria-label={`Level ${level} spell slot ${isUsed ? 'expended' : 'available'}`}
                                  title={isUsed ? 'Restore spell slot' : 'Consume spell slot'}
                                  aria-pressed={!isUsed}
                                />
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
                  <BookOpen className="w-5 h-5 text-blue-500" />
                  {preparedSpells.length > 0 ? 'Prepared Spells' : 'Known Spells'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(preparedSpells.length > 0 ? preparedSpells : knownSpells).map((spell) =>
                    getSpellCard(spell, preparedSpells.length > 0),
                  )}
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
                <Wand2 className="w-5 h-5 text-blue-500" />
                Cantrips
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {knownCantrips.map((cantrip) => getSpellCard(cantrip))}
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
                    <Zap className="w-5 h-5 text-purple-500" />
                    Pact Magic Slots
                  </CardTitle>
                  <Button size="sm" onClick={shortRest}>
                    Short Rest
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-medium">Level {pactSlots.level} Slots</div>
                    <div className="flex-1">
                      <div className="flex gap-1 mb-1">
                        {Array.from({ length: pactSlots.maximum }).map((_, i) => {
                          const isExpended = i >= pactSlots.current;
                          return (
                            <button
                              key={i}
                              className={`w-8 h-8 rounded border-2 ${
                                isExpended
                                  ? 'bg-gray-300 border-gray-400'
                                  : 'bg-purple-500 border-purple-600'
                              }`}
                              onClick={consumePactSlot}
                              aria-label={`Pact magic slot ${isExpended ? 'expended' : 'available'}`}
                              title={isExpended ? 'Expended' : 'Consume pact slot'}
                              aria-pressed={!isExpended}
                            />
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
                    <Crown className="w-5 h-5 text-purple-500" />
                    Pact Magic Spells
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {pactMagicSpells.map((spell) => getSpellCard(spell))}
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
                    <Star className="w-5 h-5 text-gold-500" />
                    Sorcery Points
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <Progress
                        value={(sorceryPoints.current / sorceryPoints.maximum) * 100}
                        className="w-full h-4"
                      />
                      <div className="text-sm text-muted-foreground mt-1">
                        {sorceryPoints.current} / {sorceryPoints.maximum} points remaining
                      </div>
                    </div>
                    <Button size="sm" onClick={longRest}>
                      Long Rest
                    </Button>
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => spendSorceryPoints(option.sorceryPointCost)}
                            disabled={sorceryPoints.current < option.sorceryPointCost}
                          >
                            Use
                          </Button>
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
                  <Clock className="w-5 h-5 text-indigo-500" />
                  Ritual Spells
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Cast these spells as rituals (extra 10 minutes, no spell slot required)
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {ritualSpells.map((spell: Spell) => (
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
                        <Button size="sm" variant="outline">
                          Cast as Ritual
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default EnhancedSpellsTab;
