/**
 * Final CTA Section - Massive Impact with Parallax
 *
 * PURPOSE: Create final urgency and exclusivity for beta waitlist signup
 * Features: Parallax background, large centered CTA, simplified messaging
 */

import { ArrowRight } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';

import { WaitlistForm } from './WaitlistForm';

import { Button } from '@/components/ui/button';
import { launchPageContent } from '@/data/launchPageContent';

export const FinalCTASection: React.FC = () => {
  const { finalCTA } = launchPageContent;
  const [showForm, setShowForm] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  // Parallax scroll effect
  useEffect(() => {
    const handleScroll = () => {
      if (sectionRef.current) {
        const rect = sectionRef.current.getBoundingClientRect();
        const scrolled = window.scrollY;
        // Move background at different speed than content
        const rate = scrolled * 0.3;
        setScrollY(rate);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  /**
   * Handle CTA click
   */
  const handleGetAccess = () => {
    setShowForm(true);

    // Track analytics
    if (window.gtag) {
      window.gtag('event', 'final_cta_click', {
        event_category: 'conversion',
        event_label: 'Final CTA - Request Early Access',
      });
    }
  };

  return (
    <section
      ref={sectionRef}
      className="relative py-40 overflow-hidden"
    >
      {/* Parallax Background with hero-bg-v2.jpg */}
      <div
        className="absolute inset-0 z-0"
        style={{ transform: `translateY(${scrollY * 0.5}px)` }}
      >
        <img
          src="/hero-bg-v2.jpg"
          alt="Epic fantasy background"
          className="w-full h-full object-cover scale-110"
        />
        {/* Heavy dimming overlay */}
        <div className="absolute inset-0 bg-gray-900/90"></div>
      </div>

      <div className="max-w-5xl mx-auto px-6 relative z-10">
        {/* Main CTA Content - Centered */}
        <div className="text-center mb-16">
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-8 leading-tight">
            {finalCTA.headline}
          </h2>
          <p className="text-2xl sm:text-3xl text-gray-200 mb-10 max-w-4xl mx-auto font-light leading-relaxed">
            {finalCTA.description}
          </p>
        </div>

        {/* Massive CTA Button - Centered */}
        <div className="text-center mb-20">
          {!showForm ? (
            <div className="space-y-8">
              <Button
                size="lg"
                onClick={handleGetAccess}
                className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white px-16 py-8 rounded-xl shadow-[0_0_40px_rgba(251,191,36,0.4)] hover:shadow-[0_0_60px_rgba(251,191,36,0.6)] transition-all duration-300 flex items-center gap-4 text-2xl font-bold mx-auto hover:scale-105"
              >
                <span>{finalCTA.cta}</span>
                <ArrowRight className="w-8 h-8" />
              </Button>

              <p className="text-gray-300 text-xl font-medium">
                Join the adventure. Shape the future.
              </p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto">
              <div className="mb-8 text-center">
                <h3 className="text-3xl font-bold text-white mb-3">Join the Beta Waitlist</h3>
                <p className="text-gray-300 text-lg">Secure your early access to the AI Dungeon Master</p>
              </div>
              <WaitlistForm variant="section" />
            </div>
          )}
        </div>

        {/* What Happens Next - Simplified */}
        <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 border border-purple-500/30 rounded-2xl p-10 backdrop-blur-md">
          <h3 className="text-3xl font-bold text-white mb-10 text-center">
            What Happens After You Join?
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white font-bold text-2xl shadow-lg shadow-purple-500/30">
                1
              </div>
              <h4 className="text-xl font-semibold text-white mb-3">Email Confirmation</h4>
              <p className="text-gray-300 text-base leading-relaxed">
                You'll receive a confirmation email with your waitlist number and next steps.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white font-bold text-2xl shadow-lg shadow-amber-500/30">
                2
              </div>
              <h4 className="text-xl font-semibold text-white mb-3">Beta Invitations</h4>
              <p className="text-gray-300 text-base leading-relaxed">
                We'll send beta invitations on a first-come, first-served basis as spots open up.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white font-bold text-2xl shadow-lg shadow-purple-500/30">
                3
              </div>
              <h4 className="text-xl font-semibold text-white mb-3">Early Access</h4>
              <p className="text-gray-300 text-base leading-relaxed">
                Get early access to new features and direct influence on product development.
              </p>
            </div>
          </div>
        </div>

        {/* Final Urgency Message */}
        <div className="mt-16 text-center p-10 bg-gradient-to-r from-amber-900/30 to-purple-900/30 border border-amber-500/30 rounded-xl backdrop-blur-sm">
          <p className="text-amber-400 text-2xl font-semibold mb-4">⏰ Limited Beta Spots Available</p>
          <p className="text-gray-200 text-lg leading-relaxed max-w-3xl mx-auto">
            The earlier you join our waitlist, the sooner you'll get access to the AI Dungeon Master and secure your founding member perks.
          </p>
        </div>
      </div>
    </section>
  );
};
