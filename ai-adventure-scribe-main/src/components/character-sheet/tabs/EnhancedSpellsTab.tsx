import { Wand2, BookOpen } from 'lucide-react';
import React from 'react';

import EnhancedSpellCard from './components/EnhancedSpellCard';

import type { Character } from '@/types/character';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import MetamagicSection from '@/features/character/components/sheet/tabs/spells/MetamagicSection';
import PactMagicSection from '@/features/character/components/sheet/tabs/spells/PactMagicSection';
import RitualCastingSection from '@/features/character/components/sheet/tabs/spells/RitualCastingSection';
import SpellcastingOverview from '@/features/character/components/sheet/tabs/spells/SpellcastingOverview';
import SpellSlotsSection from '@/features/character/components/sheet/tabs/spells/SpellSlotsSection';
import { useEnhancedSpellcasting } from '@/features/character/hooks/use-enhanced-spellcasting';

interface EnhancedSpellsTabProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * Enhanced Spells tab with advanced spellcasting features
 * Supports metamagic, pact magic, spell preparation, ritual casting
 */
const EnhancedSpellsTab: React.FC<EnhancedSpellsTabProps> = ({ character, onUpdate }) => {
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
        <Wand2
          className="w-16 h-16 mx-auto text-muted-foreground animate-pulse"
          aria-hidden="true"
        />
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
        <SpellcastingOverview
          spellAttackBonus={spellAttackBonus}
          spellSaveDC={spellSaveDC}
          spellcastingAbility={spellcastingAbility}
        />

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
            {!hasPactMagic && (
              <SpellSlotsSection
                spellSlots={spellSlots}
                longRest={longRest}
                restoreSpellSlot={restoreSpellSlot}
                consumeSpellSlot={consumeSpellSlot}
              />
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
                      isRitualDisplay={true}
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
            <PactMagicSection
              pactSlots={pactSlots}
              shortRest={shortRest}
              consumePactSlot={consumePactSlot}
              pactMagicSpells={pactMagicSpells}
              hasPactMagic={hasPactMagic}
              spellSlots={spellSlots}
              consumeSpellSlot={consumeSpellSlot}
            />
          </TabsContent>
        )}

        {/* Metamagic Tab */}
        {hasMetamagic && (
          <TabsContent value="metamagic">
            <MetamagicSection
              sorceryPoints={sorceryPoints}
              longRest={longRest}
              availableMetamagic={availableMetamagic}
              spendSorceryPoints={spendSorceryPoints}
            />
          </TabsContent>
        )}

        {/* Ritual Casting Tab */}
        {canCastRituals && (
          <TabsContent value="rituals">
            <RitualCastingSection
              ritualSpells={ritualSpells}
              hasPactMagic={hasPactMagic}
              pactSlots={pactSlots}
              spellSlots={spellSlots}
              consumePactSlot={consumePactSlot}
              consumeSpellSlot={consumeSpellSlot}
            />
          </TabsContent>
        )}
      </Tabs>
      </div>
    </TooltipProvider>
  );
};

export default EnhancedSpellsTab;
