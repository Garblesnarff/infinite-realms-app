/**
 * Roadmap Section - Clear Beta Phases
 *
 * PURPOSE: Show transparent development timeline with clear phases and timelines
 * Features: Visual roadmap, status indicators, feature lists per phase
 */

import { CheckCircle, Clock, Calendar } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { launchPageContent } from '@/data/launchPageContent';

export const RoadmapSection: React.FC = () => {
  const { roadmap } = launchPageContent;

  /**
   * Get status styling for phases
   */
  const getPhaseStyling = (status: string) => {
    switch (status) {
      case 'current':
        return {
          badge: 'bg-[#121b30] text-[#d5b070] border-[#d5b070]',
          icon: 'text-infinite-gold',
          bg: 'bg-[#121b30] border-[#d5b070]/30',
          glow: 'shadow-[0_0_20px_rgba(213,176,112,0.2)]',
        };
      case 'upcoming':
        return {
          badge: 'bg-[#0c1220] text-[#98a3c2] border-[rgba(213,176,112,0.35)]',
          icon: 'text-gray-400',
          bg: 'bg-[#0c1220] border-[rgba(213,176,112,0.35)]',
          glow: '',
        };
      case 'completed':
        return {
          badge: 'bg-green-500/20 text-green-300 border-green-500/30',
          icon: 'text-green-400',
          bg: 'bg-[#0c1220] border-green-500/20',
          glow: '',
        };
      default:
        return {
          badge: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
          icon: 'text-gray-400',
          bg: 'bg-[#0c1220] border-gray-500/20',
          glow: '',
        };
    }
  };

  return (
    <section className="relative py-24 bg-infinite-dark">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
            {roadmap.headline}
          </h2>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto">{roadmap.subtitle}</p>
        </div>

        {/* Roadmap */}
        <div className="max-w-6xl mx-auto">
          <div className="space-y-8">
            {roadmap.phases.map((phase, index) => {
              const styling = getPhaseStyling(phase.status);

              return (
                <div key={index} className="relative">
                  {/* Timeline Line */}
                  {index < roadmap.phases.length - 1 && (
                    <div className="absolute left-8 top-16 w-0.5 h-16 bg-gradient-to-b from-[#d5b070] to-transparent hidden lg:block"></div>
                  )}

                  {/* Phase Card */}
                  <div
                    className={`relative ${styling.bg} rounded-2xl p-8 backdrop-blur-sm border transition-all duration-300 ${styling.glow}`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                      {/* Phase Header */}
                      <div className="flex items-start gap-4">
                        {/* Phase Marker - Aligned to top (a status icon: phases are
                            "Now"/"Next", not numbers, so there is no number to show) */}
                        <div
                          className={`w-16 h-16 flex-shrink-0 rounded-full flex items-center justify-center ${
                            phase.status === 'current'
                              ? 'bg-gradient-to-br from-[#d5b070] to-[#b9954f] text-[#1a1206]'
                              : 'bg-gray-600 text-white'
                          }`}
                        >
                          {phase.status === 'current' || phase.status === 'completed' ? (
                            <CheckCircle className="w-8 h-8" />
                          ) : (
                            <Clock className="w-8 h-8" />
                          )}
                        </div>

                        {/* Phase Info */}
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-3 mb-2">
                            <h3 className="text-2xl font-bold text-white">{phase.title}</h3>
                            <Badge className={`${styling.badge} border`}>
                              {phase.status === 'current' && (
                                <>
                                  <Clock className="w-3 h-3 mr-1" />
                                  Live now
                                </>
                              )}
                              {phase.status === 'upcoming' && 'Planned'}
                              {phase.status === 'completed' && (
                                <>
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  Completed
                                </>
                              )}
                            </Badge>
                          </div>
                          <p className="text-gray-400 mb-2 leading-relaxed">{phase.description}</p>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Calendar className="w-4 h-4" />
                            <span>{phase.timeline}</span>
                          </div>
                        </div>
                      </div>

                      {/* Features List - Fixed width, vertical layout */}
                      <div className="lg:min-w-[280px] lg:w-1/3">
                        <h4 className="text-lg font-semibold text-white mb-4">What it includes</h4>
                        <div className="flex flex-col gap-3">
                          {phase.features.map((feature, featureIndex) => (
                            <div key={featureIndex} className="flex items-start gap-3">
                              <span
                                className={`${styling.icon} flex-shrink-0 text-lg leading-relaxed`}
                              >
                                •
                              </span>
                              <span className="text-gray-300 text-sm leading-relaxed whitespace-normal">
                                {feature}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timeline Note */}
          <div className="mt-16 p-6 bg-[#0c1220] border border-white/10 rounded-xl">
            <div className="flex items-start gap-4">
              <Clock className="w-6 h-6 text-infinite-gold flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Timeline Updates</h3>
                <p className="text-gray-400 leading-relaxed">
                  This list can change. We give no dates until we can keep them.
                </p>
              </div>
            </div>
          </div>

          {/* Call to Action */}
          <div className="mt-16 text-center">
            <p className="text-gray-400 text-lg mb-4">Want a say in what comes next?</p>
            <p className="text-[#d5b070] font-semibold">
              Play, then tell us what to build next. Use Contact Us or Discord.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
