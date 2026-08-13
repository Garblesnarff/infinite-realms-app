import React from 'react';
import { Link } from 'react-router-dom';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';

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

interface CampaignDetailHeroProps {
  campaign: StarterCampaign;
  bannerImage: string;
  artworkUnavailable: boolean;
  onBannerImageError: () => void;
  onStartAdventure: () => Promise<void>;
  isStarting: boolean;
}

/**
 * Hero section for the Campaign Detail Page
 */
export const CampaignDetailHero: React.FC<CampaignDetailHeroProps> = ({
  campaign,
  bannerImage,
  artworkUnavailable,
  onBannerImageError,
  onStartAdventure,
  isStarting,
}) => {
  return (
    <div className="relative h-[50vh] min-h-[400px]">
      <div className="absolute inset-0">
        <img
          src={bannerImage}
          alt={
            artworkUnavailable
              ? `${campaign.title} artwork coming soon`
              : `${campaign.title} banner`
          }
          className={`w-full h-full object-cover ${artworkUnavailable ? 'opacity-80' : ''}`}
          onError={onBannerImageError}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />

      {artworkUnavailable && (
        <div
          className="absolute right-6 top-6 rounded-full border border-white/15 bg-slate-950/45 px-3 py-1 text-xs font-medium text-gray-200/90 backdrop-blur-sm"
          role="status"
          style={{ zIndex: Z_INDEX.CARD_HOVER }}
        >
          Artwork coming soon
        </div>
      )}

      {/* Back Button */}
      <div className="absolute top-6 left-6" style={{ zIndex: Z_INDEX.CARD_HOVER }}>
        <Link
          to="/explore"
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
          Back to Campaigns
        </Link>
      </div>

      {/* Title Overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-8" style={{ zIndex: Z_INDEX.DROPDOWN }}>
        <div className="max-w-4xl mx-auto">
          {/* Badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            {campaign.genre.map((g) => (
              <Badge key={g} className={`${getGenreStyle(g)} border backdrop-blur-sm capitalize`}>
                {g}
              </Badge>
            ))}
            <Badge className={`${getDifficultyStyle(campaign.difficulty)} border backdrop-blur-sm`}>
              {formatDifficulty(campaign.difficulty)}
            </Badge>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
            {campaign.title}
          </h1>

          {campaign.tagline && (
            <p className="text-xl text-gray-300 italic mb-6">{campaign.tagline}</p>
          )}

          {/* Hero CTA - visible without scrolling */}
          <Button
            onClick={onStartAdventure}
            disabled={isStarting}
            size="lg"
            className="bg-gradient-to-r from-purple-600 to-amber-600 hover:from-purple-500 hover:to-amber-500 text-white px-8 py-6 text-lg font-semibold rounded-xl shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-all disabled:opacity-50"
          >
            {isStarting ? 'Preparing Your Adventure...' : 'Start Your Adventure'}
          </Button>
        </div>
      </div>
    </div>
  );
};
