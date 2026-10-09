import {
  User,
  Zap,
  Wand2,
  Package,
  Star,
  FileText,
  TrendingUp,
  Image as ImageIcon,
} from 'lucide-react';
import React, { useState } from 'react';

import { CharacterSheetHeader } from './CharacterSheetHeader';
// Tab Components
import ExperienceManager from './ExperienceManager';
import MulticlassManager from './MulticlassManager';
import AbilitiesTab from './tabs/AbilitiesTab';
import FeaturesTab from './tabs/FeaturesTab';
import InventoryTab from './tabs/InventoryTab';
import MainTab from './tabs/MainTab';
import NotesTab from './tabs/NotesTab';
import SpellsTab from './tabs/SpellsTab';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';

import CharacterGallery from '@/components/gallery/CharacterGallery';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CharacterSheetTabsProps {
  character: Character;
  // #2701: the sheet save path — persists the edit, then refreshes silently.
  onCharacterUpdate: CharacterSheetUpdateFn;
}

/**
 * Tabbed character sheet layout inspired by Roll20
 * Organizes character information into logical sections
 */
const CharacterSheetTabs: React.FC<CharacterSheetTabsProps> = ({
  character,
  onCharacterUpdate,
}) => {
  const [activeTab, setActiveTab] = useState('main');

  const tabs = [
    {
      id: 'main',
      label: 'Main',
      icon: User,
      description: 'Basic info, combat stats, and core character details',
    },
    {
      id: 'abilities',
      label: 'Abilities & Skills',
      icon: Zap,
      description: 'Ability scores, skills, saves, and proficiencies',
    },
    {
      id: 'advancement',
      label: 'Advancement',
      icon: TrendingUp,
      description: 'Experience, leveling, and character progression',
    },
    {
      id: 'spells',
      label: 'Spells',
      icon: Wand2,
      description: 'Spell slots, known spells, and spellcasting',
    },
    {
      id: 'inventory',
      label: 'Equipment',
      icon: Package,
      description: 'Inventory, currency, and equipment management',
    },
    {
      id: 'features',
      label: 'Features & Traits',
      icon: Star,
      description: 'Class features, racial traits, and special abilities',
    },
    {
      id: 'notes',
      label: 'Notes & Backstory',
      icon: FileText,
      description: 'Character backstory, notes, and roleplay information',
    },
    {
      id: 'gallery',
      label: 'Gallery',
      icon: ImageIcon,
      description: 'All generated images for this character',
    },
  ];

  return (
    <div className="w-full">
      {/* Character Header - Always Visible */}
      <CharacterSheetHeader character={character} />

      {/* Tab Navigation and Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList
          className="grid w-full grid-cols-4 md:grid-cols-8 h-auto p-2 bg-[linear-gradient(180deg,#111726_0%,#0e1422_100%)] backdrop-blur-sm border-2 border-white/10 shadow-lg"
          aria-label="Character sheet sections"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={`
                  flex flex-col items-center gap-2 px-3 py-4 text-xs font-semibold rounded-lg transition-all duration-300 ease-in-out
                  data-[state=active]:bg-gradient-to-br data-[state=active]:from-infinite-purple/20 data-[state=active]:to-infinite-purple/10
                  data-[state=active]:text-infinite-purple data-[state=active]:shadow-lg data-[state=active]:shadow-infinite-purple/25
                  data-[state=active]:border-2 data-[state=active]:border-infinite-purple/30 data-[state=active]:transform data-[state=active]:scale-[1.02]
                  hover:bg-infinite-gold/10 hover:text-infinite-gold hover:shadow-md hover:shadow-infinite-gold/20
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple/50 focus-visible:ring-offset-2
                  disabled:opacity-50 disabled:pointer-events-none
                `}
              >
                <Icon className="w-5 h-5 transition-colors duration-200" />
                <span className="font-ui tracking-wide text-center leading-tight">{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="mt-4">
          <TabsContent value="main" className="space-y-4">
            <MainTab
              character={character}
              onUpdate={() => {
                void onCharacterUpdate(character);
              }}
            />
          </TabsContent>

          <TabsContent value="abilities" className="space-y-4">
            <AbilitiesTab
              character={character}
              onUpdate={() => {
                void onCharacterUpdate(character);
              }}
            />
          </TabsContent>

          <TabsContent value="advancement" className="space-y-4">
            {character.classLevels && character.classLevels.length > 1 ? (
              <MulticlassManager character={character} onUpdate={onCharacterUpdate} />
            ) : (
              <ExperienceManager character={character} onUpdate={onCharacterUpdate} />
            )}
          </TabsContent>

          <TabsContent value="spells" className="space-y-4">
            <SpellsTab
              character={character}
              onUpdate={() => {
                void onCharacterUpdate(character);
              }}
            />
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
            <InventoryTab character={character} onUpdate={onCharacterUpdate} />
          </TabsContent>

          <TabsContent value="features" className="space-y-4">
            <FeaturesTab character={character} onUpdate={onCharacterUpdate} />
          </TabsContent>

          <TabsContent value="notes" className="space-y-4">
            <NotesTab character={character} onUpdate={onCharacterUpdate} />
          </TabsContent>

          <TabsContent value="gallery" className="space-y-4">
            <CharacterGallery
              characterId={character.id}
              avatarUrl={character.avatar_url}
              designSheetUrl={character.image_url}
              backgroundUrl={character.background_image}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default CharacterSheetTabs;
