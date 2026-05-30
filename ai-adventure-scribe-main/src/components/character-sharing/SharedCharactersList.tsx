import { Users, Filter, X } from 'lucide-react';
import React, { useState, useMemo, useId } from 'react';

import { SharedCharacterCard, type SharedCharacter } from './SharedCharacterCard';

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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useTRPC, useTRPCUtils } from '@/infrastructure/api/trpc-hooks';
import { PermissionLevel } from '@/types/character';

/**
 * SharedCharactersList Component
 *
 * Displays characters shared with the current user:
 * - List of shared characters with owner info
 * - Permission level badges
 * - Filter by permission level
 * - Remove self button to stop accessing
 * - Navigate to character sheets
 */

/**
 * Main SharedCharactersList component
 */
export const SharedCharactersList: React.FC = () => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const utils = useTRPCUtils();
  const filterSelectId = useId();

  const [filterPermission, setFilterPermission] = useState<string>('all');
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Fetch shared characters
  const { data: sharedCharacters, isLoading, error } = trpc.characters.listShared.useQuery();

  // Remove self mutation
  const removeSelfMutation = trpc.characters.revokePermission.useMutation({
    onSuccess: () => {
      toast({
        title: 'Access Removed',
        description: 'You no longer have access to this character.',
      });
      utils.characters.listShared.invalidate();
      setRemoveDialogOpen(false);
      setSelectedCharacter(null);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to remove access. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Filter characters by permission level
  const filteredCharacters = useMemo(() => {
    if (!sharedCharacters) {
      return [];
    }
    if (filterPermission === 'all') {
      return sharedCharacters as SharedCharacter[];
    }
    return (sharedCharacters as SharedCharacter[]).filter(
      (char) => char.permissionLevel === filterPermission,
    );
  }, [sharedCharacters, filterPermission]);

  const handleRemoveSelf = (characterId: string, characterName: string): void => {
    setSelectedCharacter({ id: characterId, name: characterName });
    setRemoveDialogOpen(true);
  };

  const confirmRemoveSelf = (): void => {
    if (!selectedCharacter) return;

    // In a real implementation, this would call the revoke endpoint with the current user's ID
    // For now, we'll show a toast indicating the action
    toast({
      title: 'Feature Coming Soon',
      description: 'Self-removal from shared characters will be available soon.',
    });
    setRemoveDialogOpen(false);
    setSelectedCharacter(null);
  };

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-destructive mb-2">Failed to load shared characters</div>
        <div className="text-sm text-muted-foreground">
          {error.message || 'Please try again later.'}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-infinite-purple" aria-hidden="true" />
            Shared With Me
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Characters that other users have shared with you
          </p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <label htmlFor={filterSelectId} className="sr-only">
            Filter shared characters by permission level
          </label>
          <Select value={filterPermission} onValueChange={setFilterPermission}>
            <SelectTrigger id={filterSelectId} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Permissions</SelectItem>
              <SelectItem value={PermissionLevel.VIEWER}>Viewers</SelectItem>
              <SelectItem value={PermissionLevel.EDITOR}>Editors</SelectItem>
              <SelectItem value={PermissionLevel.OWNER}>Co-Owners</SelectItem>
            </SelectContent>
          </Select>
          {filterPermission !== 'all' && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setFilterPermission('all')}
                  className="h-8 w-8"
                  aria-label="Clear filter"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear filter</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Character List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-48 animate-pulse bg-accent/50" />
          ))}
        </div>
      ) : filteredCharacters.length === 0 ? (
        <EmptyState
          illustration="no-characters"
          variant="card"
          title="No Shared Characters"
          description={
            filterPermission === 'all'
              ? "You don't have any shared characters yet. When others share characters with you, they'll appear here."
              : `No characters shared with ${filterPermission} permission.`
          }
          action={
            filterPermission !== 'all' ? (
              <Button variant="outline" onClick={() => setFilterPermission('all')}>
                Clear Filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCharacters.map((character) => (
            <SharedCharacterCard
              key={character.id}
              character={character}
              onRemoveSelf={handleRemoveSelf}
            />
          ))}
        </div>
      )}

      {/* Remove Self Confirmation Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Access</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove your access to "{selectedCharacter?.name}"? You won't
              be able to view or edit this character unless the owner shares it with you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
              </TooltipTrigger>
              <TooltipContent>
                <p>Cancel and keep access</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <AlertDialogAction
                  onClick={confirmRemoveSelf}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  aria-label={`Confirm removing your access to ${selectedCharacter?.name}`}
                >
                  {removeSelfMutation.isPending ? 'Removing...' : 'Remove Access'}
                </AlertDialogAction>
              </TooltipTrigger>
              <TooltipContent>
                <p>Confirm removing your access to {selectedCharacter?.name}</p>
              </TooltipContent>
            </Tooltip>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
};

export default SharedCharactersList;
