import { Wand2, Circle, Book, Loader2 } from 'lucide-react';
import React from 'react';

import SpellListItem from './components/SpellListItem';
import SpellcastingOverview from './spells/SpellcastingOverview';
import SpellSlotsSection from './spells/SpellSlotsSection';
import { useSpells } from './spells/useSpells';

import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';

interface SpellsTabProps {
  character: Character;
  onUpdate: () => void;
}

/**
 * Spells tab with spell slot tracking and spell management
 */
const SpellsTab: React.FC<SpellsTabProps> = ({ character, onUpdate }) => {
  const {
    loading,
    error,
    resting,
    restError,
    spellSlots,
    spellcastingAbility,
    spellAttackBonus,
    spellSaveDC,
    cantrips,
    leveledSpells,
    longRest,
  } = useSpells(character, onUpdate);

  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="ml-2">Loading spells...</span>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500 mb-2">Failed to load spells</div>
        <div className="text-sm text-muted-foreground mb-4">{error}</div>
        <Button onClick={() => window.location.reload()} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  // Non-casters get a clear empty state — never a Spell DC, attack bonus or
  // Long Rest computed from a fallback ability as if they were real.
  if (spellcastingAbility === null) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        This class does not cast spells
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
        {/* Spellcasting Info */}
        <SpellcastingOverview
          spellAttackBonus={spellAttackBonus ?? 0}
          spellSaveDC={spellSaveDC ?? 0}
          spellcastingAbility={spellcastingAbility}
        />

        {/* Enhanced Spell Category Tabs */}
        <Tabs defaultValue="cantrips" className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto p-2 bg-gradient-to-r from-infinite-dark/10 via-infinite-purple/5 to-infinite-teal/10 backdrop-blur-sm border-2 border-infinite-purple/20 shadow-lg">
            <TabsTrigger
              value="cantrips"
              className="flex items-center gap-3 px-6 py-4 text-sm font-semibold rounded-lg transition-all duration-300 ease-in-out data-[state=active]:bg-gradient-to-br data-[state=active]:from-infinite-gold/20 data-[state=active]:to-infinite-gold/10 data-[state=active]:text-infinite-gold data-[state=active]:shadow-lg data-[state=active]:shadow-infinite-gold/25 data-[state=active]:border-2 data-[state=active]:border-infinite-gold/30 data-[state=active]:transform data-[state=active]:scale-[1.02] hover:bg-infinite-purple/10 hover:text-infinite-purple hover:shadow-md hover:shadow-infinite-purple/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-gold/50 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Wand2 className="w-5 h-5 transition-colors duration-200" aria-hidden="true" />
              <span className="font-ui tracking-wide">Cantrips</span>
              <Badge
                variant="secondary"
                className="ml-2 px-2 py-1 text-xs font-bold bg-infinite-gold/20 text-infinite-gold border border-infinite-gold/30"
              >
                {cantrips.length}
              </Badge>
            </TabsTrigger>

            <TabsTrigger
              value="spells"
              className="flex items-center gap-3 px-6 py-4 text-sm font-semibold rounded-lg transition-all duration-300 ease-in-out data-[state=active]:bg-gradient-to-br data-[state=active]:from-infinite-purple/20 data-[state=active]:to-infinite-purple/10 data-[state=active]:text-infinite-purple data-[state=active]:shadow-lg data-[state=active]:shadow-infinite-purple/25 data-[state=active]:border-2 data-[state=active]:border-infinite-purple/30 data-[state=active]:transform data-[state=active]:scale-[1.02] hover:bg-infinite-teal/10 hover:text-infinite-teal hover:shadow-md hover:shadow-infinite-teal/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple/50 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Book className="w-5 h-5 transition-colors duration-200" aria-hidden="true" />
              <span className="font-ui tracking-wide">Spells</span>
              <Badge
                variant="secondary"
                className="ml-2 px-2 py-1 text-xs font-bold bg-infinite-purple/20 text-infinite-purple border border-infinite-purple/30"
              >
                {leveledSpells.length}
              </Badge>
            </TabsTrigger>

            <TabsTrigger
              value="slots"
              className="flex items-center gap-3 px-6 py-4 text-sm font-semibold rounded-lg transition-all duration-300 ease-in-out data-[state=active]:bg-gradient-to-br data-[state=active]:from-infinite-teal/20 data-[state=active]:to-infinite-teal/10 data-[state=active]:text-infinite-teal data-[state=active]:shadow-lg data-[state=active]:shadow-infinite-teal/25 data-[state=active]:border-2 data-[state=active]:border-infinite-teal/30 data-[state=active]:transform data-[state=active]:scale-[1.02] hover:bg-accent/10 hover:text-accent hover:shadow-md hover:shadow-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-teal/50 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Circle className="w-5 h-5 transition-colors duration-200" aria-hidden="true" />
              <span className="font-ui tracking-wide">Spell Slots</span>
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="cantrips" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wand2 className="w-5 h-5 text-blue-500" aria-hidden="true" />
                    Cantrips
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {cantrips.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">
                        No cantrips learned yet
                      </div>
                    ) : (
                      cantrips.map((spell) => (
                        <SpellListItem key={spell.id} spell={spell} isCantrip />
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="spells" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Book className="w-5 h-5 text-green-500" aria-hidden="true" />
                    Spells
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {leveledSpells.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">
                        No spells learned yet
                      </div>
                    ) : (
                      leveledSpells.map((spell) => <SpellListItem key={spell.id} spell={spell} />)
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="slots" className="space-y-4">
              <SpellSlotsSection
                spellSlots={spellSlots}
                longRest={longRest}
                resting={resting}
                restError={restError}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </TooltipProvider>
  );
};

export default SpellsTab;
