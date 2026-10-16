import React from 'react';
import { Helmet } from 'react-helmet-async';

import { LaunchHeader } from '@/components/launch/LaunchHeader';
import { SHOW_LEGAL_DRAFT_BANNER } from '@/config/legal';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/shared/components/layout/navigation';

interface LegalLayoutProps {
  title: string;
  path: string;
  lastUpdated?: string;
  children: React.ReactNode;
}

export const LegalLayout: React.FC<LegalLayoutProps> = ({ title, path, lastUpdated, children }) => {
  // #568: signed-in players get the app nav so they can leave the page; signed-out visitors keep the launch header.
  const { user, loading } = useAuth();
  return (
    <div className="ir-app min-h-screen">
      <Helmet>
        <title>{`${title} | Infinite Realms`}</title>
        {/* #355: declare the full tag set — react-helmet-async deletes managed
          (data-rh) tags a page does not redeclare. */}
        <meta
          name="description"
          content={`${title} — Infinite Realms. Create persistent worlds that evolve across generations.`}
        />
        <meta property="og:title" content={`${title} | Infinite Realms`} />
        <meta
          property="og:description"
          content={`${title} — Infinite Realms. Create persistent worlds that evolve across generations.`}
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`https://infiniterealms.app${path}`} />
        <meta property="og:image" content="https://infiniterealms.app/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${title} | Infinite Realms`} />
        <meta
          name="twitter:description"
          content={`${title} — Infinite Realms. Create persistent worlds that evolve across generations.`}
        />
        <meta name="twitter:image" content="https://infiniterealms.app/og-image.png" />
        <link rel="canonical" href={`https://infiniterealms.app${path}`} />
      </Helmet>
      {/* #210 QA-002: same wordmark and top nav as the launch page. */}
      {user ? <Navigation /> : loading ? null : <LaunchHeader />}
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-12">
        {SHOW_LEGAL_DRAFT_BANNER && (
          <div
            role="note"
            data-testid="legal-draft-banner"
            className="mb-8 rounded-lg border border-infinite-gold/50 bg-infinite-gold/10 px-4 py-3 text-sm font-semibold text-infinite-gold"
          >
            Draft — under review
          </div>
        )}
        <h1 className="ir-display mb-2 text-3xl font-bold text-infinite-gold">{title}</h1>
        {lastUpdated && (
          <p className="mb-8 text-sm text-foreground/60">Last updated: {lastUpdated}</p>
        )}
        <div className="space-y-6 leading-relaxed text-foreground/85">{children}</div>
      </main>
      <footer className="border-t border-white/10 px-6 py-6 text-center text-sm text-foreground/60">
        <nav aria-label="Legal" className="mb-2 flex justify-center gap-6">
          <a href="/privacy" className="hover:text-infinite-gold">
            Privacy
          </a>
          <a href="/terms" className="hover:text-infinite-gold">
            Terms
          </a>
          <a href="/cookies" className="hover:text-infinite-gold">
            Cookies
          </a>
          <a href="/contact" className="hover:text-infinite-gold">
            Contact
          </a>
        </nav>
        © 2026 Infinite Realms
      </footer>
    </div>
  );
};

export const LegalSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="space-y-3">
    <h2 className="ir-display text-xl font-semibold text-infinite-gold-light">{title}</h2>
    {children}
  </section>
);

export const SupportEmail: React.FC = () => {
  const email = import.meta.env.VITE_SUPPORT_EMAIL;
  return email ? (
    <a className="text-infinite-gold underline" href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <span>our support email (not yet configured)</span>
  );
};
