/**
 * Scene Management Page
 *
 * Main page for managing scenes in a campaign.
 * Features:
 * - Scene list/grid view
 * - Create new scene wizard
 * - Edit existing scenes
 * - Navigate to battle map view
 * - Breadcrumbs navigation
 */

import { ArrowLeft } from 'lucide-react';
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { SceneCreateFromTemplateView } from './scene-management/SceneCreateFromTemplateView';
import { SceneManagementHeader } from './scene-management/SceneManagementHeader';
import { SceneTemplateSelectionDialog } from './scene-management/SceneTemplateSelectionDialog';

import type { SceneTemplate } from '@/components/scenes/SceneTemplateLibrary';

import { SceneCreationWizard } from '@/components/scenes/SceneCreationWizard';
import { SceneManager } from '@/components/scenes/SceneManager';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { trpc } from '@/infrastructure/api/trpc-client';

type ViewMode = 'list' | 'create' | 'create-from-template';

export const SceneManagementPage: React.FC = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedTemplate, setSelectedTemplate] = useState<SceneTemplate | null>(null);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);

  // Fetch campaign details
  const { data: campaign } = trpc.campaigns.getById.useQuery(
    { campaignId: campaignId! },
    { enabled: !!campaignId },
  );

  const createSceneFromTemplateMutation = trpc.scenes.create.useMutation({
    onSuccess: (scene) => {
      toast({
        title: 'Scene Created',
        description: 'Your new scene from template has been created.',
      });
      setShowTemplateDialog(false);
      setSelectedTemplate(null);
      navigate(`/app/campaigns/${campaignId}/scenes/${scene.id}`);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create scene from template.',
        variant: 'destructive',
      });
    },
  });

  if (!campaignId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-12 text-center">
          <CardTitle className="text-2xl mb-2">Invalid Campaign</CardTitle>
          <CardDescription>Please select a valid campaign.</CardDescription>
          <Button onClick={() => navigate('/app/campaigns')} className="mt-6">
            Return to Campaigns
          </Button>
        </Card>
      </div>
    );
  }

  const handleCreateScene = () => {
    setShowTemplateDialog(true);
  };

  const handleStartWithTemplate = (template: SceneTemplate) => {
    setSelectedTemplate(template);
    setShowTemplateDialog(false);
    setViewMode('create-from-template');
  };

  const handleStartBlank = () => {
    setShowTemplateDialog(false);
    setViewMode('create');
  };

  const handleViewScene = (sceneId: string) => {
    navigate(`/app/campaigns/${campaignId}/scenes/${sceneId}/battle-map`);
  };

  const handleEditScene = (sceneId: string) => {
    navigate(`/app/campaigns/${campaignId}/scenes/${sceneId}/edit`);
  };

  const handleWizardComplete = (sceneId: string) => {
    setViewMode('list');
    navigate(`/app/campaigns/${campaignId}/scenes/${sceneId}/battle-map`);
  };

  const handleCancelCreate = () => {
    setViewMode('list');
    setSelectedTemplate(null);
  };

  const handleCreateFromTemplate = () => {
    if (!selectedTemplate) return;

    createSceneFromTemplateMutation.mutate({
      name: selectedTemplate.name,
      description: selectedTemplate.description,
      campaignId,
      width: selectedTemplate.width,
      height: selectedTemplate.height,
      gridSize: selectedTemplate.gridSize,
      gridType: selectedTemplate.gridType,
      gridColor: '#000000',
      backgroundImageUrl: '',
      thumbnailUrl: '',
    });
  };

  return (
    <div className="min-h-screen bg-[image:var(--gradient-cosmic)]">
      <div className="container mx-auto px-4 py-8">
        <SceneManagementHeader
          campaignName={campaign?.name}
          showTitleRow={viewMode === 'list'}
          onNavigateCampaigns={() => navigate('/app/campaigns')}
          onNavigateCampaign={() => navigate(`/app/campaigns/${campaignId}`)}
        />

        {/* List View */}
        {viewMode === 'list' && (
          <SceneManager
            campaignId={campaignId}
            onCreateScene={handleCreateScene}
            onEditScene={handleEditScene}
            onViewScene={handleViewScene}
          />
        )}

        {/* Create View */}
        {viewMode === 'create' && (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Create New Scene</h2>
              <Button onClick={handleCancelCreate} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to List
              </Button>
            </div>
            <SceneCreationWizard
              campaignId={campaignId}
              onComplete={handleWizardComplete}
              onCancel={handleCancelCreate}
            />
          </div>
        )}

        {/* Create from Template View */}
        {viewMode === 'create-from-template' && selectedTemplate && (
          <SceneCreateFromTemplateView
            selectedTemplate={selectedTemplate}
            isCreating={createSceneFromTemplateMutation.isLoading}
            onCancel={handleCancelCreate}
            onConfirm={handleCreateFromTemplate}
          />
        )}

        <SceneTemplateSelectionDialog
          open={showTemplateDialog}
          onOpenChange={setShowTemplateDialog}
          selectedTemplateId={selectedTemplate?.id}
          onSelectTemplate={handleStartWithTemplate}
          onStartBlank={handleStartBlank}
        />
      </div>
    </div>
  );
};

export default SceneManagementPage;
