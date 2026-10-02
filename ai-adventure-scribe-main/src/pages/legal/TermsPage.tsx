import React from 'react';

import { LegalLayout, LegalSection, SupportEmail } from './LegalLayout';

import { LEGAL_LAST_UPDATED } from '@/config/legal';

const TermsPage: React.FC = () => (
  <LegalLayout title="Terms of Service" path="/terms" lastUpdated={LEGAL_LAST_UPDATED}>
    <p>
      These terms cover your use of Infinite Realms, an AI-run tabletop role-playing game at
      infiniterealms.app. By creating an account or using the service you agree to them. Infinite
      Realms is run by an individual operator and does not yet have a company entity; "we" and "us"
      means Infinite Realms.
    </p>

    <LegalSection title="Your account">
      <p>
        Sign-in is handled by WorkOS. You must give accurate details, keep your sign-in secure and
        be old enough to agree to these terms where you live. You are responsible for activity on
        your account.
      </p>
    </LegalSection>

    <LegalSection title="Legend subscription">
      <p>
        The Legend plan costs $15 per month, billed monthly in advance through Stripe. It renews
        automatically until you cancel. You can cancel any time from your account; you keep access
        until the end of the period you already paid for.
      </p>
      <p>
        Refunds are handled case by case. Email <SupportEmail /> and tell us what went wrong. We may
        change prices or plan features with notice before your next billing date.
      </p>
    </LegalSection>

    <LegalSection title="AI-generated content">
      <p>
        The Dungeon Master, characters, narration, images and voices in Infinite Realms are made by
        AI models. Output can be wrong, odd, or upsetting, and it is not professional advice. We do
        not promise it is accurate, unique or free of material that resembles existing works. You
        are responsible for how you use it outside the service.
      </p>
    </LegalSection>

    <LegalSection title="Your content">
      <p>
        You keep ownership of the text you write, such as characters and campaign ideas. You give us
        a licence to store, process and display it, and to send it to our AI providers, only so we
        can run the service for you. Do not submit anything unlawful, or anything you have no right
        to share.
      </p>
    </LegalSection>

    <LegalSection title="Acceptable use">
      <p>
        Do not attack, overload or probe the service, resell access, scrape it in bulk, share your
        account, or use it to harass others or to make unlawful content. We may suspend or end
        accounts that break these terms.
      </p>
    </LegalSection>

    <LegalSection title="Game rules and third-party material">
      <p>
        Infinite Realms is not affiliated with Wizards of the Coast. D&D content uses SRD/OGL
        licensed material where applicable. Other names belong to their owners.
      </p>
    </LegalSection>

    <LegalSection title="Availability and liability">
      <p>
        The service is in beta and is provided "as is". It may change, be interrupted or lose data.
        To the extent the law allows, we are not liable for indirect or consequential loss, and our
        total liability for any claim is limited to what you paid us in the 12 months before it.
        Nothing here limits rights that the law does not allow us to limit.
      </p>
    </LegalSection>

    <LegalSection title="Changes and contact">
      <p>
        We may update these terms; continuing to use the service after a change means you accept it.
        Questions: <SupportEmail />.
      </p>
    </LegalSection>
  </LegalLayout>
);

export default TermsPage;
