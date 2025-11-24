/**
 * Features Section - Image-Based Feature Cards
 *
 * PURPOSE: Showcase what we're building with epic fantasy imagery
 * Features: Image backgrounds, status badges, heavy gradients for readability
 */

import React from 'react';

import { Badge } from '@/components/ui/badge';
import { launchPageContent } from '@/data/launchPageContent';

export const FeaturesSection: React.FC = () => {
  const { features } = launchPageContent;

  /**
   * Map features to background images
   */
  const getFeatureImage = (index: number, title: string) => {
    // Alternate between story and NPC images based on feature type
    const lowerTitle = title.toLowerCase();

    if (lowerTitle.includes('story') || lowerTitle.includes('narrative') || lowerTitle.includes('campaign')) {
      return '/feature-story.jpg';
    } else if (lowerTitle.includes('npc') || lowerTitle.includes('character') || lowerTitle.includes('party')) {
      return '/feature-npc.jpg';
    }

    // Alternate for other features
    return index % 2 === 0 ? '/feature-story.jpg' : '/feature-npc.jpg';
  };

  /**
   * Get status styling
   */
  const getStatusStyling = (status: string) => {
    switch (status) {
      case 'in_development':
        return {
          badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30 backdrop-blur-md',
        };
      case 'beta':
        return {
          badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30 backdrop-blur-md',
        };
      case 'planned':
        return {
          badge: 'bg-gray-500/20 text-gray-300 border-gray-500/30 backdrop-blur-md',
        };
      case 'coming_soon':
        return {
          badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30 backdrop-blur-md',
        };
      default:
        return {
          badge: 'bg-gray-500/20 text-gray-300 border-gray-500/30 backdrop-blur-md',
        };
    }
  };

  /**
   * Get status label
   */
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'in_development':
        return 'In Development';
      case 'beta':
        return 'Beta Ready';
      case 'planned':
        return 'Planned';
      case 'coming_soon':
        return 'Coming Soon';
      default:
        return 'Planned';
    }
  };

  return (
    <section className="relative py-24 bg-gradient-to-b from-gray-900 to-purple-900/30">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
            {features.headline}
          </h2>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto">{features.subtitle}</p>
        </div>

        {/* Features Grid - Image Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.features.map((feature, index) => {
            const styling = getStatusStyling(feature.status);
            const backgroundImage = getFeatureImage(index, feature.title);

            return (
              <div
                key={index}
                className="relative group h-[400px] rounded-2xl overflow-hidden transition-all duration-300 hover:transform hover:scale-105 hover:shadow-2xl"
              >
                {/* Background Image */}
                <div className="absolute inset-0">
                  <img
                    src={backgroundImage}
                    alt={feature.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                </div>

                {/* Heavy Black Gradient Overlay (Bottom to Top) */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent"></div>

                {/* Status Badge */}
                <div className="absolute top-4 left-4 z-10">
                  <Badge className={`${styling.badge} border`}>
                    {getStatusLabel(feature.status)}
                  </Badge>
                </div>

                {/* Content - Positioned at Bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-8 z-10">
                  <h3 className="text-2xl font-bold text-white mb-3 group-hover:text-amber-400 transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-gray-200 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <p className="text-gray-400 text-lg mb-4">
            Want to influence which features we prioritize?
          </p>
          <p className="text-purple-400 font-semibold">
            Join the beta and help shape the future of AI Dungeon Master
          </p>
        </div>
      </div>
    </section>
  );
};
