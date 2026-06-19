/**
 * MoveCharactersDialog Component
 *
 * Provides a dialog for moving characters between folders.
 * Extracted from CharacterFolderDialog.tsx.
 */

import React, { useState, useId } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useTRPC, useTRPCUtils } from '@/infrastructure/api/trpc-hooks';

interface MoveCharactersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterIds: string[];
}

/**
 * Move Characters Dialog
 */
export const MoveCharactersDialog: React.FC<MoveCharactersDialogProps> = ({
  open,
  onOpenChange,
  characterIds,
}) => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const utils = useTRPCUtils();

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const destinationFolderSelectId = useId();

  const { data: folders } = trpc.characterFolders.list.useQuery();
  const moveMutation = trpc.characterFolders.moveCharacter.useMutation({
    onSuccess: () => {
      toast({
        title: 'Characters Moved',
        description: 'Characters have been moved successfully.',
      });
      utils.characterFolders.list.invalidate();
      utils.characters.list.invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to move characters. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleMove = async () => {
    // Move all selected characters to the folder
    for (const characterId of characterIds) {
      await moveMutation.mutateAsync({
        characterId,
        folderId: selectedFolderId,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Characters</DialogTitle>
          <DialogDescription>
            Select a destination folder for {characterIds.length} character
            {characterIds.length !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor={destinationFolderSelectId}>Destination Folder</Label>
            <Select
              value={selectedFolderId || 'none'}
              onValueChange={(value) => setSelectedFolderId(value === 'none' ? null : value)}
            >
              <SelectTrigger id={destinationFolderSelectId}>
                <SelectValue placeholder="Select a folder..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No folder (root level)</SelectItem>
                {folders?.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={moveMutation.isPending}>
            {moveMutation.isPending ? 'Moving...' : 'Move Characters'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
