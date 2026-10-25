/**
 * Early Access Section - Help Shape Perks
 *
 * PURPOSE: Open-beta help-shape perks, with the Play free CTA (the email form
 * lives only in the final CTA now, so the page has exactly one signup form)
 * Features: Feedback perks, clear beta limitations
 */

import { Crown, Star, Zap, MessageCircle } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

import { launchPageContent } from '@/data/launchPageContent';

export const EarlyAccessSection: React.FC = () => {
  const { helpShape: earlyAccess } = launchPageContent;

  return (
    <section className="relative py-24 bg-infinite-dark">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
            {earlyAccess.headline}
          </h2>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto mb-6">{earlyAccess.subtitle}</p>
          <p className="text-lg text-gray-300 max-w-4xl mx-auto">{earlyAccess.description}</p>
        </div>

        {/* Perks Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {earlyAccess.perks.map((perk, index) => {
            const IconComponent =
              perk.icon === 'Crown'
                ? Crown
                : perk.icon === 'Star'
                  ? Star
                  : perk.icon === 'Zap'
                    ? Zap
                    : MessageCircle;

            return (
              <div key={index} className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-infinite-gold/20 to-infinite-teal/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative bg-[#0c1220] border border-white/10 rounded-2xl p-6 backdrop-blur-sm hover:border-infinite-gold/40 transition-all duration-300 text-center">
                  <div className="w-14 h-14 bg-gradient-to-br from-[#d5b070] to-[#b9954f] rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <IconComponent className="w-7 h-7 text-[#1a1206]" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{perk.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{perk.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Play CTA */}
        <div className="text-center mb-16">
          <Link
            to="/explore"
            data-track-cta="play_free_early_access"
            className="inline-flex items-center px-8 py-4 bg-gradient-to-b from-[#f6e3b8] via-[#d5b070] to-[#c69d57] text-[#1a1206] border border-[#f3deb0] font-bold rounded-xl shadow-lg hover:shadow-xl hover:brightness-110 transition-all duration-300"
          >
            {earlyAccess.cta}
          </Link>
        </div>

        {/* Disclaimer */}
        <div className="max-w-4xl mx-auto">
          <div className="p-6 bg-[#0c1220] border border-white/10 rounded-xl">
            <p className="text-sm text-gray-400 text-center leading-relaxed">
              <span className="text-infinite-gold font-semibold">Note:</span>{' '}
              {earlyAccess.disclaimer}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
