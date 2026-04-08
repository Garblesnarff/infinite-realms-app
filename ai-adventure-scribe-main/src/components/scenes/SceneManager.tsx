/**
 * Scene Manager Component
 *
 * Grid/list view for managing scenes in a campaign.
 * Features:
 * - Grid or list view toggle
 * - Scene thumbnails
 * - Active scene indicator
 * - Create, duplicate, delete, and set active actions
 */

import { Grid, List, Plus } from 'lucide-react';
import React, { useState } from 'react';

import { SceneCard } from './SceneCard';
import { SceneListItem } from './SceneListItem';

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
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { trpc } from '@/infrastructure/api/trpc-client';


interface SceneManagerProps {
  campaignId: string;
  onCreateScene?: () => void;
  onEditScene?: (sceneId: string) => void;
  onViewScene?: (sceneId: string) => void;
}

type ViewMode = 'grid' | 'list';

export const SceneManager: React.FC<SceneManagerProps> = ({
  campaignId,
  onCreateScene,
  onEditScene,
  onViewScene,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sceneToDelete, setSceneToDelete] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch scenes
  const { data: scenes, isLoading, refetch } = trpc.scenes.list.useQuery({ campaignId });

  // Mutations
  const deleteMutation = trpc.scenes.delete.useMutation({
    onSuccess: () => {
      toast({
        title: 'Scene Deleted',
        description: 'The scene has been successfully deleted.',
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete scene.',
        variant: 'destructive',
      });
    },
  });

  const setActiveMutation = trpc.scenes.setActive.useMutation({
    onSuccess: () => {
      toast({
        title: 'Active Scene Updated',
        description: 'The scene is now the active scene.',
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to set active scene.',
        variant: 'destructive',
      });
    },
  });

  const duplicateMutation = trpc.scenes.create.useMutation({
    onSuccess: () => {
      toast({
        title: 'Scene Duplicated',
        description: 'The scene has been successfully duplicated.',
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to duplicate scene.',
        variant: 'destructive',
      });
    },
  });

  const handleDelete = (sceneId: string) => {
    deleteMutation.mutate({ sceneId });
    setSceneToDelete(null);
  };

  const handleSetActive = (sceneId: string) => {
    setActiveMutation.mutate({ sceneId, campaignId });
  };

  const handleDuplicate = (scene: any) => {
    duplicateMutation.mutate({
      name: `${scene.name} (Copy)`,
      description: scene.description,
      campaignId,
      width: scene.width,
      height: scene.height,
      gridSize: scene.gridSize,
      gridType: scene.gridType as any,
      gridColor: scene.gridColor,
      backgroundImageUrl: scene.backgroundImageUrl || '',
      thumbnailUrl: scene.thumbnailUrl || '',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-5 w-20 ml-2" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>

        {/* Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} variant="parchment" className="overflow-hidden">
              <Skeleton className="h-48 w-full" />
              <CardHeader className="pb-3">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const sceneList = scenes || [];

  return (
    <div className="space-y-6">
      {/* Header with view toggle and create button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" role="group" aria-label="View mode">
          <Button
            type="button"
            variant={viewMode === 'grid' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            title="Grid view"
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={viewMode === 'list' ? 'default' : 'outline'}
            size="icon"
            onClick={() => setViewMode('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <span
            className="text-sm text-muted-foreground ml-2"
            role="status"
            aria-live="polite"
          >
            {sceneList.length} {sceneList.length === 1 ? 'scene' : 'scenes'}
          </span>
        </div>
        <Button type="button" onClick={onCreateScene} variant="cosmic">
          <Plus className="mr-2 h-4 w-4" />
          Create New Scene
        </Button>
      </div>

      {/* Empty state */}
      {sceneList.length === 0 && (
        <EmptyState
          illustration="no-locations"
          variant="card"
          title="No Scenes Yet"
          description="Create your first scene to bring your campaign to life with interactive battle maps."
          action={
            <Button type="button" onClick={onCreateScene} variant="cosmic">
              <Plus className="mr-2 h-4 w-4" />
              Create First Scene
            </Button>
          }
        />
      )}

      {/* Grid View */}
      {viewMode === 'grid' && sceneList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {sceneList.map((scene: any) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onViewScene={onViewScene}
              onEditScene={onEditScene}
              onSetActive={handleSetActive}
              onDuplicate={handleDuplicate}
              onDelete={setSceneToDelete}
            />
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && sceneList.length > 0 && (
        <div className="space-y-3">
          {sceneList.map((scene: any) => (
            <SceneListItem
              key={scene.id}
              scene={scene}
              onViewScene={onViewScene}
              onEditScene={onEditScene}
              onSetActive={handleSetActive}
              onDuplicate={handleDuplicate}
              onDelete={setSceneToDelete}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!sceneToDelete} onOpenChange={() => setSceneToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scene?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the scene and all associated data including tokens,
              lighting, and fog of war. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sceneToDelete && handleDelete(sceneToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Scene
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
