/**
 * Early Access Section - Founding Adventurer Perks
 *
 * PURPOSE: Replace pricing with beta incentives and early adopter value proposition
 * Features: Founding member perks, clear beta limitations, urgency messaging
 */

import { Crown, Star, Zap, MessageCircle } from 'lucide-react';
import React from 'react';

import { WaitlistForm } from './WaitlistForm';

import { Button } from '@/components/ui/button';
import { launchPageContent } from '@/data/launchPageContent';

export const EarlyAccessSection: React.FC = () => {
  const { earlyAccess } = launchPageContent;

  return (
    <section className="relative py-24 bg-gradient-to-b from-purple-900/30 to-gray-900">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
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
                <div className="absolute inset-0 bg-gradient-to-br from-amber-600/20 to-purple-600/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative bg-gradient-to-br from-gray-800/50 to-gray-900/50 border border-gray-700/50 rounded-2xl p-6 backdrop-blur-sm hover:border-amber-500/40 transition-all duration-300 text-center">
                  <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <IconComponent className="w-7 h-7 text-gray-900" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{perk.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{perk.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Waitlist CTA */}
        <div className="max-w-2xl mx-auto mb-16">
          <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 border border-gray-700/50 rounded-2xl p-8 backdrop-blur-sm">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-white mb-2">
                Ready to Become a Founding Adventurer?
              </h3>
              <p className="text-gray-400">
                Join our exclusive beta waitlist and secure your perks
              </p>
            </div>
            <WaitlistForm variant="section" />
          </div>
        </div>

        {/* Disclaimer */}
        <div className="max-w-4xl mx-auto">
          <div className="p-6 bg-gray-800/20 border border-gray-700/30 rounded-xl">
            <p className="text-sm text-gray-400 text-center leading-relaxed">
              <span className="text-amber-400 font-semibold">Note:</span> {earlyAccess.disclaimer}
            </p>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <p className="text-gray-400 text-lg mb-6">
            Don't miss your chance to be part of the founding team
          </p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-gray-900 font-bold px-8 py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
          >
            {earlyAccess.cta}
          </Button>
        </div>
      </div>
    </section>
  );
};
