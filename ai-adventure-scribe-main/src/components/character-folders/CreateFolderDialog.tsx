/**
 * CreateFolderDialog Component
 *
 * Provides a dialog for creating a new character folder.
 * Extracted from CharacterFolderDialog.tsx.
 */

import React, { useState, useId } from 'react';

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useTRPC, useTRPCUtils } from '@/infrastructure/api/trpc-hooks';

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolderId?: string | null;
}

/**
 * Create Folder Dialog
 */
export const CreateFolderDialog: React.FC<CreateFolderDialogProps> = ({
  open,
  onOpenChange,
  parentFolderId,
}) => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const utils = useTRPCUtils();

  const [name, setName] = useState('');
  const [color, setColor] = useState(FOLDER_COLORS[0].value);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(parentFolderId || null);

  const parentFolderSelectId = useId();
  const colorGroupId = useId();
  const folderNameId = useId();

  const { data: folders } = trpc.characterFolders.list.useQuery();
  const createMutation = trpc.characterFolders.create.useMutation({
    onSuccess: () => {
      toast({
        title: 'Folder Created',
        description: `Folder "${name}" has been created successfully.`,
      });
      utils.characterFolders.list.invalidate();
      onOpenChange(false);
      setName('');
      setColor(FOLDER_COLORS[0].value);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create folder. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleCreate = () => {
    if (!name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a folder name.',
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      color,
      parentFolderId: selectedParentId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
          <DialogDescription>Create a folder to organize your characters.</DialogDescription>
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
                if (e.key === 'Enter' && !createMutation.isPending) {
                  handleCreate();
                }
              }}
            />
          </div>

          {/* Color Picker */}
          <div className="space-y-2">
            <Label id={colorGroupId}>Folder Color</Label>
            <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby={colorGroupId}>
              {FOLDER_COLORS.map((colorOption) => (
                <button
                  key={colorOption.value}
                  type="button"
                  className={`h-10 rounded-md border-2 transition-all ${
                    color === colorOption.value
                      ? 'border-foreground scale-110'
                      : 'border-border hover:scale-105'
                  }`}
                  style={{ backgroundColor: colorOption.value }}
                  onClick={() => setColor(colorOption.value)}
                  title={colorOption.name}
                  aria-label={colorOption.name}
                  aria-pressed={color === colorOption.value}
                />
              ))}
            </div>
          </div>

          {/* Parent Folder Selector */}
          <div className="space-y-2">
            <Label htmlFor={parentFolderSelectId}>Parent Folder (Optional)</Label>
            <Select
              value={selectedParentId || 'none'}
              onValueChange={(value) => setSelectedParentId(value === 'none' ? null : value)}
            >
              <SelectTrigger id={parentFolderSelectId}>
                <SelectValue placeholder="No parent (root level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No parent (root level)</SelectItem>
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
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create Folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
