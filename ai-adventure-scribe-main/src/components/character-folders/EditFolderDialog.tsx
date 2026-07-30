/**
 * EditFolderDialog Component
 *
 * Provides a dialog for editing an existing character folder.
 * Extracted from CharacterFolderDialog.tsx.
 */

import React, { useState, useEffect, useId } from 'react';

import { FOLDER_COLORS } from './constants';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useTRPC, useTRPCUtils } from '@/infrastructure/api/trpc-hooks';

interface EditFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  currentName?: string;
  currentColor?: string;
}

/**
 * Edit Folder Dialog
 */
export const EditFolderDialog: React.FC<EditFolderDialogProps> = ({
  open,
  onOpenChange,
  folderId,
  currentName = '',
  currentColor = FOLDER_COLORS[0].value,
}) => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const utils = useTRPCUtils();

  const [name, setName] = useState(currentName);
  const [color, setColor] = useState(currentColor);
  const colorGroupId = useId();
  const folderNameId = useId();

  useEffect(() => {
    setName(currentName);
    setColor(currentColor);
  }, [currentName, currentColor, open]);

  const updateMutation = trpc.characterFolders.update.useMutation({
    onSuccess: () => {
      toast({
        title: 'Folder Updated',
        description: 'Folder has been updated successfully.',
      });
      utils.characterFolders.list.invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update folder. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleUpdate = () => {
    if (!folderId) return;

    if (!name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a folder name.',
        variant: 'destructive',
      });
      return;
    }

    updateMutation.mutate({
      folderId,
      updates: {
        name: name.trim(),
        color,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Folder</DialogTitle>
          <DialogDescription>Update folder name and color.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Folder Name */}
          <div className="space-y-2">
            <Label htmlFor={folderNameId}>Folder Name</Label>
            <Input
              id={folderNameId}
              placeholder="Enter folder name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !updateMutation.isPending) {
                  handleUpdate();
                }
              }}
            />
          </div>

          {/* Color Picker */}
          <div className="space-y-2">
            <Label id={colorGroupId}>Folder Color</Label>
            <TooltipProvider>
              <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby={colorGroupId}>
                {FOLDER_COLORS.map((colorOption) => (
                  <Tooltip key={colorOption.value} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`h-10 rounded-md border-2 transition-all focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:ring-offset-2 outline-none ${
                          color === colorOption.value
                            ? 'border-foreground scale-110'
                            : 'border-border hover:scale-105'
                        }`}
                        style={{ backgroundColor: colorOption.value }}
                        onClick={() => setColor(colorOption.value)}
                        aria-label={colorOption.name}
                        aria-pressed={color === colorOption.value}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{colorOption.name}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={updateMutation.isPending}
            aria-label={
              updateMutation.isPending
                ? 'Update Folder (Updating...)'
                : name.trim()
                ? `Update Folder - ${name.trim()}`
                : 'Update Folder'
            }
          >
            {updateMutation.isPending ? 'Updating...' : 'Update Folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
