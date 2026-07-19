import { Plus } from 'lucide-react';
import React from 'react';

import { PlayableCharacterCard } from './character-selection/PlayableCharacterCard';
import { StarterTemplateCard } from './character-selection/StarterTemplateCard';

import { CharacterSelectionSkeleton } from '@/components/skeletons/CharacterSelectionSkeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCharacterSelection } from '@/features/campaign/hooks/use-character-selection';

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
    isCreating,
    isStarterCampaign,
    templates,
    characters,
    loadError,
    retryLoad,
    handleSelectTemplate,
    startGameWithCharacter,
    handleCreateCharacter,
    getModifier,
  } = useCharacterSelection({
    isOpen,
    onClose,
    campaignId,
    campaignName,
  });

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
          ) : loadError ? (
            <div className="text-center py-8" role="alert">
              <p className="text-muted-foreground mb-4">
                Unable to load characters. Please try again.
              </p>
              <Button onClick={retryLoad}>Retry</Button>
            </div>
          ) : isStarterCampaign && templates && templates.length > 0 ? (
            // Show starter templates
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((template) => (
                <StarterTemplateCard
                  key={template.id}
                  template={template}
                  isCreating={isCreating}
                  onSelect={handleSelectTemplate}
                  getModifier={getModifier}
                />
              ))}
            </div>
          ) : !isStarterCampaign && characters && characters.length > 0 ? (
            // Show user's characters
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {characters.map((character) => (
                <PlayableCharacterCard
                  key={character.id}
                  character={character}
                  onSelect={startGameWithCharacter}
                  getModifier={getModifier}
                />
              ))}
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
