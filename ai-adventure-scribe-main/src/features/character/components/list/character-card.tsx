import { AlertTriangle } from 'lucide-react';
import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import CampaignSelectionModal from './campaign-selection-modal';
import CharacterCardHoverContent from './CharacterCardHoverContent';

import type { Character } from '@/types/character';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';
import { useCharacterImageHotLoading } from '@/hooks/use-image-hot-loading';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * Props interface for CharacterCard component
 * Requires id and name, but allows other Character properties to be partial
 */
interface CharacterCardProps {
  character: Partial<Character> & Required<Pick<Character, 'id' | 'name'>>;
  onDelete?: () => void;
}

/**
 * CharacterCard component displays individual character information in a card format
 * Includes options to view, play, or delete the character
 * @param character - Character data to display
 */
const CharacterCardComponent = ({ character, onDelete }: CharacterCardProps): JSX.Element => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 1000);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(false);
  }, []);

  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // Use hot loading hook for background image
  const {
    imageUrl: hotLoadedImage,
    isLoading: imageLoading,
    hasImage,
    error: imageError,
  } = useCharacterImageHotLoading(character.id, character.created_at);

  /**
   * Handles character deletion confirmation
   * Shows delete dialog when user clicks delete button
   */
  const handleDeleteClick = (): void => {
    setShowDeleteDialog(true);
  };

  /**
   * Handles actual character deletion
   * Removes character from database and updates UI
   */
  const handleDelete = useCallback(async (): Promise<void> => {
    try {
      if (!user?.id) throw new Error('No authenticated user');

      await userDataApi.deleteCharacter(character.id);

      toast({
        title: 'Character Deleted',
        description: 'The character has been successfully removed.',
      });

      setShowDeleteDialog(false);

      // Call parent callback to refresh character list
      if (onDelete) {
        onDelete();
      }
    } catch (error) {
      logger.error('Error deleting character:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete character. Please try again.',
        variant: 'destructive',
      });
      setShowDeleteDialog(false);
    }
  }, [character.id, toast, onDelete, user?.id]);

  // Use hot loaded background image, fallback to default
  const resolvedBackgroundImage = useMemo(() => {
    // Priority: hot loaded image > character background image > default background
    if (hasImage && hotLoadedImage !== '/character-background-placeholder.png') {
      return hotLoadedImage;
    }

    if (character.background_image) {
      return character.background_image;
    }

    // If we don't have an image and it's loading, show placeholder
    if (imageLoading || !hasImage) {
      return hotLoadedImage; // This will be the placeholder
    }

    return new URL('/card-background.jpeg', import.meta.url).href;
  }, [hotLoadedImage, hasImage, imageLoading, character.background_image]);

  return (
    <Card
      className="character-card group relative border-2 border-border/30 shadow-md transition-all duration-500 hover:shadow-2xl hover:shadow-infinite-purple/50 hover:border-infinite-gold aspect-square w-full"
      style={{ padding: '2px' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Glow effect on hover - uses OVERLAY_EFFECT for visual effects */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
      >
        <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(168,85,247,0.4)]" />
      </div>

      {/* Hero / background area */}
      <div
        className="character-hero group flex items-end p-4 cursor-pointer h-full w-full bg-cover bg-center bg-no-repeat filter sepia-[0.1] relative overflow-hidden transition-all duration-700 ease-out group-hover:scale-[1.02] group-hover:brightness-110 rounded-sm"
        role="link"
        tabIndex={0}
        aria-label={`View details for ${character.name}`}
        onClick={() => {
          // Character access is now properly restricted by RLS, so navigation should work
          navigate(`/app/character/${character.id}`);
        }}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigate(`/app/character/${character.id}`);
          }
        }}
        style={
          resolvedBackgroundImage
            ? {
                backgroundImage: `url(${resolvedBackgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center center',
              }
            : undefined
        }
      >
        {/* Loading overlay for image generation */}
        {imageLoading && !hasImage && (
          <div className="absolute inset-0 bg-gradient-to-br from-infinite-purple/20 via-infinite-dark/40 to-infinite-purple/20 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-infinite-gold mb-2"></div>
              <div className="text-xs text-infinite-gold font-medium">
                {connectionStatus === 'connecting' && 'Connecting...'}
                {connectionStatus === 'connected' && 'Generating image...'}
                {connectionStatus === 'timeout' && retryCount > 0 && `Retrying... (${retryCount})`}
                {connectionStatus === 'error' && 'Checking for updates...'}
                {!connectionStatus && 'Generating image...'}
              </div>
              {connectionStatus === 'error' && (
                <div className="text-xs text-infinite-gold/70 mt-1">Using fallback polling</div>
              )}
            </div>
          </div>
        )}

        {/* Error state overlay */}
        {imageError && !imageLoading && !hasImage && (
          <div className="absolute inset-0 bg-gradient-to-br from-destructive/20 via-infinite-dark/40 to-destructive/20 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center">
              <div className="text-xs text-destructive font-medium mb-1">
                Image generation failed
              </div>
              <div className="text-xs text-muted-foreground">Using default background</div>
            </div>
          </div>
        )}
        {/* Overlay and popup for character details */}
        <div className="character-overlay bg-gradient-to-b from-infinite-purple/80 via-transparent to-infinite-dark/90" />
        <CharacterCardHoverContent
          character={character}
          isHovered={isHovered}
          imageLoading={imageLoading}
          onPlay={(e) => {
            e.stopPropagation();
            setShowCampaignModal(true);
          }}
          onViewDetails={(e) => {
            e.stopPropagation();
            navigate(`/app/character/${character.id}`);
          }}
          onDelete={(e) => {
            e.stopPropagation();
            handleDeleteClick();
          }}
        />
      </div>

      <CampaignSelectionModal
        isOpen={showCampaignModal}
        onClose={() => setShowCampaignModal(false)}
        characterId={character.id}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogPortal>
          <AlertDialogOverlay
            className="fixed inset-0 bg-black/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            style={{ zIndex: Z_INDEX.MODAL_BACKDROP }}
          />
          <AlertDialogContent
            className="fixed left-[50%] top-[50%] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border !bg-white rounded-lg border-infinite-purple/30 p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg text-foreground"
            style={{ zIndex: Z_INDEX.MODAL }}
          >
            <AlertDialogHeader className="flex flex-col space-y-2 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <AlertDialogTitle className="text-lg font-semibold text-foreground">
                  Delete Character
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-foreground">"{character.name}"</span>?{' '}
                <span className="text-destructive font-medium">This action cannot be undone</span>{' '}
                and will permanently remove the character from your account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2">
              <AlertDialogCancel className="bg-white hover:bg-gray-50">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Permanently Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
    </Card>
  );
};

const MemoizedCharacterCard = React.memo(CharacterCardComponent);

export { MemoizedCharacterCard };
export default CharacterCardComponent;
