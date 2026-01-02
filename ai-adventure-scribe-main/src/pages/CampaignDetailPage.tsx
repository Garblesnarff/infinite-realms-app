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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useStarterCampaign } from '@/hooks/use-starter-campaigns';

/**
 * Get difficulty badge styling
 */
function getDifficultyStyle(difficulty: string): string {
  switch (difficulty) {
    case 'easy':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case 'low-medium':
      return 'bg-lime-500/20 text-lime-300 border-lime-500/30';
    case 'medium':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'medium-hard':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
    case 'hard':
      return 'bg-red-500/20 text-red-300 border-red-500/30';
    case 'deadly':
      return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
    default:
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  }
}

/**
 * Format difficulty for display
 */
function formatDifficulty(difficulty: string): string {
  return difficulty
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get genre badge styling
 */
function getGenreStyle(genre: string): string {
  const genreStyles: Record<string, string> = {
    horror: 'bg-red-900/30 text-red-200 border-red-700/30',
    intrigue: 'bg-purple-900/30 text-purple-200 border-purple-700/30',
    mystery: 'bg-indigo-900/30 text-indigo-200 border-indigo-700/30',
    adventure: 'bg-amber-900/30 text-amber-200 border-amber-700/30',
    fantasy: 'bg-blue-900/30 text-blue-200 border-blue-700/30',
    dark: 'bg-slate-900/30 text-slate-200 border-slate-700/30',
    political: 'bg-violet-900/30 text-violet-200 border-violet-700/30',
    social: 'bg-pink-900/30 text-pink-200 border-pink-700/30',
  };

  return genreStyles[genre.toLowerCase()] || 'bg-gray-900/30 text-gray-200 border-gray-700/30';
}

const CampaignDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { campaign, isLoading, error } = useStarterCampaign(slug);

  // Default banner placeholder
  const bannerImage =
    campaign?.bannerImageUrl ||
    campaign?.coverImageUrl ||
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&h=600&fit=crop';

  const handleStartAdventure = () => {
    if (!user) {
      // TODO: Redirect to auth with return URL
      navigate('/auth/callback');
      return;
    }

    // TODO: Navigate to character selection for this campaign
    // For now, just go to the app
    navigate('/app');
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
        {campaign.coverImageUrl && (
          <meta property="og:image" content={campaign.coverImageUrl} />
        )}
      </Helmet>

      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900">
        {/* Hero Banner */}
        <div className="relative h-[50vh] min-h-[400px]">
          <div className="absolute inset-0">
            <img
              src={bannerImage}
              alt={`${campaign.title} banner`}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />

          {/* Back Button */}
          <div className="absolute top-6 left-6 z-20">
            <Link
              to="/"
              className="flex items-center gap-2 text-white/80 hover:text-white transition-colors bg-black/30 backdrop-blur-sm rounded-full px-4 py-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back
            </Link>
          </div>

          {/* Title Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-8 z-10">
            <div className="max-w-4xl mx-auto">
              {/* Badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                {campaign.genre.map((g) => (
                  <Badge
                    key={g}
                    className={`${getGenreStyle(g)} border backdrop-blur-sm capitalize`}
                  >
                    {g}
                  </Badge>
                ))}
                <Badge
                  className={`${getDifficultyStyle(campaign.difficulty)} border backdrop-blur-sm`}
                >
                  {formatDifficulty(campaign.difficulty)}
                </Badge>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
                {campaign.title}
              </h1>

              {campaign.tagline && (
                <p className="text-xl text-gray-300 italic">{campaign.tagline}</p>
              )}
            </div>
          </div>
        </div>

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

          {/* Overview (if available) */}
          {campaign.overview && (
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-white mb-4">Campaign Overview</h2>
              <div className="prose prose-invert prose-lg max-w-none">
                <p className="text-gray-300 leading-relaxed whitespace-pre-line">
                  {campaign.overview}
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
                className="bg-gradient-to-r from-purple-600 to-amber-600 hover:from-purple-500 hover:to-amber-500 text-white px-8 py-6 text-lg font-semibold rounded-xl"
              >
                Start Your Adventure
              </Button>
              <Link to="/#starter-campaigns">
                <Button
                  variant="outline"
                  className="border-gray-600 text-gray-300 hover:bg-gray-800 px-8 py-6 text-lg rounded-xl"
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
