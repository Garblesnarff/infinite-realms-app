/**
 * Pricing Section - Free vs Legend
 *
 * PURPOSE: Show the real plans and limits before a visitor commits.
 * Copy lives in launchPageContent.pricing; limits mirror the server quota config.
 */

import { Check } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

import { launchPageContent } from '@/data/launchPageContent';

export const PricingSection: React.FC = () => {
  const { pricing } = launchPageContent;

  return (
    <section id="pricing" className="relative py-24 bg-infinite-dark">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">{pricing.headline}</h2>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto">{pricing.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {pricing.plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-8 border bg-[#0c1220] ${
                plan.highlighted ? 'border-infinite-gold/60' : 'border-white/10'
              }`}
            >
              <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
              <p className="text-4xl font-bold text-white mb-1">
                {plan.price}
                {plan.cadence && (
                  <span className="text-lg font-normal text-gray-400"> {plan.cadence}</span>
                )}
              </p>
              <p className="text-gray-400 mb-6">{plan.description}</p>
              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-gray-200">
                    <Check className="w-5 h-5 text-infinite-gold mt-0.5 flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/explore"
                data-track-cta={`pricing_${plan.name.toLowerCase()}`}
                className="block text-center px-6 py-3 rounded-lg font-bold bg-gradient-to-b from-[#f6e3b8] via-[#d5b070] to-[#c69d57] text-[#1a1206] border border-[#f3deb0] hover:brightness-110 transition-all"
              >
                {plan.highlighted ? 'Start free, upgrade later' : 'Play free'}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-gray-400">{pricing.note}</p>
      </div>
    </section>
  );
};
