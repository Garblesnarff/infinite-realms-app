import { useState } from 'react';

import type React from 'react';

import { useToast } from '@/hooks/use-toast';
import { useTRPC } from '@/infrastructure/api/trpc-hooks';
import { PermissionLevel } from '@/types/character';

interface UseShareCharacterProps {
  characterId: string;
  open: boolean;
}

/**
 * Custom hook to manage character sharing logic.
 * Extracted from ShareCharacterDialog.tsx.
 */
export const useShareCharacter = ({ characterId, open }: UseShareCharacterProps) => {
  const { toast } = useToast();
  const trpc = useTRPC();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>(PermissionLevel.VIEWER);
  const [canControlToken, setCanControlToken] = useState(false);
  const [canEditSheet, setCanEditSheet] = useState(false);

  // Fetch current permissions
  const {
    data: permissions,
    isLoading: loadingPermissions,
    refetch: refetchPermissions,
  } = trpc.characters.listPermissions.useQuery({ characterId }, { enabled: open });

  // Share mutation
  const shareMutation = trpc.characters.share.useMutation({
    onSuccess: () => {
      toast({
        title: 'Character Shared',
        description: 'Character has been shared successfully.',
      });
      refetchPermissions();
      setSelectedUserId('');
      setSearchQuery('');
      setPermissionLevel(PermissionLevel.VIEWER);
      setCanControlToken(false);
      setCanEditSheet(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to share character. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Update permission mutation
  const updatePermissionMutation = trpc.characters.updatePermission.useMutation({
    onSuccess: () => {
      toast({
        title: 'Permission Updated',
        description: 'User permission has been updated.',
      });
      refetchPermissions();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update permission. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Revoke mutation
  const revokeMutation = trpc.characters.revokePermission.useMutation({
    onSuccess: () => {
      toast({
        title: 'Access Revoked',
        description: 'User access has been revoked.',
      });
      refetchPermissions();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to revoke access. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleShare = (): void => {
    if (!selectedUserId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a user to share with.',
        variant: 'destructive',
      });
      return;
    }

    shareMutation.mutate({
      characterId,
      targetUserId: selectedUserId,
      permission: permissionLevel,
    });
  };

  const handleRevoke = (userId: string): void => {
    revokeMutation.mutate({
      characterId,
      targetUserId: userId,
    });
  };

  const handleUpdatePermission = (userId: string, newPermission: PermissionLevel): void => {
    updatePermissionMutation.mutate({
      characterId,
      targetUserId: userId,
      permission: newPermission,
    });
  };

  // Mock user search - in production, this would query your user database
  const mockUsers = [
    { id: 'user1', name: 'John Smith', email: 'john@example.com' },
    { id: 'user2', name: 'Jane Doe', email: 'jane@example.com' },
    { id: 'user3', name: 'Bob Wilson', email: 'bob@example.com' },
  ];

  const filteredUsers = mockUsers.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleSelectUser = (user: { id: string; name: string }): void => {
    setSelectedUserId(user.id);
    setSearchQuery(user.name);
    setShowSuggestions(false);
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      setSelectedIndex(0);
      setShowSuggestions(false);
      return;
    }

    if (!showSuggestions || filteredUsers.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredUsers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelectUser(filteredUsers[selectedIndex]);
    }
  };

  return {
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
    refetchPermissions,
    shareMutation,
    updatePermissionMutation,
    revokeMutation,
    handleShare,
    handleRevoke,
    handleUpdatePermission,
    filteredUsers,
    handleSelectUser,
    handleKeyDown,
  };
};
