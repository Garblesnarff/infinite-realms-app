/**
 * Authentication Page
 *
 * Branded login page that redirects to WorkOS AuthKit hosted UI.
 * WorkOS handles all authentication flows including signup, login, and password reset.
 */

import { ArrowLeft, ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

const AuthPage: React.FC = () => {
  const handleSignIn = (): void => {
    // Redirect directly to backend auth endpoint
    // Backend will generate WorkOS URL and redirect
    const apiUrl = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiUrl}/v1/auth/login`;
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070b14] text-white">
      {/* The existing campaign art keeps the auth handoff inside the same world as the game. */}
      <div className="absolute inset-0" aria-hidden="true">
        <img
          src="/hero-bg-v2.jpg"
          alt=""
          className="h-full w-full object-cover object-center opacity-45"
        />
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(7,11,20,0.98)_10%,rgba(7,11,20,0.82)_48%,rgba(15,12,31,0.72)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_48%,rgba(124,58,237,0.24),transparent_34%)]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-white/10 bg-gray-950/30 px-4 py-4 backdrop-blur-md sm:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <Link
              to="/"
              className="inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
              aria-label="Return to Infinite Realms landing page"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-300/10">
                <Sparkles className="h-4 w-4 text-cyan-200" aria-hidden="true" />
              </span>
              <span className="font-heading text-base tracking-[0.18em] sm:text-lg">
                Infinite <span className="text-amber-300">Realms</span>
              </span>
            </Link>

            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to landing
            </Link>
          </div>
        </header>

        <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-12 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] lg:gap-20 lg:py-16">
          <section className="hidden max-w-2xl lg:block" aria-labelledby="auth-value-heading">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-purple-300/25 bg-purple-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-purple-200">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              Your story continues
            </p>
            <h1
              id="auth-value-heading"
              className="font-heading text-5xl font-semibold leading-tight tracking-tight text-white xl:text-6xl"
            >
              Your worlds are <span className="text-amber-300">waiting.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-200/85">
              Return to campaigns that remember every choice, characters who grow with you, and
              adventures ready whenever you are.
            </p>

            <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
              {['Persistent campaigns', 'Living characters', 'Play on your time'].map((item) => (
                <div
                  key={item}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200/80 backdrop-blur-sm"
                >
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="auth-heading">
            <div className="rounded-2xl border border-white/15 bg-gray-950/70 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
              <div className="mb-8">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/10 shadow-[0_0_24px_rgba(251,191,36,0.12)]">
                  <Sparkles className="h-5 w-5 text-amber-200" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">
                  Welcome back, adventurer
                </p>
                <h2
                  id="auth-heading"
                  className="mt-3 font-heading text-3xl font-semibold text-white"
                >
                  Step back into your realm
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  Sign in to continue your campaigns, or create an account to begin a new legend.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSignIn}
                className="group inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-amber-200 bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 px-5 py-3 text-base font-bold text-gray-950 shadow-[0_0_28px_rgba(251,191,36,0.2)] transition-all hover:from-amber-200 hover:via-amber-300 hover:to-orange-400 hover:shadow-[0_0_38px_rgba(251,191,36,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
              >
                Sign in or create an account
                <ArrowRight
                  className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>

              <div className="mt-6 border-t border-white/10 pt-5 text-center">
                <p className="text-xs leading-relaxed text-slate-400">
                  Secure authentication powered by WorkOS AuthKit, with support for passwordless
                  sign-in and SSO.
                </p>
                <p className="mt-4 text-sm text-slate-300">
                  New to Infinite Realms?{' '}
                  <Link
                    to="/"
                    className="font-semibold text-amber-300 underline decoration-amber-300/40 underline-offset-4 transition-colors hover:text-amber-200"
                  >
                    Explore the beta
                  </Link>
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer className="px-4 pb-5 text-center text-xs text-slate-400 sm:px-8">
          <p>Infinite Realms · Your world, your story, forever.</p>
        </footer>
      </div>
    </main>
  );
};

export default AuthPage;
