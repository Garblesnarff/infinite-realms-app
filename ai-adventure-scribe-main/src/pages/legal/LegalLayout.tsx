import React from 'react';
import { Helmet } from 'react-helmet-async';

import { SHOW_LEGAL_DRAFT_BANNER } from '@/config/legal';

interface LegalLayoutProps {
  title: string;
  path: string;
  lastUpdated?: string;
  children: React.ReactNode;
}

export const LegalLayout: React.FC<LegalLayoutProps> = ({ title, path, lastUpdated, children }) => (
  <div className="ir-app min-h-screen">
    <Helmet>
      <title>{`${title} | Infinite Realms`}</title>
      <link rel="canonical" href={`https://infiniterealms.app${path}`} />
    </Helmet>
    <header className="border-b border-white/10 px-6 py-4">
      <a
        href="/"
        className="ir-display text-lg font-bold tracking-wide text-infinite-gold hover:text-infinite-gold-light"
      >
        ✦ INFINITE REALMS
      </a>
    </header>
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
