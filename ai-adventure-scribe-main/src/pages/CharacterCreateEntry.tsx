import { useMutation, useQuery } from '@tanstack/react-query';
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { planHasPaidFeatures } from '../../shared/plan-features';

import CharacterWizard from '@/components/character-creation/character-wizard';
import { ErrorBoundary } from '@/components/error';
import { CharacterCreationErrorFallback } from '@/components/error/CharacterCreationErrorFallback';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isCampaignCharacterFlowEnabled } from '@/config/featureFlags';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { userDataApi } from '@/services/user-data-api';

type CampaignTemplate = {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  tone: string | null;
  campaign_length: string | null;
  difficulty_level: string | null;
  thumbnail_url: string | null;
};

const CharacterCreateEntry: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userPlan, userPlanError, refreshUserPlan } = useAuth();
  const featureOn = isCampaignCharacterFlowEnabled();
  const preselectedCampaign = searchParams.get('campaign');

  // If a campaign is preselected via URL param, go directly to the wizard
  // The wizard will read the campaign param and associate the character with it
  const hasPreselectedCampaign = Boolean(preselectedCampaign);

  // Always call hook regardless of feature flag (rules of hooks requirement)
  // Feature enabled and campaign picker: show campaigns
  // Feature disabled: don't use this data
  const [activeTemplateId, setActiveTemplateId] = React.useState<string | null>(null);
  const [cloneError, setCloneError] = React.useState<string | null>(null);

  const {
    data: templates,
    isLoading,
    isError,
    error,
  } = useQuery<CampaignTemplate[], Error>({
    queryKey: ['public-campaign-templates'],
    queryFn: async () => {
      return userDataApi.listPublicCampaignTemplates() as Promise<CampaignTemplate[]>;
    },
    // Only run query if feature is enabled AND the plan is paid: the gate
    // below returns before the picker for free players, so fetching public
    // templates for them is wasted work.
    enabled: featureOn && planHasPaidFeatures(userPlan),
  });

  const cloneMutation = useMutation<string, Error, string>({
    mutationFn: async (templateId: string) => {
      const { data, error: fnError } = await supabase.functions.invoke('clone-template', {
        body: { templateId },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to clone template');
      }

      const campaignId = (data as { campaignId?: string } | null)?.campaignId;
      if (!campaignId) {
        throw new Error('Clone response missing campaignId');
      }

      return campaignId;
    },
    onMutate: (templateId) => {
      setCloneError(null);
      setActiveTemplateId(templateId);
    },
    onSuccess: (campaignId) => {
      navigate(`/app/campaigns/${campaignId}/characters/new`);
    },
    onError: (err) => {
      setCloneError(err.message || 'Failed to clone template');
    },
    onSettled: () => {
      setActiveTemplateId(null);
    },
  });

  const handleSelect = React.useCallback(
    (templateId: string) => {
      if (cloneMutation.isPending) return;
      cloneMutation.mutate(templateId);
    },
    [cloneMutation],
  );

  // #1239 item 4: custom hero creation is a Legend feature. The gate shows
  // here, on the creation entry, before the wizard opens — a free player
  // never reaches the wizard and loses no work. The plan state machine
  // follows AccountPage (#351): a known plan always decides, even while a
  // background refetch is loading or has errored — the last-known plan
  // stays rendered. Only a null plan splits: an error means unavailable
  // with a retry, anything else means still loading. Showing the wizard on
  // an unknown plan would admit a free player; showing the gate would
  // mislabel a paid player.
  if (userPlan === null) {
    if (userPlanError) {
      return (
        <div className="container mx-auto px-4 py-8">
          <Card className="p-6">
            <h1 className="text-2xl font-semibold mb-2">Plan unavailable</h1>
            <p className="text-muted-foreground mb-4">
              We could not load your plan, so character creation is unavailable right now.
            </p>
            <Button onClick={() => void refreshUserPlan()}>Retry</Button>
          </Card>
        </div>
      );
    }
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-muted-foreground" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (!planHasPaidFeatures(userPlan)) {
    // A free player arriving from a campaign goes back to that campaign,
    // not to the roster — otherwise the campaign context is lost. The
    // premade path is real, not just copy: /explore is where premade
    // campaigns and their heroes live, so the gate links there instead of
    // stranding a new free player between this gate and an empty roster.
    const backTarget = hasPreselectedCampaign
      ? `/app/campaigns/${preselectedCampaign}`
      : '/app/characters';
    const backLabel = hasPreselectedCampaign ? 'Back to campaign' : 'Back to characters';
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-6">
          <h1 className="text-2xl font-semibold mb-2">
            Creating your own hero is a Legend feature
          </h1>
          <p className="text-muted-foreground mb-4">
            Legend lets you create custom heroes and keep them across adventures. Premade heroes are
            free — pick one to start playing right away.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigate('/app/account')}>Upgrade to Legend</Button>
            <Button variant="outline" onClick={() => navigate('/explore')}>
              Browse premade heroes
            </Button>
            <Button variant="outline" onClick={() => navigate(backTarget)}>
              {backLabel}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Render wizard directly if:
  // 1. Feature flag is off (legacy behavior)
  // 2. Campaign is preselected via URL param (navigated from campaign hub)
  // CharacterWizard is already wrapped with ErrorBoundary internally
  if (!featureOn || hasPreselectedCampaign) {
    return <CharacterWizard />;
  }

  // Wrap campaign selection UI with ErrorBoundary for campaign template loading errors
  return (
    <ErrorBoundary
      level="feature"
      fallback={<CharacterCreationErrorFallback showReturnToCharacters />}
    >
      <div className="container mx-auto px-4 py-8">
        <Card className="p-6">
          <h1 className="text-2xl font-semibold mb-2">Choose a Campaign</h1>
          <p className="text-muted-foreground mb-4">Select a campaign to create a character for.</p>
          {cloneError && <div className="mb-4 text-sm text-destructive">{cloneError}</div>}
          {isError ? (
            <div className="text-sm text-destructive">
              Failed to load campaigns: {error?.message}
            </div>
          ) : isLoading ? (
            <div>Loading campaigns…</div>
          ) : templates && templates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((template) => {
                const isCloning = cloneMutation.isPending && activeTemplateId === template.id;
                return (
                  <Card key={template.id} className="p-4 flex flex-col gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-lg">{template.name}</div>
                      {template.description && (
                        <div className="text-sm text-muted-foreground line-clamp-3">
                          {template.description}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        template.genre && `Genre: ${template.genre}`,
                        template.tone && `Tone: ${template.tone}`,
                        template.difficulty_level && `Difficulty: ${template.difficulty_level}`,
                        template.campaign_length && `Length: ${template.campaign_length}`,
                      ]
                        .filter(Boolean)
                        .join(' • ')}
                    </div>
                    <div className="mt-auto flex justify-end">
                      <Button onClick={() => handleSelect(template.id)} disabled={isCloning}>
                        {isCloning ? 'Cloning…' : 'Select'}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div>No campaigns found.</div>
          )}
        </Card>
      </div>
    </ErrorBoundary>
  );
};

export default CharacterCreateEntry;
