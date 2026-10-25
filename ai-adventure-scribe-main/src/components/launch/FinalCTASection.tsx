/**
 * Final CTA Section - Massive Impact with Parallax
 *
 * PURPOSE: Create final urgency and exclusivity for beta waitlist signup
 * Features: Parallax background, large centered CTA, simplified messaging
 */

import { ArrowRight } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { WaitlistForm } from './WaitlistForm';

import { Z_INDEX } from '@/constants/z-index';
import { launchPageContent } from '@/data/launchPageContent';

export const FinalCTASection: React.FC = () => {
  const { finalCTA } = launchPageContent;
  const [scrollY, setScrollY] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  // Parallax scroll effect
  useEffect(() => {
    const handleScroll = () => {
      if (sectionRef.current) {
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
   * Track CTA click
   */
  const handlePlayFree = () => {
    if (window.gtag) {
      window.gtag('event', 'final_cta_click', {
        event_category: 'conversion',
        event_label: 'Final CTA - Play free',
      });
    }
  };

  return (
    <section ref={sectionRef} className="relative py-40 overflow-hidden">
      {/* Parallax Background with hero-bg-v2.jpg */}
      <div
        className="absolute inset-0"
        style={{ transform: `translateY(${scrollY * 0.5}px)`, zIndex: Z_INDEX.BASE }}
      >
        <img
          src="/hero-bg-v2.jpg"
          alt="Epic fantasy background"
          className="w-full h-full object-cover scale-110"
        />
        {/* Heavy dimming overlay */}
        <div className="absolute inset-0 bg-gray-900/90"></div>
      </div>

      <div className="max-w-5xl mx-auto px-6 relative" style={{ zIndex: Z_INDEX.DROPDOWN }}>
        {/* Main CTA Content - Centered */}
        <div className="text-center mb-16">
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-8 leading-tight">
            {finalCTA.headline}
          </h2>
          <p className="text-2xl sm:text-3xl text-gray-200 mb-10 max-w-4xl mx-auto font-light leading-relaxed">
            {finalCTA.description}
          </p>
        </div>

        {/* Play CTA first, waitlist below it */}
        <div className="text-center mb-20">
          <Link
            to="/explore"
            onClick={handlePlayFree}
            data-track-cta="play_free_footer"
            className="inline-flex items-center gap-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white px-16 py-6 rounded-xl shadow-[0_0_40px_rgba(251,191,36,0.4)] hover:shadow-[0_0_60px_rgba(251,191,36,0.6)] transition-all duration-300 text-2xl font-bold hover:scale-105"
          >
            <span>{finalCTA.cta}</span>
            <ArrowRight className="w-8 h-8" />
          </Link>

          <div className="max-w-2xl mx-auto mt-16">
            <div className="mb-8 text-center">
              <h3 className="text-3xl font-bold text-white mb-3">Get news and updates</h3>
              <p className="text-gray-300 text-lg">
                Get an email when a new feature ships. You do not need it to play.
              </p>
            </div>
            <WaitlistForm variant="section" />
          </div>
        </div>

        {/* What Happens Next - Simplified */}
        <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 border border-[rgba(213,176,112,0.35)] rounded-2xl p-10 backdrop-blur-md">
          <h3 className="text-3xl font-bold text-white mb-10 text-center">
            What happens after you sign up?
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white font-bold text-2xl shadow-lg shadow-purple-500/30">
                1
              </div>
              <h4 className="text-xl font-semibold text-white mb-3">Confirm your email</h4>
              <p className="text-gray-300 text-base leading-relaxed">
                We send you a link. Click it to confirm.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white font-bold text-2xl shadow-lg shadow-amber-500/30">
                2
              </div>
              <h4 className="text-xl font-semibold text-white mb-3">News, not a queue</h4>
              <p className="text-gray-300 text-base leading-relaxed">
                We write when something new ships. There is no queue. You can play now.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white font-bold text-2xl shadow-lg shadow-purple-500/30">
                3
              </div>
              <h4 className="text-xl font-semibold text-white mb-3">Leave any time</h4>
              <p className="text-gray-300 text-base leading-relaxed">
                You can unsubscribe at any time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
