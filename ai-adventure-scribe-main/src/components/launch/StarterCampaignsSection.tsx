/**
 * Starter Campaigns Section - Launch Page Featured Campaigns
 *
 * PURPOSE: Showcase pre-built starter campaigns that users can jump into immediately
 * Features: Campaign cards with cover art, genre badges, difficulty indicators
 */

import React from 'react';

import { StarterCampaignCard } from '@/components/campaigns/StarterCampaignCard';
import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';

export const StarterCampaignsSection: React.FC = () => {
  const { featuredCampaigns, campaigns, isLoading, error } = useStarterCampaigns();

  // Use featured campaigns if available, otherwise show all
  const displayCampaigns = featuredCampaigns.length > 0 ? featuredCampaigns : campaigns;

  // Don't render section if no campaigns available
  if (!isLoading && displayCampaigns.length === 0) {
    return null;
  }

  return (
    <section
      id="starter-campaigns"
      className="relative py-24 bg-gradient-to-b from-purple-900/30 to-gray-900"
    >
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
            Ready-to-Play Adventures
          </h2>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto">
            Jump straight into professionally crafted campaigns. No setup required - just pick a
            character and start your adventure.
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[1, 2].map((n) => (
              <div key={n} className="h-[450px] rounded-2xl bg-gray-800/50 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-400">Failed to load campaigns. Please try again later.</p>
          </div>
        )}

        {/* Campaigns Grid */}
        {!isLoading && !error && displayCampaigns.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {displayCampaigns.map((campaign) => (
              <StarterCampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <p className="text-gray-400 text-lg mb-4">
            More adventures coming soon! Each campaign is hand-crafted with unique storylines,
            memorable NPCs, and rich world-building.
          </p>
          <p className="text-purple-400 font-semibold">
            Create your own campaigns or explore our curated collection
          </p>
        </div>
      </div>
    </section>
  );
};

export default StarterCampaignsSection;
