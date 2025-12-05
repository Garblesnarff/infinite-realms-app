import type { SiteConfig } from '../../../config/site.js';
import type { FAQItem } from '../schema.js';

interface SoloTabletopRPGPageProps {
  site: SiteConfig;
  faqItems: FAQItem[];
}

export function SoloTabletopRPGPage({ site, faqItems }: SoloTabletopRPGPageProps) {
  return (
    <div className="relative overflow-hidden">
      {/* Atmospheric Background - Warm, Inviting */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 30% 20%, rgba(251, 191, 36, 0.12), transparent),
            radial-gradient(ellipse 60% 50% at 70% 70%, rgba(234, 88, 12, 0.08), transparent),
            radial-gradient(ellipse 50% 40% at 90% 30%, rgba(251, 146, 60, 0.06), transparent),
            linear-gradient(180deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)
          `,
        }}
      />

      {/* Parchment Texture Overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center px-6 py-24">
        <div className="container max-w-6xl mx-auto">
          <div className="max-w-3xl">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
              <a href="/" className="hover:text-amber-400 transition-colors">{site.name}</a>
              <span>/</span>
              <span className="text-orange-400">Solo Tabletop RPG</span>
            </nav>

            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full border border-orange-500/30 bg-orange-500/10">
              <span className="text-2xl">&#x1F3B2;</span>
              <span className="text-orange-200 text-sm font-medium">No Group Required</span>
            </div>

            {/* H1 - Keyword Optimized */}
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
              <span
                style={{
                  background: 'linear-gradient(135deg, #fef3c7 0%, #fb923c 50%, #ea580c 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Solo Tabletop RPG
              </span>
              <br />
              <span className="text-white text-3xl sm:text-4xl lg:text-5xl">
                Epic Adventures, Party of One
              </span>
            </h1>

            {/* AEO-Optimized First Paragraph */}
            <p className="text-xl text-slate-200 mb-6 leading-relaxed">
              <strong className="text-orange-400">Yes, you can play tabletop RPG alone</strong> - and it's
              incredible. With an AI Game Master like Infinite Realms, you get the full tabletop experience:
              character creation, exploration, combat, and storytelling - all on your own schedule.
            </p>

            <p className="text-lg text-slate-400 mb-8">
              No more scheduling conflicts. No more canceled sessions. No more waiting for your group.
              Your adventure is always ready when you are.
            </p>

            {/* CTA */}
            <form
              data-waitlist-form
              data-source="solo-rpg-hero"
              className="flex flex-col sm:flex-row gap-3 max-w-lg mb-4"
            >
              <input
                type="email"
                name="email"
                placeholder="Enter your email"
                required
                className="flex-1 px-5 py-4 bg-slate-800/80 border border-slate-600/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/20 transition-all"
              />
              <button
                type="submit"
                data-track-cta="solo-rpg-hero"
                className="px-8 py-4 font-semibold text-slate-900 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-orange-500/25 whitespace-nowrap"
                style={{
                  background: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
                }}
              >
                Start Solo Adventure
              </button>
            </form>
            <p data-form-message className="text-sm" />
            <p className="text-slate-500 text-sm">Free beta access - no credit card required</p>
          </div>
        </div>

        {/* Decorative Dice */}
        <div className="absolute right-10 top-1/3 text-orange-500/10 text-9xl hidden xl:block select-none" aria-hidden="true">
          &#x1F3B2;
        </div>
      </section>

      {/* Quick Answer Box */}
      <section className="relative section pt-0">
        <div className="container max-w-4xl mx-auto">
          <div className="answer-box" style={{ borderColor: 'rgba(251, 146, 60, 0.3)' }}>
            <h2 className="font-display text-xl font-bold text-orange-400 mb-4">
              Can You Play Tabletop RPG Alone? Absolutely.
            </h2>
            <p className="text-lg text-slate-200 mb-4">
              Solo tabletop RPG is a growing hobby with thousands of players worldwide.
              Here's what you need to know:
            </p>
            <ul className="text-slate-300 space-y-2">
              <li className="flex items-start gap-3">
                <span className="text-orange-400 mt-1">&#x2713;</span>
                <span>Full RPG experience - same character creation, exploration, and combat</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-orange-400 mt-1">&#x2713;</span>
                <span>AI Game Master handles storytelling, NPCs, and rules</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-orange-400 mt-1">&#x2713;</span>
                <span>Play anytime - 10 minutes or 10 hours, your choice</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-orange-400 mt-1">&#x2713;</span>
                <span>No experience required - perfect for newcomers</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-orange-400 mt-1">&#x2713;</span>
                <span>Your world persists - continue your story across sessions</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Why Solo RPG Section */}
      <section className="relative section">
        <div className="container max-w-5xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Why Play Tabletop RPG Solo?
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            Solo gaming offers a unique experience that group play can't match
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                icon: '&#x23F0;',
                title: 'Play on Your Schedule',
                description: 'No more coordinating calendars with 4-6 people. Your adventure is ready whenever you have 10 minutes or 10 hours.',
              },
              {
                icon: '&#x1F3AD;',
                title: 'Deep Character Immersion',
                description: 'Fully inhabit your character without distractions. Explore their motivations, make tough choices, develop their arc.',
              },
              {
                icon: '&#x1F6E4;',
                title: 'Your Story, Your Pace',
                description: 'Spend an hour in the tavern gathering rumors, or rush into the dungeon. No pressure from other players.',
              },
              {
                icon: '&#x1F4D6;',
                title: 'Learn at Your Speed',
                description: 'New to tabletop RPG? Practice rules, try different strategies, and learn without judgment.',
              },
              {
                icon: '&#x1F30D;',
                title: 'Explore Freely',
                description: 'Go off the beaten path. Investigate that mysterious ruin. Follow your curiosity wherever it leads.',
              },
              {
                icon: '&#x1F4AB;',
                title: 'Consistent World',
                description: 'The AI remembers everything. NPCs recall your deeds. Your choices matter and persist forever.',
              },
            ].map((item, index) => (
              <div
                key={index}
                className="flex gap-5 p-6 rounded-xl bg-slate-800/30 border border-slate-700/50 hover:border-orange-500/30 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="text-4xl flex-shrink-0" dangerouslySetInnerHTML={{ __html: item.icon }} />
                <div>
                  <h3 className="font-display text-lg font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-slate-400">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative section">
        <div className="container max-w-4xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white text-center mb-4">
            How Solo Tabletop RPG Works
          </h2>
          <p className="text-slate-400 text-center mb-12">
            With Infinite Realms, getting started is simple
          </p>

          <div className="relative">
            {/* Vertical Line */}
            <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-orange-500/50 via-orange-500/20 to-transparent hidden md:block" />

            <div className="space-y-8">
              {[
                {
                  step: '1',
                  title: 'Create Your Character',
                  description: 'Build your hero with our guided character creator. Choose your class, background, and personality - or let the AI surprise you.',
                },
                {
                  step: '2',
                  title: 'Set Your Adventure',
                  description: 'Pick a campaign setting or describe the world you want to explore. The AI adapts to create the perfect adventure for you.',
                },
                {
                  step: '3',
                  title: 'Play Your Way',
                  description: 'Type your actions, make choices, roll dice. The AI Game Master responds with vivid descriptions, NPC dialogue, and dynamic encounters.',
                },
                {
                  step: '4',
                  title: 'Continue Anytime',
                  description: 'Your world is saved automatically. Pick up your adventure whenever inspiration strikes - the story remembers where you left off.',
                },
              ].map((item, index) => (
                <div key={index} className="flex gap-6 items-start">
                  <div
                    className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg"
                    style={{
                      background: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
                    }}
                  >
                    <span className="font-display text-2xl font-bold text-white">{item.step}</span>
                  </div>
                  <div className="pt-3">
                    <h3 className="font-display text-xl font-semibold text-white mb-2">{item.title}</h3>
                    <p className="text-slate-400 leading-relaxed">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial/Quote Section */}
      <section className="relative section">
        <div className="container max-w-3xl mx-auto">
          <blockquote
            className="text-center p-8 rounded-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.1) 0%, rgba(251, 146, 60, 0.02) 100%)',
              border: '1px solid rgba(251, 146, 60, 0.2)',
            }}
          >
            <p className="text-2xl md:text-3xl font-display text-slate-200 italic mb-6">
              "Solo RPG isn't a compromise - it's a different kind of magic. A chance to lose yourself
              completely in another world, on your terms."
            </p>
            <cite className="text-orange-400 not-italic">
              — The Solo RPG Community
            </cite>
          </blockquote>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="relative section" id="faq">
        <div className="container max-w-3xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white text-center mb-4">
            Solo Tabletop RPG FAQ
          </h2>
          <p className="text-slate-400 text-center mb-12">
            Everything you need to know about playing alone
          </p>

          <div className="space-y-4">
            {faqItems.map((item, index) => (
              <details
                key={index}
                className="faq-item group rounded-xl border border-slate-700/50 bg-slate-800/30 backdrop-blur-sm overflow-hidden"
              >
                <summary className="flex items-center justify-between p-6 cursor-pointer hover:bg-slate-700/20 transition-colors">
                  <span className="font-semibold text-white pr-4">{item.question}</span>
                  <svg
                    className="faq-chevron w-5 h-5 text-orange-400 flex-shrink-0 transition-transform duration-200"
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

      {/* Final CTA */}
      <section className="relative section pb-32">
        <div className="container max-w-4xl mx-auto">
          <div
            className="relative rounded-3xl p-8 md:p-12 text-center overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.15) 0%, rgba(234, 88, 12, 0.1) 100%)',
              border: '1px solid rgba(251, 146, 60, 0.3)',
            }}
          >
            {/* Decorative */}
            <div className="absolute top-4 right-8 text-6xl opacity-10" aria-hidden="true">&#x1F3B2;</div>

            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              Ready for Solo Adventure?
            </h2>
            <p className="text-slate-300 text-lg mb-8 max-w-xl mx-auto">
              Join the beta waitlist and start your solo tabletop RPG journey with an AI Game Master
              that's always ready to play.
            </p>

            <form
              data-waitlist-form
              data-source="solo-rpg-footer"
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-6"
            >
              <input
                type="email"
                name="email"
                placeholder="your@email.com"
                required
                className="flex-1 px-5 py-4 bg-slate-800/80 border border-slate-600/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/20 transition-all"
              />
              <button
                type="submit"
                data-track-cta="solo-rpg-footer"
                className="px-8 py-4 font-semibold text-white rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-orange-500/25"
                style={{
                  background: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
                }}
              >
                Join Waitlist
              </button>
            </form>
            <p data-form-message className="text-sm" />

            <p className="text-slate-500 text-sm">
              No group required. No experience needed.
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
              <a href="/" className="hover:text-orange-400 transition-colors">Home</a>
              <a href="/ai-game-master" className="hover:text-orange-400 transition-colors">AI Game Master</a>
              <a href="/blog" className="hover:text-orange-400 transition-colors">Blog</a>
              <a href="/privacy" className="hover:text-orange-400 transition-colors">Privacy</a>
            </nav>

            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} {site.name}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
