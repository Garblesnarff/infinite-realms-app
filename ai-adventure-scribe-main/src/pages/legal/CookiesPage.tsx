import React from 'react';

import { LegalLayout, LegalSection, SupportEmail } from './LegalLayout';

import { LEGAL_LAST_UPDATED } from '@/config/legal';

const CookiesPage: React.FC = () => (
  <LegalLayout title="Cookie Notice" path="/cookies" lastUpdated={LEGAL_LAST_UPDATED}>
    <p>
      Infinite Realms uses cookies and similar browser storage to sign you in and to measure how the
      site is used.
    </p>

    <LegalSection title="Essential storage">
      <p>
        Your WorkOS sign-in session and your preferences are kept in your browser (cookies and local
        storage) so you stay signed in. The service does not work without them.
      </p>
    </LegalSection>

    <LegalSection title="Analytics">
      <p>
        We use Google Analytics 4 (GA4) to count visits and see which pages and features are used.
        GA4 loads when analytics is turned on for the site, and it does not ask for your consent
        first. It sets cookies and sends usage data, including your IP address, to Google, which may
        process it in the US.
      </p>
    </LegalSection>

    <LegalSection title="Your choices">
      <p>
        You can block or delete cookies in your browser settings, or install Google's opt-out add-on
        for analytics. Blocking essential storage will stop sign-in from working. Questions:{' '}
        <SupportEmail />. More detail is in our{' '}
        <a className="text-infinite-gold underline" href="/privacy">
          Privacy Policy
        </a>
        .
      </p>
    </LegalSection>
  </LegalLayout>
);

export default CookiesPage;
