/**
 * Features Section - Image-Based Feature Cards
 *
 * PURPOSE: Showcase what we're building with epic fantasy imagery
 * Features: Image backgrounds, status badges, heavy gradients for readability
 */

import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Z_INDEX } from '@/constants/z-index';
import { launchPageContent } from '@/data/launchPageContent';

export const FeaturesSection: React.FC = () => {
  const { features } = launchPageContent;

  /**
   * Map features to background images
   */
  const getFeatureImage = (title: string) => {
    // Map each feature to its unique image
    const imageMap: Record<string, string> = {
      'Stories That Remember You': '/feature-statue.jpg',
      'Living Fantasy Worlds': '/feature-world.jpg',
      'NPCs With Real Memory': '/feature-npc.jpg',
      'Seamless D&D Rules': '/feature-rules.jpg',
      'Immersive Voice Acting': '/feature-voice.jpg',
    };

    return imageMap[title] || '/feature-story.jpg';
  };

  /**
   * Get status styling
   */
  const getStatusStyling = (status: string) => {
    switch (status) {
      case 'live':
        return {
          badge: 'bg-[#121b30] text-[#d5b070] border-[#d5b070] backdrop-blur-md',
        };
      case 'in_development':
        return {
          badge: 'bg-[#121b30] text-[#98a3c2] border-[rgba(213,176,112,0.35)] backdrop-blur-md',
        };
      case 'beta':
        return {
          badge: 'bg-infinite-gold/20 text-infinite-gold border-infinite-gold/30 backdrop-blur-md',
        };
      case 'planned':
        return {
          badge: 'bg-gray-500/20 text-gray-300 border-gray-500/30 backdrop-blur-md',
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
      case 'live':
        return 'Live now';
      case 'in_development':
        return 'In Development';
      case 'beta':
        return 'Beta Ready';
      case 'planned':
        return 'Planned';
      default:
        return 'Planned';
    }
  };

  return (
    <section className="relative py-24 bg-infinite-dark">
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
            const backgroundImage = getFeatureImage(feature.title);

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
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent"></div>

                {/* Status Badge */}
                <div className="absolute top-4 left-4" style={{ zIndex: Z_INDEX.DROPDOWN }}>
                  <Badge className={`${styling.badge} border`}>
                    {getStatusLabel(feature.status)}
                  </Badge>
                </div>

                {/* Content - Positioned at Bottom */}
                <div
                  className="absolute bottom-0 left-0 right-0 p-8"
                  style={{ zIndex: Z_INDEX.DROPDOWN }}
                >
                  <h3 className="text-2xl font-bold text-white mb-3 group-hover:text-infinite-gold transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-gray-200 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <p className="text-gray-400 text-lg mb-4">Want a say in what comes next?</p>
          <p className="text-[#d5b070] font-semibold">
            Play, then tell us what to build next. Use Contact Us or Discord.
          </p>
        </div>
      </div>
    </section>
  );
};
