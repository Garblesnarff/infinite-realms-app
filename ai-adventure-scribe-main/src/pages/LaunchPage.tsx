/**
 * Launch Page - public landing page (Table 12, Landing board)
 *
 * PURPOSE: Send visitors to play free at /explore.
 * Structure: Hero → Start a story tonight → Memory → Voice → Join → Footer.
 * Pricing and the FAQ live on /pricing (the footer links to #faq there).
 */

import { ArrowRight } from 'lucide-react';
import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

import { LandingCampaigns } from '@/components/launch/LandingCampaigns';
import { LandingMemory } from '@/components/launch/LandingMemory';
import { LaunchHeader } from '@/components/launch/LaunchHeader';
import { launchPageContent } from '@/data/launchPageContent';

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

      <div className="ir-app min-h-screen overflow-x-hidden bg-[#070b14] font-sans text-[#eaeefa]">
        <LaunchHeader />

        <main id="main-content">
          {/* Hero */}
          <section aria-labelledby="landing-hero" className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-[980px] overflow-hidden" aria-hidden="true">
              <img
                src="/hero-bg-v2.jpg"
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-40 saturate-[.6]"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-[#070b14]/55 via-[#070b14]/80 to-[#070b14]" />
            </div>
            <div className="relative mx-auto flex max-w-[1280px] flex-col items-center px-4 pb-20 pt-16 text-center sm:pt-24">
              <span className="inline-flex min-h-9 items-center rounded-full border border-[#d5b070]/45 bg-[#070b14]/70 px-4 text-sm text-[#f3deb0]">
                Open beta · Free to play · No waitlist
              </span>
              <h1
                id="landing-hero"
                className="mt-6 font-heading text-[2.5rem] font-black leading-[1.06] text-balance text-[#eaeefa] sm:text-[4.75rem]"
              >
                THE <span className="text-[#f3deb0]">5E CAMPAIGN</span>
                <br />
                THAT NEVER CANCELS
              </h1>
              <p className="mx-auto mt-6 max-w-[780px] text-lg leading-relaxed text-[#d4dbef] sm:text-[22px]">
                The tabletop adventures you’ve been wanting, now possible. An AI Game Master with{' '}
                <b>perfect memory</b>, <b>professional voice acting</b>, and{' '}
                <b>infinite patience</b>. No scheduling. No cancellations. Just play.
              </p>
              <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row">
                <Link
                  to="/explore"
                  data-track-cta="play_free"
                  className="inline-flex min-h-[58px] items-center justify-center rounded-xl border border-[#f3deb0] bg-gradient-to-b from-[#f6e3b8] via-[#d5b070] to-[#a9823f] px-8 font-heading text-lg font-bold tracking-[0.06em] text-[#1a1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_14px_rgba(0,0,0,0.45)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#f3deb0]"
                >
                  Roll for Initiative (join the beta)
                  <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
                </Link>
                <Link
                  to="/explore"
                  className="inline-flex min-h-[58px] items-center justify-center rounded-xl border border-[#eaeefa]/40 px-7 text-lg font-medium text-[#eaeefa] hover:bg-white/5"
                >
                  See the adventures
                </Link>
              </div>
            </div>
          </section>

          <LandingCampaigns />

          <LandingMemory />

          {/* Voice */}
          <section
            aria-labelledby="landing-voice"
            className="mx-auto max-w-[1216px] px-4 py-16 text-center lg:text-left"
          >
            <div>
              <div className="text-sm font-bold tracking-[0.16em] text-[#4fb6c4]">VOICE</div>
              <h2
                id="landing-voice"
                className="mt-3 font-heading text-3xl font-bold leading-[1.12] text-balance text-[#eaeefa] sm:text-[44px]"
              >
                HEAR THE STORY, NOT JUST READ IT
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-[#d4dbef] sm:text-xl">
                Press Listen on any message and the DM reads it aloud.
              </p>
            </div>
          </section>

          {/* Join — no waitlist (Table 12, #1432 item 4): the form is gone, the
              hero pill stays, and the section sends visitors straight to /explore. */}
          <section
            aria-labelledby="landing-join"
            className="mx-auto flex max-w-[1280px] flex-col items-center px-4 py-20"
          >
            <h2
              id="landing-join"
              className="font-heading text-3xl font-bold text-[#f3deb0] sm:text-[40px]"
            >
              Be a founding adventurer
            </h2>
            <div className="mt-6">
              <Link
                to="/explore"
                data-track-cta="play_free_join"
                className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-[#f3deb0] bg-gradient-to-b from-[#f6e3b8] via-[#d5b070] to-[#a9823f] px-8 font-heading text-lg font-bold tracking-[0.06em] text-[#1a1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_14px_rgba(0,0,0,0.45)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#f3deb0]"
              >
                Join the beta
                <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
              </Link>
            </div>
          </section>
        </main>

        <footer className="flex flex-col items-center gap-3 border-t border-[#d5b070]/20 px-4 py-6 text-center text-sm text-[#aab3cc]">
          <p className="max-w-2xl text-xs leading-relaxed text-[#8f9ab8]">
            {launchPageContent.footer.legal.ipDisclaimer}
          </p>
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
          >
            <span>© {new Date().getFullYear()} InfiniteRealms. All rights reserved.</span>
            <Link
              to="/pricing"
              className="inline-flex min-h-11 items-center text-[#d5b070] hover:text-[#f3deb0]"
            >
              Pricing
            </Link>
            <Link
              to="/pricing#faq"
              className="inline-flex min-h-11 items-center text-[#d5b070] hover:text-[#f3deb0]"
            >
              FAQ
            </Link>
            <Link
              to="/explore"
              className="inline-flex min-h-11 items-center text-[#d5b070] hover:text-[#f3deb0]"
            >
              Explore
            </Link>
            <Link
              to="/privacy"
              className="inline-flex min-h-11 items-center text-[#d5b070] hover:text-[#f3deb0]"
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms"
              className="inline-flex min-h-11 items-center text-[#d5b070] hover:text-[#f3deb0]"
            >
              Terms of Service
            </Link>
          </nav>
        </footer>
      </div>
    </>
  );
};

export default LaunchPage;
