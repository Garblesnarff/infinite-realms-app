import { Heart, Shield, Sword, Trash2 } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

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
import { IRPanel, IRThumb } from '@/components/ui/ir-primitives';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { calculateProficiencyBonus } from '@/utils/character/basic-math';
import {
  getCharacterSheetArmorClass,
  MISSING_ARMOR_CLASS_LABEL,
} from '@/utils/character/character-sheet-armor-class';
import {
  formatCharacterSheetHitPoints,
  getCharacterSheetHitPoints,
} from '@/utils/character/character-sheet-hit-points';

interface CharacterSheetHeaderProps {
  character: Character;
}

export const CharacterSheetHeader: React.FC<CharacterSheetHeaderProps> = ({ character }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const portraitUrl = character.image_url ?? character.avatar_url;
  const hitPoints = getCharacterSheetHitPoints(character);

  // #311: the sheet is the one place a character is always reachable at its
  // own URL, so it gets its own Delete — a Play-created copy that never
  // appears on a list is otherwise undeletable. Same confirm pattern as the
  // roster card; fallen characters never reach this header (#2517 renders the
  // end state instead).
  const handleDelete = async (): Promise<void> => {
    // The sheet always loads by :id, but the type leaves it optional.
    if (!character.id) return;
    try {
      await userDataApi.deleteCharacter(character.id);
      toast({
        title: 'Character Deleted',
        description: 'The character has been successfully removed.',
      });
      setShowDeleteDialog(false);
      navigate('/app/characters');
    } catch (error) {
      logger.error('Error deleting character from sheet:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete character. Please try again.',
        variant: 'destructive',
      });
      setShowDeleteDialog(false);
    }
  };

  return (
    <IRPanel className="mb-6 p-4">
      <div className="flex items-center gap-4">
        {/* Character Portrait/Avatar */}
        <div className="flex-shrink-0">
          {portraitUrl ? (
            <IRThumb
              src={portraitUrl}
              alt={`${character.name || 'Character'} avatar`}
              size={64}
              className="rounded-full"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-full bg-infinite-gold text-infinite-dark flex items-center justify-center text-xl font-bold ir-display"
              aria-hidden="true"
            >
              {character.name?.charAt(0).toUpperCase() || '?'}
            </div>
          )}
        </div>

        {/* Character Title */}
        <div className="flex-1">
          <h1 className="ir-display text-2xl font-semibold text-foreground">
            {character.name || 'Unnamed Character'}
          </h1>
          <p className="text-muted-foreground">
            Level {character.level || 1} {character.race?.name || 'Unknown Race'}{' '}
            {character.class?.name || 'Unknown Class'}
          </p>
        </div>

        {/* Quick Stats */}
        <div className="hidden md:flex items-center gap-4 text-sm">
          <div className="text-center">
            <div className="flex items-center gap-1 text-red-600">
              <Heart className="w-4 h-4" />
              <span className="font-bold">{formatCharacterSheetHitPoints(hitPoints)}</span>
            </div>
            <div className="text-xs text-muted-foreground">HP</div>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 text-infinite-teal">
              <Shield className="w-4 h-4" />
              <span className="font-bold">
                {getCharacterSheetArmorClass(character) ?? MISSING_ARMOR_CLASS_LABEL}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">AC</div>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 text-emerald-500">
              <Sword className="w-4 h-4" />
              <span className="font-bold">+{calculateProficiencyBonus(character.level || 1)}</span>
            </div>
            <div className="text-xs text-muted-foreground">PROF</div>
          </div>
        </div>

        {/* #311: sheet-level Delete — always visible and focusable (no hover
            needed, so it works on touch per MB-008), with the confirm dialog. */}
        {character.id && (
          <button
            type="button"
            data-testid="character-sheet-delete"
            aria-label={`Delete ${character.name || 'Unnamed Character'}`}
            title="Delete character"
            onClick={() => setShowDeleteDialog(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/80 backdrop-blur-sm transition hover:bg-destructive hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogPortal>
          <AlertDialogOverlay className="fixed inset-0 bg-black/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <AlertDialogContent className="fixed left-[50%] top-[50%] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-card rounded-lg border-infinite-purple/30 p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg text-foreground">
            <AlertDialogHeader className="flex flex-col space-y-2 text-center">
              <AlertDialogTitle className="text-lg font-semibold text-foreground">
                Delete Character
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-foreground">
                  "{character.name || 'Unnamed Character'}"
                </span>?{' '}
                <span className="text-destructive font-medium">This action cannot be undone</span>{' '}
                and will permanently remove the character from your account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleDelete()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Permanently Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
    </IRPanel>
  );
};
