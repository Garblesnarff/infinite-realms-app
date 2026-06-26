import { Target } from 'lucide-react';
import React, { useId } from 'react';

import type { Character } from '@/types/character';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InspirationSection } from '@/features/character/components/sheet/sections/personality/InspirationSection';
import { PersonalityElementSection } from '@/features/character/components/sheet/sections/personality/PersonalityElementSection';
import { usePersonalityManager } from '@/features/character/hooks/use-personality-manager';

interface PersonalityManagerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * PersonalityManager component for managing character personality and inspiration
 */
const PersonalityManager: React.FC<PersonalityManagerProps> = ({ character, onUpdate }) => {
  const awardInspirationId = useId();
  const traitId = useId();
  const idealId = useId();
  const bondId = useId();
  const flawId = useId();

  const {
    newTrait,
    setNewTrait,
    newIdeal,
    setNewIdeal,
    newBond,
    setNewBond,
    newFlaw,
    setNewFlaw,
    inspirationNotes,
    setInspirationNotes,
    personalityTraits,
    ideals,
    bonds,
    flaws,
    hasInspiration,
    inspirationHistory,
    toggleInspiration,
    awardInspiration,
    addPersonalityElement,
    removePersonalityElement,
  } = usePersonalityManager(character, onUpdate);

  return (
    <div className="space-y-6">
      {/* Inspiration System */}
      <InspirationSection
        hasInspiration={hasInspiration}
        toggleInspiration={toggleInspiration}
        inspirationNotes={inspirationNotes}
        setInspirationNotes={setInspirationNotes}
        awardInspiration={awardInspiration}
        inspirationHistory={inspirationHistory}
        awardInspirationId={awardInspirationId}
      />

      {/* Personality Elements */}
      <Tabs defaultValue="traits" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="traits">Traits</TabsTrigger>
          <TabsTrigger value="ideals">Ideals</TabsTrigger>
          <TabsTrigger value="bonds">Bonds</TabsTrigger>
          <TabsTrigger value="flaws">Flaws</TabsTrigger>
        </TabsList>

        <TabsContent value="traits">
          <PersonalityElementSection
            type="trait"
            items={personalityTraits}
            newValue={newTrait}
            setNewValue={setNewTrait}
            placeholder="e.g., I idolize a particular hero of my faith and constantly refer to that person's deeds and example."
            textareaId={traitId}
            addPersonalityElement={addPersonalityElement}
            removePersonalityElement={removePersonalityElement}
          />
        </TabsContent>

        <TabsContent value="ideals">
          <PersonalityElementSection
            type="ideal"
            items={ideals}
            newValue={newIdeal}
            setNewValue={setNewIdeal}
            placeholder="e.g., Tradition. The ancient traditions of worship and sacrifice must be preserved and upheld."
            textareaId={idealId}
            addPersonalityElement={addPersonalityElement}
            removePersonalityElement={removePersonalityElement}
          />
        </TabsContent>

        <TabsContent value="bonds">
          <PersonalityElementSection
            type="bond"
            items={bonds}
            newValue={newBond}
            setNewValue={setNewBond}
            placeholder="e.g., I would die to recover an ancient relic of my faith that was lost long ago."
            textareaId={bondId}
            addPersonalityElement={addPersonalityElement}
            removePersonalityElement={removePersonalityElement}
          />
        </TabsContent>

        <TabsContent value="flaws">
          <PersonalityElementSection
            type="flaw"
            items={flaws}
            newValue={newFlaw}
            setNewValue={setNewFlaw}
            placeholder="e.g., I judge others harshly, and myself even more severely."
            textareaId={flawId}
            addPersonalityElement={addPersonalityElement}
            removePersonalityElement={removePersonalityElement}
          />
        </TabsContent>
      </Tabs>

      {/* Personality Integration Tips */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
            <Target className="w-5 h-5" />
            Roleplaying Tips
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-600 dark:text-blue-400">
          <div className="space-y-2">
            <p>
              <strong>Traits:</strong> Describe how your character behaves in everyday situations.
            </p>
            <p>
              <strong>Ideals:</strong> Drive your character's goals and ambitions - what they
              believe in.
            </p>
            <p>
              <strong>Bonds:</strong> Connect your character to the world - people, places, or
              things they care about.
            </p>
            <p>
              <strong>Flaws:</strong> Give your character weaknesses that can complicate their life
              in interesting ways.
            </p>
            <Separator className="my-3 bg-blue-300 dark:bg-blue-700" />
            <p>
              <em>
                Acting on these elements, especially when it creates interesting complications, is a
                great way to earn inspiration!
              </em>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PersonalityManager;
