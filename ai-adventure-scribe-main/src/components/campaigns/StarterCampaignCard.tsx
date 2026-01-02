/**
 * Starter Campaign Card Component
 *
 * Displays a starter campaign as a visually rich card with cover image,
 * genre badges, difficulty indicator, and call to action.
 */

import React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

interface StarterCampaignCardProps {
  campaign: StarterCampaign;
}

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

export const StarterCampaignCard: React.FC<StarterCampaignCardProps> = ({ campaign }) => {
  // Default placeholder if no cover image
  const coverImage =
    campaign.coverImageUrl ||
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&h=600&fit=crop';

  return (
    <Link
      to={`/explore/${campaign.slug}`}
      className="block group"
      aria-label={`Explore ${campaign.title} campaign`}
    >
      <div className="relative h-[450px] rounded-2xl overflow-hidden transition-all duration-300 hover:transform hover:scale-[1.02] hover:shadow-2xl hover:shadow-purple-500/20 border border-gray-800/50 hover:border-purple-500/30">
        {/* Background Image */}
        <div className="absolute inset-0">
          <img
            src={coverImage}
            alt={`${campaign.title} cover art`}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            loading="lazy"
          />
        </div>

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent"></div>

        {/* Genre Badges - Top Left */}
        <div className="absolute top-4 left-4 z-10 flex flex-wrap gap-2">
          {campaign.genre.slice(0, 2).map((g) => (
            <Badge
              key={g}
              className={`${getGenreStyle(g)} border backdrop-blur-sm capitalize`}
            >
              {g}
            </Badge>
          ))}
        </div>

        {/* Difficulty Badge - Top Right */}
        <div className="absolute top-4 right-4 z-10">
          <Badge className={`${getDifficultyStyle(campaign.difficulty)} border backdrop-blur-sm`}>
            {formatDifficulty(campaign.difficulty)}
          </Badge>
        </div>

        {/* Content - Bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-6 z-10">
          {/* Title */}
          <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-amber-400 transition-colors">
            {campaign.title}
          </h3>

          {/* Tagline */}
          {campaign.tagline && (
            <p className="text-gray-300 text-sm italic mb-3">{campaign.tagline}</p>
          )}

          {/* Premise */}
          <p className="text-gray-200 text-sm leading-relaxed line-clamp-2 mb-4">
            {campaign.premise}
          </p>

          {/* Meta Info */}
          <div className="flex items-center gap-4 text-xs text-gray-400">
            {campaign.levelRange && (
              <span className="flex items-center gap-1">
                <svg
                  className="w-4 h-4"
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
                Level {campaign.levelRange}
              </span>
            )}
            {campaign.estimatedSessions && (
              <span className="flex items-center gap-1">
                <svg
                  className="w-4 h-4"
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
                {campaign.estimatedSessions} sessions
              </span>
            )}
          </div>

          {/* CTA */}
          <div className="mt-4 flex items-center text-purple-400 group-hover:text-purple-300 transition-colors text-sm font-medium">
            <span>Begin Your Journey</span>
            <svg
              className="w-4 h-4 ml-2 transform transition-transform group-hover:translate-x-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default StarterCampaignCard;
