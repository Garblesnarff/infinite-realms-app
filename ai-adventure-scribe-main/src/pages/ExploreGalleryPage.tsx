/**
 * Explore Gallery Page - Browse All Starter Campaigns
 *
 * PURPOSE: Dedicated page for browsing all available pre-built starter campaigns
 * Route: /explore
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';

import { StarterCampaignCard } from '@/components/campaigns/StarterCampaignCard';
import { Button } from '@/components/ui/button';
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

      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900/20 to-gray-900">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-lg border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Home</span>
            </Link>
            <Link to="/" className="flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-purple-400" />
              <span className="text-xl font-bold text-white">InfiniteRealms</span>
            </Link>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-12">
          {/* Page Title */}
          <div className="text-center mb-16">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
              Explore Adventures
            </h1>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Discover professionally crafted campaigns ready for immediate play.
              Each adventure features rich storytelling, memorable characters, and
              unique challenges.
            </p>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-[450px] rounded-2xl bg-gray-800/50 animate-pulse"
                />
              ))}
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="text-center py-16">
              <p className="text-red-400 text-lg mb-4">
                Failed to load campaigns. Please try again later.
              </p>
              <Button onClick={() => window.location.reload()} variant="outline">
                Retry
              </Button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && campaigns.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-400 text-lg mb-4">
                No campaigns available yet. Check back soon!
              </p>
              <Link to="/">
                <Button variant="outline">Return Home</Button>
              </Link>
            </div>
          )}

          {/* Campaigns Grid */}
          {!isLoading && !error && campaigns.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {campaigns.map((campaign) => (
                <StarterCampaignCard key={campaign.id} campaign={campaign} />
              ))}
            </div>
          )}

          {/* Coming Soon */}
          <div className="mt-16 text-center border-t border-gray-800 pt-12">
            <h2 className="text-2xl font-bold text-white mb-4">More Adventures Coming Soon</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Our team is crafting new campaigns across different genres and themes.
              From epic fantasy quests to mysterious horror tales, there's an
              adventure for every player.
            </p>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-800 py-8 mt-12">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <p className="text-gray-500">
              &copy; {new Date().getFullYear()} InfiniteRealms. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
};

export default ExploreGalleryPage;
