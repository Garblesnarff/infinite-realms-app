/**
 * Explore Gallery Page - Browse All Starter Campaigns
 *
 * PURPOSE: Dedicated page for browsing all available pre-built starter campaigns
 * Route: /explore
 */

import { ArrowLeft, Sparkles } from 'lucide-react';
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
import { BoxedCampaign } from '@/features/campaigns/table/BoxedCampaign';
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
        <meta property="og:title" content="Explore Adventures | InfiniteRealms" />
        <meta
          property="og:description"
          content="Browse our collection of professionally crafted D&D campaigns. Pick a character and start your adventure immediately."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://infiniterealms.app/explore" />
        {/* #355: every Helmet page redeclares the full tag set — react-helmet-async
            deletes managed (data-rh) tags it is not told to keep, so a partial set
            would wipe og:image / twitter cards set by index.html. */}
        <meta property="og:image" content="https://infiniterealms.app/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Explore Adventures | InfiniteRealms" />
        <meta
          name="twitter:description"
          content="Browse our collection of professionally crafted D&D campaigns. Pick a character and start your adventure immediately."
        />
        <meta name="twitter:image" content="https://infiniterealms.app/og-image.png" />
        {/* Canonical URL (#355) */}
        <link rel="canonical" href="https://infiniterealms.app/explore" />
      </Helmet>

      <div className="ir-table-walnut ir-app min-h-screen max-w-full overflow-x-hidden bg-background text-foreground">
        {/* Header: PublicExplore board (back link left, INFINITE REALMS wordmark right) */}
        <header
          className="sticky top-0 border-b border-[#d5b070]/20 bg-[#0a0f1c]/90 backdrop-blur-lg"
          style={{ zIndex: Z_INDEX.STICKY }}
        >
          <nav
            aria-label="Main"
            className="max-w-7xl mx-auto px-4 sm:px-6 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2 text-[#eaeefa] no-underline"
            >
              <ArrowLeft className="h-[18px] w-[18px] text-[#d5b070]" aria-hidden="true" />
              Back to home
            </Link>
            <Link to="/" aria-label="Infinite Realms, home" className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#4fb6c4]" aria-hidden="true" />
              <span className="font-heading text-xl tracking-[0.2em] text-[#eaeefa]">
                INFINITE <span className="text-[#d5b070]">REALMS</span>
              </span>
            </Link>
          </nav>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {/* Page Title (Table 12, PublicExplore board) */}
          <div className="mb-6 text-center sm:mb-10">
            <h1 className="font-heading text-[2rem] min-[700px]:text-[54px] font-bold leading-tight text-[#f3deb0] mb-3">
              Explore adventures
            </h1>
            <p className="mx-auto max-w-[640px] text-[17px] leading-relaxed text-[#aab3cc]">
              Ready-made campaigns for one player and an AI Dungeon Master. Pick one and play
              tonight.
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
            <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3 lg:gap-10">
              {campaigns.map((campaign, index) => (
                <BoxedCampaign key={campaign.id} campaign={campaign} isFirst={index === 0} />
              ))}
            </div>
          )}

          {!isLoading && !error && campaigns.length > 0 && (
            <p className="mt-10 text-center text-base text-muted-foreground">
              More adventures are on the way.
            </p>
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
