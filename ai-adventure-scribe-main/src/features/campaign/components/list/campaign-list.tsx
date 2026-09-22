/**
 * Campaign List Component
 *
 * Fetches and displays all campaigns for the current user.
 * Handles loading, error, and empty states.
 *
 * Dependencies:
 * - React Query (tanstack)
 * - useCampaignsList (src/features/campaign/hooks/use-campaigns-list.ts)
 * - CampaignCard (src/components/campaign-list/campaign-card.tsx)
 * - CampaignSkeleton (src/components/campaign-list/campaign-skeleton.tsx)
 * - EmptyState (src/components/campaign-list/empty-state.tsx)
 *
 * @author AI Dungeon Master Team
 */

// ============================
// SDK/library imports
// ============================
import { useMemo } from 'react';

// ============================
// External integrations
// ============================

// ============================
// Project hooks
// ============================

// ============================
// Feature components
// ============================

import { MemoizedCampaignCard } from './campaign-card';
import CampaignsLoadError from './campaigns-load-error';
import EmptyState from './empty-state';
import { useCampaignsList } from '../../hooks/use-campaigns-list';

import { FantasyLoader } from '@/components/ui/fantasy-loader';

/**
 * Props for CampaignList component
 * @param searchTerm - Search term to filter campaigns
 * @param sortBy - Field to sort campaigns by
 */
interface CampaignListProps {
  searchTerm?: string;
  sortBy?: 'name' | 'created_at';
}

/**
 * Campaign List Component
 *
 * Fetches and displays all campaigns for the current user.
 * Handles loading, error, and empty states.
 *
 * @returns {JSX.Element} List of campaign cards or appropriate feedback state
 */
const CampaignList = ({ searchTerm = '', sortBy = 'created_at' }: CampaignListProps) => {
  // map known campaign names to public cover images
  const getCoverFor = useMemo(
    () => (name: string | null) => {
      if (!name) return undefined;
      const n = name.toLowerCase();
      if (n.includes('kleetus') || n.includes('carnival')) return '/carnival.jpeg';
      if (n.includes('erebo') || n.includes('new erebo')) return '/erebo.jpeg';
      if (n.includes('tenebrous')) return '/tenebrous.jpeg';
      return undefined;
    },
    [],
  );

  // One shared, user-scoped request; search and sort are applied client-side
  // so typing never changes the query key (#2149).
  const { data, isLoading, error, refetch, isFetching } = useCampaignsList();

  const campaigns = useMemo(() => {
    if (!data) return data;
    const needle = searchTerm.toLowerCase();
    return data
      .filter(
        (campaign) =>
          !needle ||
          campaign.name?.toLowerCase().includes(needle) ||
          campaign.genre?.toLowerCase().includes(needle),
      )
      .sort((a, b) => String(b[sortBy] || '').localeCompare(String(a[sortBy] || '')));
  }, [data, searchTerm, sortBy]);

  // Show loading state with FantasyLoader
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <FantasyLoader
          type="parchment"
          size="lg"
          label="Loading campaigns..."
          tip="Your epic adventures await!"
        />
      </div>
    );
  }

  // A failed load (including 429) is never an empty roster.
  if (error) {
    return <CampaignsLoadError onRetry={() => void refetch()} isRetrying={isFetching} />;
  }

  // Show empty state if no campaigns
  if (!campaigns?.length) {
    return <EmptyState />;
  }

  // Render campaign grid

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {campaigns.map((campaign) => {
        // Prefer an explicit legacy mapping only; never fall back by list
        // position. A positional fallback previously leaked the retired
        // "card-background.jpeg" (Lost Temple) art onto unrelated campaigns.
        const cover = getCoverFor(campaign.name);
        return (
          <MemoizedCampaignCard
            key={campaign.id}
            campaign={campaign}
            isFeatured={Boolean(cover)}
            coverImage={cover}
          />
        );
      })}
    </div>
  );
};

export default CampaignList;
