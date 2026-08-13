import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { FC } from 'react';

import { Z_INDEX } from '@/constants/z-index';

/**
 * Shared navigation for the public launch page.
 *
 * Returning beta users should never have to remember a separate app URL to
 * get back to their worlds, so the sign-in link stays visible while they
 * browse the landing page.
 */
export const LaunchHeader: FC = () => (
  <header
    className="sticky top-0 border-b border-white/10 bg-gray-950/75 backdrop-blur-xl"
    style={{ zIndex: Z_INDEX.STICKY }}
  >
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
      <Link
        to="/"
        className="group inline-flex items-center gap-3 rounded-md text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
        aria-label="Infinite Realms home"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-300/10 shadow-[0_0_18px_rgba(34,211,238,0.18)]">
          <Sparkles className="h-4 w-4 text-cyan-200" aria-hidden="true" />
        </span>
        <span className="font-heading text-base tracking-[0.18em] sm:text-lg">
          Infinite <span className="text-amber-300">Realms</span>
        </span>
      </Link>

      <Link
        to="/app"
        className="group inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-300/70 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.12)] transition-colors hover:border-amber-200 hover:bg-amber-300/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
        data-track-cta="sign_in"
      >
        Sign in
        <ArrowRight
          className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </div>
  </header>
);
