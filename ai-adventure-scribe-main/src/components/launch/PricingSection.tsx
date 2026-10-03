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
    <section id="pricing" className="relative py-24 bg-gray-900">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">{pricing.headline}</h2>
          <p className="text-xl text-gray-400 max-w-3xl mx-auto">{pricing.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {pricing.plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-8 border bg-gradient-to-br from-gray-800/50 to-gray-900/50 ${
                plan.highlighted ? 'border-amber-500/60' : 'border-gray-700/50'
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
                    <Check className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/explore"
                data-track-cta={`pricing_${plan.name.toLowerCase()}`}
                className="block text-center px-6 py-3 rounded-lg font-bold bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-400 hover:to-orange-500 transition-colors"
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
