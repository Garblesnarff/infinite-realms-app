import React from 'react';

import { LegalLayout, LegalSection, SupportEmail } from './LegalLayout';

import { LEGAL_LAST_UPDATED } from '@/config/legal';

const PrivacyPage: React.FC = () => (
  <LegalLayout title="Privacy Policy" path="/privacy" lastUpdated={LEGAL_LAST_UPDATED}>
    <p>
      This policy explains what Infinite Realms collects, why, and the choices you have. Infinite
      Realms is run by an individual operator (no company entity yet) and is the controller of the
      data described here.
    </p>

    <LegalSection title="What we collect">
      <ul className="list-disc space-y-1 pl-6">
        <li>Account data: your email and name, from the WorkOS sign-in.</li>
        <li>
          Game data: characters, campaigns, chat and play history, and the text you type to the
          Dungeon Master.
        </li>
        <li>
          Billing data: Stripe handles card details. We store your plan and subscription status, not
          your card number.
        </li>
        <li>Waitlist data: the email you give when you ask for early access.</li>
        <li>
          Usage and device data: pages viewed, events, browser type and error reports, through
          Google Analytics 4 (GA4) and our own logs.
        </li>
      </ul>
    </LegalSection>

    <LegalSection title="Why we use it">
      <p>
        To run the game and your account, take payment, keep the service safe, fix bugs, understand
        how the product is used, and answer you when you write to us.
      </p>
    </LegalSection>

    <LegalSection title="Where it is stored">
      <p>
        Our database and servers run on a Hetzner server in Nuremberg, Germany (EU). The database is
        a self-hosted Supabase stack on that server. Some providers below process data in the US, so
        data you send through them can leave the EU.
      </p>
    </LegalSection>

    <LegalSection title="Who processes it">
      <ul className="list-disc space-y-1 pl-6">
        <li>WorkOS: sign-in and identity.</li>
        <li>Stripe: subscription payments.</li>
        <li>Google: GA4 analytics, and Gemini, which can generate AI story text and images.</li>
        <li>OpenRouter: routes some AI text requests to the model providers behind it.</li>
        <li>ElevenLabs: AI voice narration, where you use it.</li>
        <li>Hetzner: server hosting.</li>
      </ul>
      <p>We do not sell your personal data.</p>
    </LegalSection>

    <LegalSection title="AI-generated content">
      <p>
        What you type in a game is sent to AI providers so they can write the reply. Do not enter
        sensitive personal details in a game.
      </p>
    </LegalSection>

    <LegalSection title="Keeping and deleting data">
      <p>
        We keep account and game data while your account is open. When you email us to delete your
        account (there is no self-serve delete button yet), we delete or anonymise your data, except
        records we must keep for tax or legal reasons.
      </p>
    </LegalSection>

    <LegalSection title="Your rights">
      <p>
        Depending on where you live, you can ask to access, correct, export or delete your data,
        object to some processing, or complain to your data protection authority. Email{' '}
        <SupportEmail />.
      </p>
    </LegalSection>

    <LegalSection title="Cookies">
      <p>
        See our{' '}
        <a className="text-infinite-gold underline" href="/cookies">
          Cookie notice
        </a>
        .
      </p>
    </LegalSection>
  </LegalLayout>
);

export default PrivacyPage;
