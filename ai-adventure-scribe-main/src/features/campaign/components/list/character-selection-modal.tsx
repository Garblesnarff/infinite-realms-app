/* eslint-disable max-lines */
import { Play, Plus, Loader2 } from 'lucide-react';
import React from 'react';

import { CharacterSelectionSkeleton } from '@/components/skeletons/CharacterSelectionSkeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Z_INDEX } from '@/constants/z-index';
import {
  useCharacterSelection,
  type Character,
  type StarterTemplate,
} from '@/features/campaign/hooks/use-character-selection';

interface CharacterSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
}

/**
 * Modal component for selecting a character to play a campaign
 * For starter campaigns: shows pre-built character templates
 * For regular campaigns: shows user's existing characters
 */
const CharacterSelectionModal: React.FC<CharacterSelectionModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  campaignName,
}) => {
  const {
    isLoading,
    isStarterCampaign,
    templates,
    characters,
    isCreating,
    handleSelectTemplate,
    startGameWithCharacter,
    handleCreateCharacter,
  } = useCharacterSelection({
    campaignId,
    campaignName,
    onClose,
    isOpen,
  });

  // Helper function to calculate ability modifier
  const getModifier = (score?: number): string => {
    if (!score) return '+0';
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  /**
   * Render a starter template card
   */
  const renderTemplateCard = (template: StarterTemplate): JSX.Element => {
    const abilityScores = template.ability_scores || {};

    return (
      <Card
        key={template.id}
        className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/40 transition-all duration-500 overflow-hidden border-2 border-border/60 hover:border-infinite-gold/90 hover:scale-[1.02] relative bg-white dark:bg-background"
      >
        {/* Glow effect on hover */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
        >
          <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(168,85,247,0.4)]" />
        </div>

        <div
          className="relative h-32 bg-cover bg-center transition-all duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
          style={{
            backgroundImage: template.portrait_url
              ? `url(${template.portrait_url})`
              : `url(${new URL('/card-background.jpeg', import.meta.url).href})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white/95 dark:from-background/60 dark:via-background/80 dark:to-background/95" />
          {template.portrait_url && (
            <div className="absolute -bottom-8 left-4" style={{ zIndex: Z_INDEX.DROPDOWN }}>
              <img
                src={template.portrait_url}
                alt={`${template.name} portrait`}
                className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70"
              />
            </div>
          )}
        </div>
        <CardContent className="p-4 pt-10 bg-white dark:bg-background">
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-lg text-foreground">{template.name}</h3>
              <p className="text-sm text-muted-foreground">
                Level {template.level} {template.race} {template.class}
              </p>
              {template.tagline && (
                <p className="text-xs text-muted-foreground italic mt-1">{template.tagline}</p>
              )}
            </div>

            {/* Ability Scores Grid */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">STR</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.strength)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">DEX</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.dexterity)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">CON</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.constitution)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">INT</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.intelligence)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">WIS</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.wisdom)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">CHA</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.charisma)}
                </span>
              </div>
            </div>

            <Button
              onClick={() => handleSelectTemplate(template)}
              className="w-full"
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Adventure
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  /**
   * Render an existing character card
   */
  const renderCharacterCard = (character: Character): JSX.Element => {
    const stats = character.character_stats;
    const backgroundImage =
      character.background_image || new URL('/card-background.jpeg', import.meta.url).href;

    return (
      <Card
        key={character.id}
        className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/40 transition-all duration-500 overflow-hidden border-2 border-border/60 hover:border-infinite-gold/90 hover:scale-[1.02] relative bg-white dark:bg-background"
      >
        {/* Glow effect on hover */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
        >
          <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(168,85,247,0.4)]" />
        </div>

        <div
          className="relative h-32 bg-cover bg-center transition-all duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white/95 dark:from-background/60 dark:via-background/80 dark:to-background/95" />
          {character.avatar_url && (
            <div className="absolute -bottom-8 left-4" style={{ zIndex: Z_INDEX.DROPDOWN }}>
              <img
                src={character.avatar_url}
                alt={`${character.name} avatar`}
                className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70"
              />
            </div>
          )}
        </div>
        <CardContent className="p-4 pt-10 bg-white dark:bg-background">
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-lg text-foreground">{character.name}</h3>
              <p className="text-sm text-muted-foreground">
                Level {character.level} {character.race} {character.class}
              </p>
            </div>

            {stats && (
              <>
                {/* HP and AC */}
                <div className="flex gap-4 text-sm bg-gray-100 dark:bg-muted p-2 rounded-md border border-gray-200 dark:border-border">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-foreground">HP:</span>
                    <span className="text-foreground">{stats.max_hit_points || '\u2014'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-foreground">AC:</span>
                    <span className="text-foreground">{stats.armor_class || '\u2014'}</span>
                  </div>
                </div>

                {/* Ability Scores Grid */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">STR</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.strength)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">DEX</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.dexterity)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">CON</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.constitution)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">INT</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.intelligence)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">WIS</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.wisdom)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">CHA</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.charisma)}
                    </span>
                  </div>
                </div>
              </>
            )}

            <Button onClick={() => startGameWithCharacter(character)} className="w-full">
              <Play className="h-4 w-4 mr-2" />
              Start Adventure
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose Your Character</DialogTitle>
          <DialogDescription>
            {isStarterCampaign
              ? `Select a pre-built character for "${campaignName}"`
              : `Select a character to play in "${campaignName}"`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {isLoading ? (
            <CharacterSelectionSkeleton />
          ) : isStarterCampaign && templates && templates.length > 0 ? (
            // Show starter templates
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map(renderTemplateCard)}
            </div>
          ) : !isStarterCampaign && characters && characters.length > 0 ? (
            // Show user's characters
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {characters.map(renderCharacterCard)}
            </div>
          ) : (
            // Empty state
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                {isStarterCampaign
                  ? 'No character templates available for this campaign.'
                  : "You don't have any characters yet."}
              </p>
              {!isStarterCampaign && (
                <Button onClick={handleCreateCharacter}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Character
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CharacterSelectionModal;
