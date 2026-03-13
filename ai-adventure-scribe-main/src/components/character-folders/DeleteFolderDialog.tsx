/**
 * DeleteFolderDialog Component
 *
 * Provides a confirmation dialog for deleting a character folder.
 * Extracted from CharacterFolderDialog.tsx.
 */

import React from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTRPC, useTRPCUtils } from '@/infrastructure/api/trpc-hooks';

interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  folderName?: string;
}

/**
 * Delete Folder Dialog
 */
export const DeleteFolderDialog: React.FC<DeleteFolderDialogProps> = ({
  open,
  onOpenChange,
  folderId,
  folderName = 'this folder',
}) => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const utils = useTRPCUtils();

  const deleteMutation = trpc.characterFolders.delete.useMutation({
    onSuccess: () => {
      toast({
        title: 'Folder Deleted',
        description: `Folder "${folderName}" has been deleted. Characters were moved to the parent folder.`,
      });
      utils.characterFolders.list.invalidate();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete folder. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleDelete = () => {
    if (!folderId) return;

    deleteMutation.mutate({ folderId });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Folder</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{folderName}"? Characters in this folder will be moved
            to the parent folder. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Folder'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
