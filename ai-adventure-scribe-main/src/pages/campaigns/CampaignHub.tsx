import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import CampaignCharacters from './CampaignCharacters';
import { CampaignHubHeader } from './CampaignHubHeader';
import { CampaignHubTabsList } from './CampaignHubTabsList';
import CampaignOverview from './CampaignOverview';
import CampaignSessions from './CampaignSessions';
import CampaignSettings from './CampaignSettings';
import CampaignWorld from './CampaignWorld';

import { ErrorBoundaryTest } from '@/components/error/ErrorBoundaryTest';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { CharacterSelectionModal } from '@/features/campaign/components';
import { userDataApi } from '@/services/user-data-api';

const CampaignHub: React.FC = () => {
  const { id: campaignId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { dispatch } = useCampaign();
  const { user } = useAuth();

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', campaignId, user?.id],
    queryFn: async () => {
      // SECURITY: Require authenticated user for data isolation
      if (!user?.id) {
        throw new Error('Not authenticated');
      }

      // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching
      // of heavy JSONB columns (setting_details, thematic_elements, etc.) not used in this view.
      return userDataApi.getCampaign(campaignId as string);
    },
    enabled: Boolean(campaignId) && Boolean(user?.id),
  });

  React.useEffect(() => {
    if (campaign) {
      dispatch({
        type: 'UPDATE_CAMPAIGN',
        payload: {
          id: campaign.id,
          name: campaign.name,
          defaultArtStyle: 'fantasy',
          description: campaign.description || undefined,
          genre: campaign.genre || undefined,
          tone: campaign.tone as 'serious' | 'humorous' | 'gritty' | undefined,
          difficulty_level: campaign.difficulty_level || undefined,
          campaign_length: campaign.campaign_length as 'one-shot' | 'short' | 'full' | undefined,
        },
      });
    }
  }, [campaign, dispatch]);

  const currentTab = React.useMemo(() => {
    if (location.pathname.endsWith('/characters') || location.pathname.includes('/characters/'))
      return 'characters';
    if (location.pathname.endsWith('/sessions')) return 'sessions';
    if (location.pathname.endsWith('/world')) return 'world';
    if (location.pathname.endsWith('/settings')) return 'settings';
    return 'overview';
  }, [location.pathname]);

  const onTabChange = (value: string) => {
    navigate(`/app/campaigns/${campaignId}/${value === 'overview' ? '' : value}`);
  };

  const [showCharacterModal, setShowCharacterModal] = React.useState(false);
  const searchParams = React.useMemo(() => new URLSearchParams(location.search), [location.search]);

  React.useEffect(() => {
    if (searchParams.get('startSession') === 'true') {
      setShowCharacterModal(true);
    } else {
      setShowCharacterModal(false);
    }
  }, [searchParams]);

  const openCharacterModal = React.useCallback(() => {
    setShowCharacterModal(true);
    const params = new URLSearchParams(location.search);
    params.set('startSession', 'true');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  const closeCharacterModal = React.useCallback(() => {
    setShowCharacterModal(false);
    const params = new URLSearchParams(location.search);
    if (params.has('startSession')) {
      params.delete('startSession');
      const search = params.toString();
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '' },
        { replace: true },
      );
    }
  }, [location.pathname, location.search, navigate]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-10 w-1/3 mb-4" />
        <Skeleton className="h-6 w-1/4 mb-6" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-6 text-center">Campaign not found</Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[image:var(--gradient-cosmic)]">
      <div className="container mx-auto px-4 py-8">
        {/* Enhanced Header */}
        <CampaignHubHeader
          campaignId={campaignId as string}
          campaignName={campaign.name}
          onStartNewSession={openCharacterModal}
        />

        {/* Enhanced Tabs */}
        <Tabs
          value={currentTab}
          onValueChange={onTabChange}
          aria-label="Campaign sections"
          className="mb-6"
        >
          <CampaignHubTabsList />

          <TabsContent value="overview">
            <CampaignOverview campaign={campaign} onStartNewSession={openCharacterModal} />
          </TabsContent>
          <TabsContent value="characters">
            <CampaignCharacters />
          </TabsContent>
          <TabsContent value="sessions">
            <CampaignSessions />
          </TabsContent>
          <TabsContent value="world">
            <CampaignWorld />
          </TabsContent>
          <TabsContent value="settings">
            <CampaignSettings />
          </TabsContent>
        </Tabs>
      </div>

      <CharacterSelectionModal
        isOpen={showCharacterModal}
        onClose={closeCharacterModal}
        campaignId={campaign.id}
        campaignName={campaign.name}
      />

      {/* Development only: Error boundary testing */}
      {import.meta.env.DEV && <ErrorBoundaryTest />}
    </div>
  );
};

export default CampaignHub;
