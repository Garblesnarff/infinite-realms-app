import { Users, Filter, X } from 'lucide-react';
import React, { useState, useMemo, useId } from 'react';

import { SharedCharacterCard, type SharedCharacter } from './SharedCharacterCard';

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
import { useTRPC } from '@/infrastructure/api/trpc-hooks';
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
  const trpc = useTRPC();
  const filterSelectId = useId();

  const [filterPermission, setFilterPermission] = useState<string>('all');

  // Fetch shared characters
  const { data: sharedCharacters, isLoading, error } = trpc.characters.listShared.useQuery();

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
            />
          ))}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
};

export default SharedCharactersList;
