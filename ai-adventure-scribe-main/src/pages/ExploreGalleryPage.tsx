/**
 * Explore Gallery Page - Browse All Starter Campaigns
 *
 * PURPOSE: Dedicated page for browsing all available pre-built starter campaigns
 * Route: /explore
 */

import { Sparkles } from 'lucide-react';
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

import { StarterCampaignCard } from '@/components/campaigns/StarterCampaignCard';
import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';

export const ExploreGalleryPage: React.FC = () => {
  const { campaigns, isLoading, error } = useStarterCampaigns();

  return (
    <>
      <Helmet>
        <title>Explore Adventures | InfiniteRealms</title>
        <meta
          name="description"
          content="Browse our collection of professionally crafted D&D campaigns. Pick a character and start your adventure immediately."
        />
      </Helmet>

      <div className="ir-app min-h-screen max-w-full overflow-x-hidden bg-background text-foreground">
        {/* Header: top nav */}
        <header
          className="sticky top-0 border-b border-white/10 bg-infinite-dark/90 backdrop-blur-lg"
          style={{ zIndex: Z_INDEX.STICKY }}
        >
          <nav
            aria-label="Main"
            className="max-w-7xl mx-auto px-4 sm:px-6 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <Link to="/" className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-infinite-gold" aria-hidden="true" />
              <span className="font-heading text-lg font-semibold uppercase tracking-[1.5px] text-infinite-gold">
                InfiniteRealms
              </span>
            </Link>
            <div className="flex items-center gap-1 text-sm font-medium">
              <Link
                to="/"
                className="rounded-md px-3 py-2 text-muted-foreground hover:text-infinite-gold transition-colors"
              >
                Home
              </Link>
              <Link
                to="/explore"
                aria-current="page"
                className="rounded-md px-3 py-2 text-infinite-gold bg-infinite-gold/10"
              >
                Campaigns
              </Link>
              <Link
                to="/app/characters"
                className="rounded-md px-3 py-2 text-muted-foreground hover:text-infinite-gold transition-colors"
              >
                Characters
              </Link>
            </div>
          </nav>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {/* Page Title */}
          <div className="mb-6 sm:mb-8">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.1em] text-muted-foreground">
              <span className="text-infinite-gold">1 Campaign</span> › 2 Hero › 3 Play
            </p>
            <h1 className="font-heading text-2xl min-[700px]:text-3xl font-bold mb-2">
              Pick a campaign
            </h1>
            <p className="text-[15px] text-muted-foreground max-w-[60ch]">
              Every campaign starts at level 1 with ready-made heroes. No setup. You can start
              another one later.
            </p>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div role="status" aria-label="Loading campaigns">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="grid grid-rows-[auto_1fr] rounded-[13px] border border-white/10 bg-[color:var(--infinite-surface)] overflow-hidden animate-pulse"
                  >
                    <div className="aspect-video bg-white/5" />
                    <div className="p-4 min-h-[9.5rem]">
                      {n === 1 && (
                        <p className="text-muted-foreground text-[15px]">Loading campaigns…</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="rounded-[10px] border border-[color:color-mix(in_srgb,var(--ir-hp-bad)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--ir-hp-bad)_7%,transparent)] p-4">
              <p className="font-semibold">We could not load the campaigns.</p>
              <p className="text-sm text-muted-foreground mb-3">
                Check your connection and try again.
              </p>
              <Button onClick={() => window.location.reload()} variant="outline">
                Try again
              </Button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && campaigns.length === 0 && (
            <div className="text-center py-16">
              <p className="text-muted-foreground text-lg mb-4">
                No campaigns available yet. Check back soon!
              </p>
              <Link to="/">
                <Button variant="outline">Return Home</Button>
              </Link>

              <div className="mt-16 text-center border-t border-white/10 pt-12">
                <h2 className="font-heading text-2xl font-bold mb-4">
                  More Adventures Coming Soon
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  Our team is crafting new campaigns across different genres and themes. From epic
                  fantasy quests to mysterious horror tales, there's an adventure for every player.
                </p>
              </div>
            </div>
          )}

          {/* Campaigns Grid */}
          {!isLoading && !error && campaigns.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
              {campaigns.map((campaign, index) => (
                <StarterCampaignCard key={campaign.id} campaign={campaign} isFirst={index === 0} />
              ))}
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/10 py-8 mt-12">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <p className="text-muted-foreground">
              &copy; {new Date().getFullYear()} InfiniteRealms. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
};

export default ExploreGalleryPage;
