/**
 * ShareCharacterDialog Component
 *
 * Provides UI for sharing characters with other users:
 * - User search/autocomplete
 * - Permission level selector (viewer/editor/owner)
 * - Token control and sheet editing checkboxes
 * - Add/revoke buttons
 * - Current permissions list with manage options
 */

import { Share2, Search, UserPlus, Eye, Edit, Crown, Shield, Trash2, Check } from 'lucide-react';
import React, { useId } from 'react';

import { useShareCharacter } from './hooks/use-share-character';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { cn } from '@/lib/utils';
import { PermissionLevel } from '@/types/character';

interface ShareCharacterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  characterName?: string;
}

/**
 * Main ShareCharacterDialog component
 */
export const ShareCharacterDialog: React.FC<ShareCharacterDialogProps> = ({
  open,
  onOpenChange,
  characterId,
  characterName = 'this character',
}) => {
  const tokenControlId = useId();
  const sheetEditId = useId();
  const userSearchId = useId();
  const permissionSelectId = useId();
  const resultsListboxId = useId();
  const peopleHeadingId = useId();
  const suggestionIdPrefix = useId();

  const {
    searchQuery,
    setSearchQuery,
    showSuggestions,
    setShowSuggestions,
    selectedUserId,
    selectedIndex,
    setSelectedIndex,
    permissionLevel,
    setPermissionLevel,
    canControlToken,
    setCanControlToken,
    canEditSheet,
    setCanEditSheet,
    permissions,
    loadingPermissions,
    shareMutation,
    revokeMutation,
    handleShare,
    handleRevoke,
    handleUpdatePermission,
    filteredUsers,
    handleSelectUser,
    handleKeyDown,
  } = useShareCharacter({ characterId, open });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TooltipProvider>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Character
          </DialogTitle>
          <DialogDescription>
            Share "{characterName}" with other users. Control their permission level and what they
            can do.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Add User Section */}
          <div className="space-y-4 p-4 border rounded-lg bg-accent/20">
            <h4 className="font-semibold text-sm">Add People</h4>

            {/* User Search */}
            <div className="space-y-2">
              <Label htmlFor={userSearchId}>Search Users</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id={userSearchId}
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedIndex(0);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => {
                    // Small delay to allow click event to fire on suggestions
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  onKeyDown={handleKeyDown}
                  className="pl-10"
                  aria-controls={showSuggestions ? resultsListboxId : undefined}
                  aria-haspopup="listbox"
                  aria-expanded={showSuggestions}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    showSuggestions && filteredUsers.length > 0
                      ? `${suggestionIdPrefix}-${selectedIndex}`
                      : undefined
                  }
                />
              </div>

              {/* User suggestions */}
              {showSuggestions && searchQuery && (
                <div
                  id={resultsListboxId}
                  className="border rounded-md max-h-48 overflow-auto"
                  role="listbox"
                  aria-label="User suggestions"
                >
                  {filteredUsers.length > 0 ? (
                    filteredUsers.map((user, index) => (
                      <button
                        key={user.id}
                        id={`${suggestionIdPrefix}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === selectedIndex}
                        tabIndex={-1}
                        aria-label={`Select ${user.name}`}
                        className={cn(
                          'w-full px-3 py-2 text-left transition-colors flex items-center justify-between outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple',
                          index === selectedIndex ? 'bg-accent' : 'hover:bg-accent',
                        )}
                        onClick={() => handleSelectUser(user)}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div>
                            <div className="font-medium text-sm">{user.name}</div>
                            <div className="text-xs text-muted-foreground">{user.email}</div>
                          </div>
                          {selectedUserId === user.id && (
                            <Check className="h-4 w-4 text-infinite-teal" aria-hidden="true" />
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div
                      className="px-3 py-6 text-center text-sm text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
                      No users found
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Permission Level */}
            <div className="space-y-2">
              <Label id={permissionSelectId}>Permission Level</Label>
              <Select
                value={permissionLevel}
                onValueChange={(value) => setPermissionLevel(value as PermissionLevel)}
              >
                <SelectTrigger aria-labelledby={permissionSelectId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PermissionLevel.VIEWER}>
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      <div>
                        <div className="font-medium">Viewer</div>
                        <div className="text-xs text-muted-foreground">
                          Can view character sheet
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value={PermissionLevel.EDITOR}>
                    <div className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      <div>
                        <div className="font-medium">Editor</div>
                        <div className="text-xs text-muted-foreground">
                          Can edit character sheet
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value={PermissionLevel.OWNER}>
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4" />
                      <div>
                        <div className="font-medium">Owner</div>
                        <div className="text-xs text-muted-foreground">
                          Full control, can share and delete
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Additional Permissions (for Editor/Owner) */}
            {permissionLevel !== PermissionLevel.VIEWER && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={tokenControlId}
                    checked={canControlToken}
                    onCheckedChange={(checked) => setCanControlToken(checked === true)}
                  />
                  <Label htmlFor={tokenControlId} className="text-sm font-normal cursor-pointer">
                    Can control character token in battle maps
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={sheetEditId}
                    checked={canEditSheet}
                    onCheckedChange={(checked) => setCanEditSheet(checked === true)}
                  />
                  <Label htmlFor={sheetEditId} className="text-sm font-normal cursor-pointer">
                    Can edit character sheet details
                  </Label>
                </div>
              </div>
            )}

            {/* Add Button */}
            <Button
              onClick={handleShare}
              disabled={!selectedUserId || shareMutation.isPending}
              className="w-full"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {shareMutation.isPending ? 'Sharing...' : 'Share Character'}
            </Button>
          </div>

          {/* Current Permissions List */}
          <div className="space-y-3">
            <h4 id={peopleHeadingId} className="font-semibold text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              People with Access
            </h4>

            {loadingPermissions ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 bg-accent/50 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : permissions && permissions.length > 0 ? (
              <ScrollArea className="max-h-64" aria-labelledby={peopleHeadingId}>
                <div className="space-y-2">
                  {permissions.map(
                    (permission: {
                      id: string;
                      userId: string;
                      userName?: string;
                      userEmail?: string;
                      permissionLevel: PermissionLevel;
                      grantedAt: string;
                    }) => (
                      <div
                        key={permission.id}
                        className="flex items-center justify-between p-3 border rounded-lg bg-card"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-sm">
                            {permission.userName || permission.userId}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {permission.userEmail ||
                              `Shared ${new Date(permission.grantedAt).toLocaleDateString()}`}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Select
                            value={permission.permissionLevel}
                            onValueChange={(value) =>
                              handleUpdatePermission(permission.userId, value as PermissionLevel)
                            }
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <SelectTrigger
                                  className="w-32"
                                  aria-label={`Change permission level for ${permission.userName || permission.userId}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>
                                  Change permission level for{' '}
                                  {permission.userName || permission.userId}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                            <SelectContent>
                              <SelectItem value={PermissionLevel.VIEWER}>Viewer</SelectItem>
                              <SelectItem value={PermissionLevel.EDITOR}>Editor</SelectItem>
                              <SelectItem value={PermissionLevel.OWNER}>Owner</SelectItem>
                            </SelectContent>
                          </Select>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={revokeMutation.isPending ? 'cursor-not-allowed' : ''}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRevoke(permission.userId)}
                                  disabled={revokeMutation.isPending}
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  aria-label={`Revoke access for ${permission.userName || permission.userId}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Revoke access for {permission.userName || permission.userId}</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </ScrollArea>
            ) : (
              <div
                className="text-center py-8 text-sm text-muted-foreground border rounded-lg bg-accent/10"
                role="status"
                aria-live="polite"
              >
                No one has access yet. Share this character to collaborate.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
};

export default ShareCharacterDialog;
