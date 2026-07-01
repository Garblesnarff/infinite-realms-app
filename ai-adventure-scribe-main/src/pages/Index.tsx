import { Plus, Users } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { ErrorBoundary, CampaignErrorFallback } from '@/components/error';
import { ErrorBoundaryTest } from '@/components/error/ErrorBoundaryTest';
import { Button } from '@/components/ui/button';
import { IRPanel } from '@/components/ui/ir-primitives';
import { Z_INDEX } from '@/constants/z-index';
import { CampaignList } from '@/features/campaign/components';

/**
 * Index page component serving as the landing page
 * Displays available campaigns and quick actions
 * @returns {JSX.Element} The index page with campaign list
 */
const Index = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sortBy, setSortBy] = React.useState<'name' | 'created_at'>('created_at');

  return (
    <div className="min-h-screen bg-[image:var(--gradient-cosmic)]">
      {/* Hero Header */}
      <div
        className="relative bg-no-repeat py-16 sm:py-20 md:py-24 px-4 bg-gradient-to-br from-infinite-dark/70 via-infinite-dark/30 to-infinite-dark/70"
        style={{
          backgroundImage: "url('/hero_header.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/30 to-black/50"></div>
        <div className="relative max-w-7xl mx-auto text-center">
          <div className="mb-8 sm:mb-12 md:mb-16"></div>
          <p className="ir-narr text-lg sm:text-xl text-white/95 mb-8 sm:mb-12 max-w-3xl mx-auto drop-shadow-lg leading-relaxed px-4">
            Step into boundless worlds of adventure, where every choice shapes destiny and legends
            are forged in the fires of imagination
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-md mx-auto">
            <Button
              onClick={() => navigate('/app/campaigns/create')}
              variant="ir-gold"
              size="lg"
              className="px-8 py-4 text-lg"
            >
              <Plus className="w-6 h-6 mr-2" />
              Create Epic Saga
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="px-8 py-4 text-lg border-infinite-gold text-infinite-gold hover:bg-infinite-gold/10"
              onClick={() => navigate('/explore')}
            >
              Explore Pre-Built Campaigns
            </Button>
          </div>
        </div>
      </div>

      <div
        className="container mx-auto px-4 py-12 -mt-12 relative"
        style={{ zIndex: Z_INDEX.DROPDOWN }}
      >
        {/* Search and Sort Controls */}
        <IRPanel className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center mb-8 p-6">
          <div className="flex-1 max-w-md">
            <div className="relative">
              <label htmlFor="campaign-search" className="sr-only">
                Search campaigns
              </label>
              <input
                type="text"
                placeholder="Search your campaigns by name or genre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                id="campaign-search"
                aria-label="Search campaigns"
                className="w-full px-4 py-3 pl-12 pr-4 rounded-xl border border-white/10 bg-white/[0.04] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-infinite-gold focus:border-transparent transition-all duration-200"
              />
              <Users className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
            </div>
          </div>

          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'created_at')}
              className="px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-foreground focus:outline-none focus:ring-2 focus:ring-infinite-gold focus:border-transparent transition-all duration-200"
            >
              <option value="created_at">Sort by: Recent</option>
              <option value="name">Sort by: Name</option>
            </select>
          </div>
        </IRPanel>

        <ErrorBoundary
          level="feature"
          fallback={<CampaignErrorFallback showReturnToCampaigns={false} />}
        >
          <CampaignList searchTerm={searchTerm} sortBy={sortBy} />
        </ErrorBoundary>

        {/* Development only: Error boundary testing */}
        {import.meta.env.DEV && <ErrorBoundaryTest />}
      </div>
    </div>
  );
};

export default Index;
