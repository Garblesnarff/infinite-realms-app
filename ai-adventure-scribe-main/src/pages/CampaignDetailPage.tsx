/**
 * Campaign Detail Page
 *
 * Displays full details for a starter campaign including:
 * - Banner image and overview
 * - Genre, difficulty, and session info
 * - Campaign premise and description
 * - Call to action to start playing
 *
 * Route: /explore/:slug
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { CAMPAIGN_ARTWORK_PLACEHOLDER } from '@/components/campaigns/campaign-artwork';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { CampaignDetailHero } from '@/features/campaign/components/view/sections/CampaignDetailHero';
import { useStarterCampaign } from '@/hooks/use-starter-campaigns';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { resolveOrCreateStarterCampaign } from '@/services/starter-campaign-bootstrap';
import { userDataApi } from '@/services/user-data-api';

const CampaignDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { campaign, isLoading, error } = useStarterCampaign(slug);
  const [isStarting, setIsStarting] = React.useState(false);
  const campaignBannerImage = campaign?.bannerImageUrl || campaign?.coverImageUrl || null;
  const [bannerImage, setBannerImage] = React.useState(
    campaignBannerImage || CAMPAIGN_ARTWORK_PLACEHOLDER,
  );
  const [artworkUnavailable, setArtworkUnavailable] = React.useState(!campaignBannerImage);

  React.useEffect(() => {
    setBannerImage(campaignBannerImage || CAMPAIGN_ARTWORK_PLACEHOLDER);
    setArtworkUnavailable(!campaignBannerImage);
  }, [campaignBannerImage]);

  const handleBannerImageError = (): void => {
    if (bannerImage === CAMPAIGN_ARTWORK_PLACEHOLDER) return;
    setBannerImage(CAMPAIGN_ARTWORK_PLACEHOLDER);
    setArtworkUnavailable(true);
  };

  /**
   * Start adventure flow:
   * 1. Check for existing campaign linked to this starter
   * 2. If none, create a shadow campaign for the user
   * 3. Navigate to character creation for that campaign
   */
  const handleStartAdventure = async (): Promise<void> => {
    if (!user) {
      // Redirect to auth with return URL
      navigate(`/auth/callback?returnTo=${encodeURIComponent(`/explore/${slug}`)}`);
      return;
    }

    if (!campaign) {
      return;
    }

    setIsStarting(true);

    try {
      const campaignId = await resolveOrCreateStarterCampaign(campaign, userDataApi, (message) =>
        logger.info(message),
      );

      toast({
        title: 'Adventure Awaits!',
        description: 'Choose your character to begin your journey.',
      });

      // Navigate to character selection page
      // Users can pick a pre-built character or create a custom one
      navigate(`/explore/${slug}/choose-character?campaignId=${campaignId}`);
    } catch (err) {
      logger.error('Error starting adventure:', err);
      toast({
        title: 'Error',
        description: 'Failed to start adventure. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsStarting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900">
        <div className="h-[50vh] bg-gray-800/50 animate-pulse" />
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="h-12 bg-gray-800/50 rounded animate-pulse mb-4" />
          <div className="h-6 bg-gray-800/50 rounded animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  // Error or not found
  if (error || !campaign) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-center px-6">
          <h1 className="text-4xl font-bold text-white mb-4">Campaign Not Found</h1>
          <p className="text-gray-400 mb-8">
            The campaign you're looking for doesn't exist or isn't available yet.
          </p>
          <Link to="/" className="text-purple-400 hover:text-purple-300 underline">
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{campaign.title} | Infinite Realms</title>
        <meta name="description" content={campaign.premise} />
        <meta property="og:title" content={`${campaign.title} | Infinite Realms`} />
        <meta property="og:description" content={campaign.premise} />
        {campaign.coverImageUrl && <meta property="og:image" content={campaign.coverImageUrl} />}
      </Helmet>

      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900">
        <CampaignDetailHero
          campaign={campaign}
          bannerImage={bannerImage}
          artworkUnavailable={artworkUnavailable}
          onBannerImageError={handleBannerImageError}
          onStartAdventure={handleStartAdventure}
          isStarting={isStarting}
        />

        {/* Content */}
        <div className="max-w-4xl mx-auto px-6 py-12">
          {/* Meta Info Row */}
          <div className="flex flex-wrap gap-6 text-gray-400 mb-8 pb-8 border-b border-gray-800">
            {campaign.levelRange && (
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-purple-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <span>Level {campaign.levelRange}</span>
              </div>
            )}
            {campaign.estimatedSessions && (
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-purple-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{campaign.estimatedSessions} sessions</span>
              </div>
            )}
            {campaign.tone.length > 0 && (
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-purple-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                  />
                </svg>
                <span className="capitalize">{campaign.tone.slice(0, 3).join(', ')}</span>
              </div>
            )}
          </div>

          {/* Premise */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-white mb-4">The Story</h2>
            <p className="text-lg text-gray-300 leading-relaxed">{campaign.premise}</p>
          </div>

          {/* Overview - show only a polished intro, not the full campaign bible */}
          {campaign.overview && (
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-white mb-4">What Awaits You</h2>
              <div className="prose prose-invert prose-lg max-w-none">
                <p className="text-gray-300 leading-relaxed whitespace-pre-line">
                  {/* Extract first section (before ## or first 800 chars) for a polished preview */}
                  {campaign.overview.split(/\n##/)[0].slice(0, 800).trim()}
                  {campaign.overview.length > 800 && '...'}
                </p>
              </div>
            </div>
          )}

          {/* CTA Section */}
          <div className="bg-gradient-to-r from-purple-900/50 to-gray-900/50 rounded-2xl p-8 border border-purple-500/20">
            <h2 className="text-2xl font-bold text-white mb-4">Ready to Begin?</h2>
            <p className="text-gray-300 mb-6">
              Choose your character and step into {campaign.title}. Your choices will shape the
              story, and your legend awaits.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button
                onClick={handleStartAdventure}
                disabled={isStarting}
                className="bg-gradient-to-r from-purple-600 to-amber-600 hover:from-purple-500 hover:to-amber-500 text-white px-8 py-6 text-lg font-semibold rounded-xl disabled:opacity-50"
              >
                {isStarting ? 'Preparing Your Adventure...' : 'Start Your Adventure'}
              </Button>
              <Link to="/#starter-campaigns">
                <Button
                  variant="outline"
                  className="border-gray-600 bg-transparent text-gray-300 hover:bg-gray-800 px-8 py-6 text-lg rounded-xl"
                >
                  Browse Other Campaigns
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 py-8">
          <div className="max-w-4xl mx-auto px-6 text-center text-gray-500 text-sm">
            <p>
              <Link to="/" className="hover:text-purple-400 transition-colors">
                Infinite Realms
              </Link>{' '}
              - Where Every Choice Shapes Destiny
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default CampaignDetailPage;
