/**
 * Launch Page - Beta Launch Landing Page
 *
 * PURPOSE: Send visitors to play free at /explore; the email-list form sits below the Play CTA
 * Structure: Hero → Vision → Features → Pricing → Campaigns → Roadmap → Early Access → FAQ → Final CTA → Footer
 *
 * Key Principles:
 * - Future-oriented messaging (beta, planned features, roadmap)
 * - Transparent progress metrics instead of vanity numbers
 * - Clear beta positioning with the email list below Play free, not as the main path
 * - Legal compliance and accessibility
 */

import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

import { EarlyAccessSection } from '@/components/launch/EarlyAccessSection';
import { FAQSection } from '@/components/launch/FAQSection';
import { FeaturesSection } from '@/components/launch/FeaturesSection';
import { FinalCTASection } from '@/components/launch/FinalCTASection';
import { FooterSection } from '@/components/launch/FooterSection';
import { FounderStorySection } from '@/components/launch/FounderStorySection';
import { HeroSection } from '@/components/launch/HeroSection';
import { LaunchHeader } from '@/components/launch/LaunchHeader';
import { PricingSection } from '@/components/launch/PricingSection';
import { RoadmapSection } from '@/components/launch/RoadmapSection';
import { StarterCampaignsSection } from '@/components/launch/StarterCampaignsSection';
import { VisionSection } from '@/components/launch/VisionSection';

/**
 * Main Launch Page Component
 *
 * Features:
 * - SEO and OpenGraph meta tags
 * - Analytics tracking setup
 * - Accessibility compliance
 * - Performance optimizations
 */
const LaunchPage: React.FC = () => {
  useEffect(() => {
    // Track page view
    if (window.gtag) {
      window.gtag('event', 'page_view', {
        page_title: 'Infinite Realms – Launch page',
        page_location: window.location.href,
      });
    }
  }, []);

  return (
    <>
      {/* SEO and Meta Tags */}
      <Helmet>
        <title>Infinite Realms – Play a 5E campaign with an AI Game Master, free</title>
        <meta
          name="description"
          content="Play solo 5E adventures with an AI Game Master that remembers your story. Free to start. Open beta."
        />
        <meta
          name="keywords"
          content="Infinite Realms, AI Dungeon Master, D&D AI, tabletop RPG, fantasy gaming"
        />
        <meta name="robots" content="index, follow" />

        {/* OpenGraph Tags */}
        <meta
          property="og:title"
          content="Infinite Realms – Play a 5E campaign with an AI Game Master, free"
        />
        <meta
          property="og:description"
          content="Play solo 5E adventures with an AI Game Master that remembers your story. Free to start. Open beta."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://infiniterealms.app/" />
        <meta property="og:image" content="https://infiniterealms.app/og-launch-image.jpg" />

        {/* Twitter Card Tags */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Infinite Realms – Play 5E with an AI Game Master" />
        <meta
          name="twitter:description"
          content="Play solo 5E adventures with an AI Game Master that remembers your story. Free to start. Open beta."
        />
        <meta name="twitter:image" content="https://infiniterealms.app/twitter-launch-card.jpg" />

        {/* Canonical URL (#355): / renders this page; /launch is not a route. */}
        <link rel="canonical" href="https://infiniterealms.app/" />
      </Helmet>

      <div className="ir-app min-h-screen bg-infinite-dark overflow-x-hidden">
        <LaunchHeader />

        <main id="main-content">
          {/* Hero Section - The Hook */}
          <HeroSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Vision Section - Sell the Dream */}
          <VisionSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Founder Story Section - Personal Connection & Trust Building */}
          <FounderStorySection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Features Section - What We're Building */}
          <FeaturesSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Pricing Section - Free vs Legend */}
          <PricingSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Starter Campaigns Section - Ready-to-Play Adventures */}
          <StarterCampaignsSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Roadmap Section - Clear Beta Phases */}
          <RoadmapSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Early Access Section - Founding Adventurer Perks */}
          <EarlyAccessSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* FAQ Section - Launch-Focused Questions */}
          <FAQSection />

          {/* Gradient Transition */}
          <div className="h-px bg-gradient-to-r from-transparent via-infinite-gold/20 to-transparent"></div>

          {/* Final CTA Section - Email List */}
          <FinalCTASection />
        </main>

        {/* Footer Section - Legal & Links */}
        <FooterSection />
      </div>
    </>
  );
};

export default LaunchPage;
