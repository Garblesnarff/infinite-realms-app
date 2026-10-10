/**
 * Pricing page (#227): the landing page's pricing section on its own URL, so /pricing is a real
 * page for the sitemap and for links, not the not-found page.
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

import { PricingSection } from '@/components/launch/PricingSection';
import { launchPageContent } from '@/data/launchPageContent';

const PricingPage: React.FC = () => (
  <div className="min-h-screen bg-gray-900">
    <Helmet>
      <title>Pricing | Infinite Realms</title>
      <meta name="description" content={launchPageContent.pricing.subtitle} />
      <link rel="canonical" href="https://infiniterealms.app/pricing" />
    </Helmet>
    <header className="px-6 py-4 border-b border-white/10">
      <Link to="/" className="text-lg font-bold tracking-wide text-amber-400 hover:text-amber-300">
        ✦ INFINITE REALMS
      </Link>
    </header>
    <main id="main-content" tabIndex={-1}>
      <PricingSection />
    </main>
  </div>
);

export default PricingPage;
