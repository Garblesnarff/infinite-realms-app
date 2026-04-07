import { Sparkles, Wand2, Users } from 'lucide-react';
import React from 'react';

import type { Character, Spell } from '@/types/character';
import type { getRacialSpells, getSpellcastingInfo } from '@/utils/spell-validation';

import SpellCategorySection from '@/components/spells/SpellCategorySection';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SpellSelectionTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  character: Character | null;
  spellcastingInfo: ReturnType<typeof getSpellcastingInfo> | null;
  totalRacialCantrips: number;
  selectedCantrips: string[];
  selectedSpells: string[];
  filteredCantrips: Spell[];
  filteredSpells: Spell[];
  availableCantrips: Spell[];
  racialSpells: ReturnType<typeof getRacialSpells>;
  hasRacialSpells: boolean;
  toggleCantrip: (cantripId: string) => void;
  toggleSpell: (spellId: string) => void;
}

const SpellSelectionTabs: React.FC<SpellSelectionTabsProps> = ({
  activeTab,
  onTabChange,
  character,
  spellcastingInfo,
  totalRacialCantrips,
  selectedCantrips,
  selectedSpells,
  filteredCantrips,
  filteredSpells,
  availableCantrips,
  racialSpells,
  hasRacialSpells,
  toggleCantrip,
  toggleSpell,
}) => {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-3 h-auto p-2 bg-gradient-to-r from-infinite-dark/10 via-infinite-purple/5 to-infinite-teal/10 backdrop-blur-sm border-2 border-infinite-purple/20 shadow-lg">
        <TabsTrigger
          value="cantrips"
          className={`
            flex items-center gap-3 px-6 py-4 text-sm font-semibold rounded-lg transition-all duration-300 ease-in-out
            data-[state=active]:bg-gradient-to-br data-[state=active]:from-infinite-gold/20 data-[state=active]:to-infinite-gold/10
            data-[state=active]:text-infinite-gold data-[state=active]:shadow-lg data-[state=active]:shadow-infinite-gold/25
            data-[state=active]:border-2 data-[state=active]:border-infinite-gold/30 data-[state=active]:transform data-[state=active]:scale-[1.02]
            hover:bg-infinite-purple/10 hover:text-infinite-purple hover:shadow-md hover:shadow-infinite-purple/20
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-gold/50 focus-visible:ring-offset-2
            disabled:opacity-50 disabled:pointer-events-none
          `}
        >
          <Sparkles className="w-5 h-5 transition-colors duration-200" />
          <span className="font-ui tracking-wide">Cantrips</span>
          {(spellcastingInfo?.cantripsKnown || 0) + totalRacialCantrips > 0 && (
            <Badge
              variant="secondary"
              className={`
                ml-2 px-2 py-1 text-xs font-bold bg-infinite-gold/20 text-infinite-gold border border-infinite-gold/30
                data-[state=active]:bg-infinite-gold/30 data-[state=active]:text-infinite-gold-dark
              `}
            >
              {selectedCantrips.length}/
              {(spellcastingInfo?.cantripsKnown || 0) + totalRacialCantrips}
            </Badge>
          )}
        </TabsTrigger>

        <TabsTrigger
          value="spells"
          className={`
            flex items-center gap-3 px-6 py-4 text-sm font-semibold rounded-lg transition-all duration-300 ease-in-out
            data-[state=active]:bg-gradient-to-br data-[state=active]:from-infinite-purple/20 data-[state=active]:to-infinite-purple/10
            data-[state=active]:text-infinite-purple data-[state=active]:shadow-lg data-[state=active]:shadow-infinite-purple/25
            data-[state=active]:border-2 data-[state=active]:border-infinite-purple/30 data-[state=active]:transform data-[state=active]:scale-[1.02]
            hover:bg-infinite-teal/10 hover:text-infinite-teal hover:shadow-md hover:shadow-infinite-teal/20
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple/50 focus-visible:ring-offset-2
            disabled:opacity-50 disabled:pointer-events-none
          `}
        >
          <Wand2 className="w-5 h-5 transition-colors duration-200" />
          <span className="font-ui tracking-wide">1st Level</span>
          {(spellcastingInfo?.spellsKnown || 0) > 0 && (
            <Badge
              variant="secondary"
              className={`
                ml-2 px-2 py-1 text-xs font-bold bg-infinite-purple/20 text-infinite-purple border border-infinite-purple/30
                data-[state=active]:bg-infinite-purple/30 data-[state=active]:text-infinite-purple-dark
              `}
            >
              {selectedSpells.length}/{spellcastingInfo?.spellsKnown}
            </Badge>
          )}
        </TabsTrigger>

        <TabsTrigger
          value="racial"
          className={`
            flex items-center gap-3 px-6 py-4 text-sm font-semibold rounded-lg transition-all duration-300 ease-in-out
            data-[state=active]:bg-gradient-to-br data-[state=active]:from-infinite-teal/20 data-[state=active]:to-infinite-teal/10
            data-[state=active]:text-infinite-teal data-[state=active]:shadow-lg data-[state=active]:shadow-infinite-teal/25
            data-[state=active]:border-2 data-[state=active]:border-infinite-teal/30 data-[state=active]:transform data-[state=active]:scale-[1.02]
            hover:bg-accent/10 hover:text-accent hover:shadow-md hover:shadow-accent/20
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-teal/50 focus-visible:ring-offset-2
            disabled:opacity-50 disabled:pointer-events-none
          `}
        >
          <Users className="w-5 h-5 transition-colors duration-200" />
          <span className="font-ui tracking-wide">Racial</span>
          {hasRacialSpells && (
            <Badge
              variant="secondary"
              className={`
                ml-2 px-2 py-1 text-xs font-bold bg-infinite-teal/20 text-infinite-teal border border-infinite-teal/30
                data-[state=active]:bg-infinite-teal/30 data-[state=active]:text-infinite-teal-dark
              `}
            >
              {racialSpells.cantrips.length + racialSpells.bonusCantrips}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      {/* Cantrips Tab */}
      <TabsContent value="cantrips" className="space-y-4">
        {(spellcastingInfo?.cantripsKnown || 0) > 0 ? (
          <SpellCategorySection
            title="Class Cantrips"
            description="Minor spells you can cast at will, without expending spell slots."
            spells={filteredCantrips}
            selectedSpells={selectedCantrips}
            maxSpells={spellcastingInfo?.cantripsKnown || 0}
            onToggleSpell={toggleCantrip}
            icon="cantrip"
            colorTheme="gold"
            info={
              spellcastingInfo?.hasSpellbook
                ? 'As a Wizard, you also learn these cantrips in addition to your spellbook spells.'
                : undefined
            }
          />
        ) : hasRacialSpells ? (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
            <p>Your class doesn't learn cantrips at 1st level.</p>
            <p className="text-sm">Check the Racial tab for any racial cantrips.</p>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
            <p>No cantrips available.</p>
          </div>
        )}
      </TabsContent>

      {/* 1st Level Spells Tab */}
      <TabsContent value="spells" className="space-y-4">
        {(() => {
          const spellsKnown = spellcastingInfo?.spellsKnown || 0;
          return spellsKnown > 0 ? (
            <SpellCategorySection
              title="1st Level Spells"
              description={
                spellcastingInfo?.hasSpellbook
                  ? 'These spells will be recorded in your spellbook. You can prepare some each day.'
                  : 'These are the spells you know and can cast using spell slots.'
              }
              spells={filteredSpells}
              selectedSpells={selectedSpells}
              maxSpells={spellcastingInfo?.spellsKnown || 0}
              onToggleSpell={toggleSpell}
              icon="spell"
              colorTheme="purple"
              info={
                spellcastingInfo?.hasSpellbook
                  ? 'As a Wizard, you can prepare spells equal to your Intelligence modifier + 1 (minimum 1) each day.'
                  : undefined
              }
            />
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Wand2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p>Your class doesn't learn 1st level spells at character creation.</p>
              <p className="text-sm">You may gain spellcasting abilities at higher levels.</p>
            </div>
          );
        })()}
      </TabsContent>

      {/* Racial Spells Tab */}
      <TabsContent value="racial" className="space-y-4">
        {hasRacialSpells ? (
          <>
            {/* Racial Cantrips */}
            {racialSpells.cantrips.length > 0 && (
              <SpellCategorySection
                title="Racial Cantrips"
                description={`Cantrips granted by your ${character?.subrace?.name || character?.race?.name} heritage.`}
                spells={availableCantrips.filter((cantrip) =>
                  racialSpells.cantrips.includes(cantrip.id),
                )}
                selectedSpells={selectedCantrips}
                maxSpells={racialSpells.cantrips.length}
                onToggleSpell={toggleCantrip}
                icon="racial"
                showProgress={false}
                colorTheme="teal"
                info="These cantrips are automatically known and don't count against your class cantrip limit."
              />
            )}

            {/* Bonus Cantrip Selection */}
            {racialSpells.bonusCantrips > 0 && (
              <SpellCategorySection
                title="Bonus Cantrip"
                description={`Choose ${racialSpells.bonusCantrips} additional cantrip from the ${racialSpells.bonusCantripSource} spell list.`}
                spells={
                  racialSpells.bonusCantripSource === 'wizard'
                    ? filteredCantrips
                    : availableCantrips.filter(
                        (cantrip) =>
                          racialSpells.bonusCantripSource &&
                          cantrip.id.includes(racialSpells.bonusCantripSource),
                      )
                }
                selectedSpells={selectedCantrips}
                maxSpells={racialSpells.bonusCantrips}
                onToggleSpell={toggleCantrip}
                icon="racial"
                colorTheme="teal"
                info={`This bonus cantrip is granted by your ${character?.subrace?.name || character?.race?.name} heritage.`}
              />
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
            <p>Your race doesn't grant any spells at 1st level.</p>
            <p className="text-sm">Some races gain magical abilities at higher levels.</p>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};

export default SpellSelectionTabs;
