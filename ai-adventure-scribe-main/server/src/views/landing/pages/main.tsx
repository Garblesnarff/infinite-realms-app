import type { SiteConfig } from '../../../config/site.js';
import type { FAQItem } from '../schema.js';

interface MainLandingPageProps {
  site: SiteConfig;
  faqItems: FAQItem[];
}

export function MainLandingPage({ site, faqItems }: MainLandingPageProps) {
  return (
    <div className="relative overflow-hidden">
      {/* Atmospheric Background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(251, 191, 36, 0.15), transparent),
            radial-gradient(ellipse 60% 40% at 80% 60%, rgba(139, 92, 246, 0.08), transparent),
            radial-gradient(ellipse 70% 50% at 20% 80%, rgba(59, 130, 246, 0.06), transparent),
            linear-gradient(180deg, #0f172a 0%, #020617 100%)
          `,
        }}
      />

      {/* Noise Texture Overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center px-6 py-20">
        {/* Decorative Runes */}
        <div className="absolute top-20 left-10 text-amber-500/20 text-6xl font-display select-none" aria-hidden="true">
          &#x2726;
        </div>
        <div className="absolute bottom-32 right-16 text-amber-500/15 text-8xl font-display select-none rotate-12" aria-hidden="true">
          &#x2736;
        </div>

        <div className="container max-w-5xl mx-auto text-center relative z-10">
          {/* Beta Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full border border-amber-500/30 bg-amber-500/10 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-200 text-sm font-medium tracking-wide">
              Closed Beta: Coming Soon
            </span>
          </div>

          {/* Main Headline */}
          <h1
            className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight"
            style={{
              background: 'linear-gradient(135deg, #fef3c7 0%, #fbbf24 50%, #d97706 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Your AI Game Master Awaits
          </h1>

          {/* Subheadline */}
          <p className="text-xl md:text-2xl text-slate-300 mb-4 max-w-3xl mx-auto leading-relaxed">
            Play solo tabletop RPG adventures with an AI that{' '}
            <span className="text-amber-400 font-semibold">remembers every choice</span>,{' '}
            <span className="text-amber-400 font-semibold">evolves NPCs</span>, and{' '}
            <span className="text-amber-400 font-semibold">crafts cinematic stories</span> tailored to you.
          </p>

          {/* Value Prop */}
          <p className="text-lg text-slate-400 mb-10 max-w-2xl mx-auto">
            No scheduling. No prep. No waiting. Epic adventures on your time.
          </p>

          {/* CTA Section with Magical Glow */}
          <div className="relative inline-block mb-8">
            {/* Glow Effect */}
            <div
              className="absolute -inset-4 rounded-2xl opacity-50 blur-xl"
              style={{
                background: 'radial-gradient(circle, rgba(251, 191, 36, 0.4) 0%, transparent 70%)',
              }}
            />

            {/* Waitlist Form */}
            <form
              data-waitlist-form
              data-source="hero"
              className="relative flex flex-col sm:flex-row gap-3 bg-slate-900/80 backdrop-blur-sm p-2 rounded-xl border border-slate-700/50"
            >
              <input
                type="email"
                name="email"
                placeholder="Enter your email"
                required
                className="flex-1 px-5 py-4 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20 transition-all min-w-[280px]"
              />
              <button
                type="submit"
                data-track-cta="hero-waitlist"
                className="px-8 py-4 font-semibold text-slate-900 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-amber-500/25"
                style={{
                  background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
                }}
              >
                Join the Quest
              </button>
            </form>
            <p data-form-message className="mt-3 text-sm" />
          </div>

          {/* Trust Indicator */}
          <p className="text-slate-500 text-sm flex items-center justify-center gap-2">
            <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            Join 500+ adventurers on the waitlist
          </p>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-slate-500 animate-bounce">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* AEO Answer Box Section */}
      <section className="relative section">
        <div className="container max-w-4xl mx-auto">
          <div className="answer-box">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-amber-400 mb-4">
              What is an AI Game Master?
            </h2>
            <p className="text-lg text-slate-200 mb-6 leading-relaxed">
              An AI Game Master is an artificial intelligence that runs tabletop roleplaying games for you.
              It handles storytelling, rules, NPCs, and combat - available 24/7 without scheduling.
              Infinite Realms creates an intelligent GM that understands classic fantasy RPG rules,
              crafts adaptive narratives based on your choices, and brings NPCs to life with distinct personalities.
            </p>
            <ul className="text-slate-300 space-y-2">
              <li className="flex items-start gap-3">
                <span className="text-amber-500 mt-1">&#x2726;</span>
                <span>Available anytime - no scheduling, no waiting for your group</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-amber-500 mt-1">&#x2726;</span>
                <span>Remembers every character, choice, and consequence across sessions</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-amber-500 mt-1">&#x2726;</span>
                <span>Handles all rules and dice mechanics automatically</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-amber-500 mt-1">&#x2726;</span>
                <span>Creates adaptive, personalized stories that evolve with you</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative section">
        <div className="container max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              What We're Building
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Features in active development for our beta launch
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: '&#x1F9E0;',
                title: 'Stories That Remember You',
                description: "Every choice creates ripples that last forever. Save a village and they'll erect statues. Betray an ally and face consequences sessions later.",
                status: 'In Development',
              },
              {
                icon: '&#x1F3AD;',
                title: 'NPCs With Real Memory',
                description: 'Build relationships that evolve like real friendships. NPCs remember your heroic sacrifices, betrayals, and moments of kindness.',
                status: 'Beta',
              },
              {
                icon: '&#x1F4D6;',
                title: 'Seamless RPG Rules',
                description: 'Focus on story and roleplay while the AI handles mechanics, spell interactions, and combat calculations perfectly.',
                status: 'In Development',
              },
              {
                icon: '&#x1F5BC;',
                title: 'Living Fantasy Worlds',
                description: 'Watch your adventures come alive with cinematic visuals. Every shadowy tavern and ancient ruin rendered in stunning detail.',
                status: 'Planned',
              },
              {
                icon: '&#x1F399;',
                title: 'Immersive Voice Acting',
                description: 'Hear your adventures with professional narration. Distinct character voices bring NPCs to life in every scene.',
                status: 'Planned',
              },
              {
                icon: '&#x1F4DA;',
                title: 'Your Campaign as a Book',
                description: 'Transform your adventure into a beautiful storybook. Share your legend with artwork, maps, and narrative summaries.',
                status: 'Coming Soon',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="feature-card group"
              >
                <div className="text-4xl mb-4" dangerouslySetInnerHTML={{ __html: feature.icon }} />
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-display text-xl font-semibold text-white group-hover:text-amber-400 transition-colors">
                    {feature.title}
                  </h3>
                </div>
                <span className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-slate-700/50 text-slate-300 mb-3">
                  {feature.status}
                </span>
                <p className="text-slate-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative section">
        <div className="container max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              Your Journey Begins Here
            </h2>
            <p className="text-slate-400 text-lg">
              Three simple steps to join the beta
            </p>
          </div>

          <div className="relative">
            {/* Connecting Line */}
            <div className="absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent hidden md:block" />

            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  step: '01',
                  title: 'Join the Waitlist',
                  description: "Sign up with your email to get on our exclusive beta access list. We'll notify you as soon as spots open.",
                },
                {
                  step: '02',
                  title: 'Get Early Access',
                  description: "Once approved, you'll receive an invitation to create your account and start building your campaign world.",
                },
                {
                  step: '03',
                  title: 'Shape the Future',
                  description: 'Playtest new features, provide feedback, and help us build the ultimate AI Game Master together.',
                },
              ].map((item, index) => (
                <div key={index} className="relative text-center">
                  <div className="relative z-10 w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <span className="font-display text-xl font-bold text-slate-900">{item.step}</span>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-white mb-3">{item.title}</h3>
                  <p className="text-slate-400">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="relative section" id="faq">
        <div className="container max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-slate-400 text-lg">
              Everything you need to know about Infinite Realms
            </p>
          </div>

          <div className="space-y-4">
            {faqItems.map((item, index) => (
              <details
                key={index}
                className="faq-item group rounded-xl border border-slate-700/50 bg-slate-800/30 backdrop-blur-sm overflow-hidden"
              >
                <summary className="flex items-center justify-between p-6 cursor-pointer hover:bg-slate-700/20 transition-colors">
                  <span className="font-semibold text-white pr-4">{item.question}</span>
                  <svg
                    className="faq-chevron w-5 h-5 text-amber-500 flex-shrink-0 transition-transform duration-200"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-6 pb-6 text-slate-300 leading-relaxed">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="relative section pb-32">
        <div className="container max-w-4xl mx-auto">
          <div
            className="relative rounded-3xl p-8 md:p-12 text-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(217, 119, 6, 0.05) 100%)',
              border: '1px solid rgba(251, 191, 36, 0.2)',
            }}
          >
            {/* Decorative Elements */}
            <div className="absolute top-4 left-4 text-amber-500/20 text-4xl" aria-hidden="true">&#x2726;</div>
            <div className="absolute bottom-4 right-4 text-amber-500/20 text-4xl" aria-hidden="true">&#x2726;</div>

            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              Your Adventure Awaits
            </h2>
            <p className="text-slate-300 text-lg mb-8 max-w-xl mx-auto">
              Spots for the closed beta are limited. Join the waitlist now to be among the first
              to experience the AI Game Master.
            </p>

            <form
              data-waitlist-form
              data-source="footer"
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-6"
            >
              <input
                type="email"
                name="email"
                placeholder="your@email.com"
                required
                className="flex-1 px-5 py-4 bg-slate-800/80 border border-slate-600/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20 transition-all"
              />
              <button
                type="submit"
                data-track-cta="footer-waitlist"
                className="px-8 py-4 font-semibold text-slate-900 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-amber-500/25"
                style={{
                  background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
                }}
              >
                Request Access
              </button>
            </form>
            <p data-form-message className="text-sm" />

            <p className="text-slate-500 text-sm">
              Join 500+ adventurers already on the waitlist
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-slate-800 py-12">
        <div className="container max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <span className="font-display text-xl font-bold text-white">{site.name}</span>
            </div>

            <nav className="flex items-center gap-6 text-sm text-slate-400">
              <a href="/ai-game-master" className="hover:text-amber-400 transition-colors">AI Game Master</a>
              <a href="/solo-tabletop-rpg" className="hover:text-amber-400 transition-colors">Solo RPG</a>
              <a href="/blog" className="hover:text-amber-400 transition-colors">Blog</a>
              <a href="/privacy" className="hover:text-amber-400 transition-colors">Privacy</a>
              <a href="/terms" className="hover:text-amber-400 transition-colors">Terms</a>
            </nav>

            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} {site.name}. All rights reserved.
            </p>
          </div>

          <p className="text-xs text-slate-600 text-center mt-8">
            Infinite Realms is not affiliated with Wizards of the Coast. All game content uses SRD/OGL licensed material where applicable.
          </p>
        </div>
      </footer>
    </div>
  );
}
