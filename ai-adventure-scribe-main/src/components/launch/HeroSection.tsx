import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

export const HeroSection: React.FC = () => {
  /**
   * Handle primary CTA click - scroll to waitlist form
   */
  const handleGetStarted = () => {
    const formSection = document.querySelector('[data-waitlist-form]');
    if (formSection) {
      formSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Track analytics
    if (window.gtag) {
      window.gtag('event', 'hero_cta_click', {
        event_category: 'engagement',
        event_label: 'Roll for Initiative',
      });
    }
  };

  /**
   * Handle secondary CTA click
   */
  const handleLearnMore = () => {
    const visionSection = document.getElementById('vision');
    if (visionSection) {
      visionSection.scrollIntoView({ behavior: 'smooth' });
    }

    // Track analytics
    if (window.gtag) {
      window.gtag('event', 'hero_secondary_cta', {
        event_category: 'engagement',
        event_label: 'Read the Vision',
      });
    }
  };

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img
          src="/hero-bg-v2.jpg"
          alt="Ancient ruins glowing with purple magic"
          className="w-full h-full object-cover"
        />
        {/* The "Readability" Gradient - Essential for text pop */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-900/90 via-purple-900/80 to-gray-900"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 text-center">

        {/* Beta Pill */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 backdrop-blur-md mb-8 animate-fade-in-up">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-purple-200">Closed Beta: Coming Soon</span>
        </div>

        {/* Main Headline */}
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight leading-tight drop-shadow-lg">
          THE <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-amber-500">5E CAMPAIGN</span> <br />
          THAT NEVER CANCELS
        </h1>

        {/* Subheadline - The Emotional Hook */}
        <p className="text-xl md:text-2xl text-gray-200 mb-10 max-w-3xl mx-auto leading-relaxed font-light">
          The tabletop adventures you've been wanting, now possible.
          An AI Game Master with <span className="text-white font-semibold">perfect memory</span>,
          <span className="text-white font-semibold"> professional voice acting</span>, and
          <span className="text-white font-semibold"> infinite patience</span>. No scheduling. No cancellations. Just play.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={handleGetStarted}
            className="group relative px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-600 rounded-lg text-white font-bold text-lg shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] transition-all transform hover:-translate-y-1"
          >
            <span className="flex items-center gap-2">
              Roll for Initiative (Join Beta)
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
          </button>

          <button
            onClick={handleLearnMore}
            className="px-8 py-4 bg-white/5 border border-white/10 rounded-lg text-gray-300 font-medium hover:bg-white/10 transition-colors backdrop-blur-sm"
          >
            Read the Vision
          </button>
        </div>

        {/* Social Proof / Trust Indicator */}
        <p className="mt-8 text-sm text-gray-400">
          Limited spots available for the Founder's Alpha.
        </p>
      </div>
    </section>
  );
};
