import React from 'react';

import { LegalLayout } from './LegalLayout';

const ContactPage: React.FC = () => {
  const email = import.meta.env.VITE_SUPPORT_EMAIL;
  return (
    <LegalLayout title="Contact" path="/contact">
      <p>
        Questions about your account, billing, refunds, privacy requests or a bug? Email us and we
        will reply as soon as we can.
      </p>
      {email ? (
        <p>
          Support email:{' '}
          <a className="text-infinite-gold underline" href={`mailto:${email}`}>
            {email}
          </a>
        </p>
      ) : (
        <p>The support email address is not configured yet.</p>
      )}
    </LegalLayout>
  );
};

export default ContactPage;
