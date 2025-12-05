import type { SiteConfig } from '../../../config/site.js';
import type { FAQItem } from '../schema.js';

interface AIGameMasterPageProps {
  site: SiteConfig;
  faqItems: FAQItem[];
}

export function AIGameMasterPage({ site, faqItems }: AIGameMasterPageProps) {
  return (
    <div className="relative overflow-hidden">
      {/* Atmospheric Background - Deeper, more mystical */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 100% 60% at 50% 0%, rgba(139, 92, 246, 0.12), transparent),
            radial-gradient(ellipse 50% 50% at 90% 50%, rgba(251, 191, 36, 0.1), transparent),
            radial-gradient(ellipse 60% 40% at 10% 70%, rgba(59, 130, 246, 0.08), transparent),
            linear-gradient(180deg, #020617 0%, #0f172a 50%, #020617 100%)
          `,
        }}
      />

      {/* Animated Star Field Effect */}
      <div
        className="fixed inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `
            radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.8), transparent),
            radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.5), transparent),
            radial-gradient(1px 1px at 50px 160px, rgba(255,255,255,0.6), transparent),
            radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.7), transparent),
            radial-gradient(1px 1px at 160px 120px, rgba(255,255,255,0.5), transparent)
          `,
          backgroundSize: '200px 200px',
        }}
      />

      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center px-6 py-24">
        <div className="container max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Content */}
            <div className="relative z-10">
              {/* Breadcrumb */}
              <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
                <a href="/" className="hover:text-amber-400 transition-colors">{site.name}</a>
                <span>/</span>
                <span className="text-amber-400">AI Game Master</span>
              </nav>

              {/* H1 - Keyword Optimized */}
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                <span className="text-white">What is an</span>
                <br />
                <span
                  style={{
                    background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #8b5cf6 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  AI Game Master?
                </span>
              </h1>

              {/* AEO-Optimized First Paragraph */}
              <p className="text-xl text-slate-200 mb-6 leading-relaxed">
                An <strong className="text-amber-400">AI Game Master</strong> is an artificial intelligence system
                that runs tabletop roleplaying games. Unlike human GMs, an AI GM is available 24/7,
                remembers every detail of your campaign, and never needs prep time.
              </p>

              <p className="text-lg text-slate-400 mb-8">
                Infinite Realms creates an intelligent GM that understands classic fantasy RPG rules,
                crafts adaptive narratives based on your choices, and brings NPCs to life with distinct personalities.
                Perfect for solo players, busy schedules, or anyone craving epic adventures.
              </p>

              {/* CTA */}
              <form
                data-waitlist-form
                data-source="ai-gm-hero"
                className="flex flex-col sm:flex-row gap-3 max-w-lg mb-4"
              >
                <input
                  type="email"
                  name="email"
                  placeholder="Enter your email"
                  required
                  className="flex-1 px-5 py-4 bg-slate-800/80 border border-slate-600/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20 transition-all"
                />
                <button
                  type="submit"
                  data-track-cta="ai-gm-hero"
                  className="px-8 py-4 font-semibold text-slate-900 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-amber-500/25 whitespace-nowrap"
                  style={{
                    background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                  }}
                >
                  Try AI GM Free
                </button>
              </form>
              <p data-form-message className="text-sm" />
              <p className="text-slate-500 text-sm">Join the beta waitlist - no credit card required</p>
            </div>

            {/* Right: Visual */}
            <div className="relative hidden lg:block">
              <div
                className="aspect-square max-w-md mx-auto rounded-3xl overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(251, 191, 36, 0.1) 100%)',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                }}
              >
                {/* Mystical GM Visualization */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    {/* Outer Ring */}
                    <div
                      className="w-64 h-64 rounded-full border-2 border-amber-500/20"
                      style={{ animation: 'spin 30s linear infinite' }}
                    />
                    {/* Middle Ring */}
                    <div
                      className="absolute inset-4 rounded-full border border-violet-500/30"
                      style={{ animation: 'spin 20s linear infinite reverse' }}
                    />
                    {/* Inner Circle */}
                    <div className="absolute inset-12 rounded-full bg-gradient-to-br from-violet-600/30 to-amber-500/20 flex items-center justify-center">
                      <span className="text-6xl">&#x1F9D9;</span>
                    </div>
                    {/* Floating Runes */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-4 text-amber-500/60 text-2xl">&#x2726;</div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-4 text-violet-500/60 text-2xl">&#x2736;</div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 text-amber-500/60 text-2xl">&#x2726;</div>
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 text-violet-500/60 text-2xl">&#x2736;</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Answer Box for AEO */}
      <section className="relative section pt-0">
        <div className="container max-w-4xl mx-auto">
          <div className="answer-box" style={{ borderColor: 'rgba(139, 92, 246, 0.3)' }}>
            <h2 className="font-display text-xl font-bold text-violet-400 mb-4">
              Quick Answer: AI Game Master Explained
            </h2>
            <ul className="text-slate-300 space-y-2">
              <li className="flex items-start gap-3">
                <span className="text-violet-400 mt-1">&#x2713;</span>
                <span><strong>Artificial intelligence that runs tabletop RPG games</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-violet-400 mt-1">&#x2713;</span>
                <span>Available anytime, no scheduling needed</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-violet-400 mt-1">&#x2713;</span>
                <span>Remembers your entire campaign history</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-violet-400 mt-1">&#x2713;</span>
                <span>Handles all rules and dice mechanics</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-violet-400 mt-1">&#x2713;</span>
                <span>Creates adaptive, personalized stories</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Comparison Section: AI GM vs Human GM */}
      <section className="relative section">
        <div className="container max-w-5xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white text-center mb-12">
            AI Game Master vs Human Game Master
          </h2>

          <div className="grid md:grid-cols-2 gap-8">
            {/* AI GM Column */}
            <div
              className="rounded-2xl p-8"
              style={{
                background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(251, 191, 36, 0.02) 100%)',
                border: '1px solid rgba(251, 191, 36, 0.2)',
              }}
            >
              <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">&#x1F916;</span>
                <h3 className="font-display text-xl font-bold text-amber-400">AI Game Master</h3>
              </div>
              <ul className="space-y-4 text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-0.5">&#x2713;</span>
                  <span>Available 24/7 - play anytime you want</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-0.5">&#x2713;</span>
                  <span>Perfect memory - never forgets NPCs or plot points</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-0.5">&#x2713;</span>
                  <span>Zero prep time - start playing instantly</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-0.5">&#x2713;</span>
                  <span>Consistent rules application</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-0.5">&#x2713;</span>
                  <span>Infinite patience and adaptability</span>
                </li>
              </ul>
            </div>

            {/* Human GM Column */}
            <div
              className="rounded-2xl p-8"
              style={{
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.02) 100%)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
              }}
            >
              <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">&#x1F9D9;</span>
                <h3 className="font-display text-xl font-bold text-violet-400">Human Game Master</h3>
              </div>
              <ul className="space-y-4 text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="text-violet-400 mt-0.5">&#x2726;</span>
                  <span>Requires scheduling and coordination</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-violet-400 mt-0.5">&#x2726;</span>
                  <span>May forget details between sessions</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-violet-400 mt-0.5">&#x2726;</span>
                  <span>Needs significant prep time</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-violet-400 mt-0.5">&#x2726;</span>
                  <span>Creative improvisation and emotional depth</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-violet-400 mt-0.5">&#x2726;</span>
                  <span>Social connection with friends</span>
                </li>
              </ul>
            </div>
          </div>

          <p className="text-center text-slate-400 mt-8 max-w-2xl mx-auto">
            AI Game Masters don't replace human GMs - they complement them. Perfect for solo adventures,
            practice sessions, or when your group can't coordinate schedules.
          </p>
        </div>
      </section>

      {/* Features Deep Dive */}
      <section className="relative section">
        <div className="container max-w-5xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white text-center mb-4">
            What Makes Our AI Game Master Different
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            Built specifically for tabletop RPG storytelling, not generic chatbots
          </p>

          <div className="space-y-6">
            {[
              {
                title: 'Persistent World Memory',
                description: 'Every NPC remembers their interactions with you. Steal from a merchant, and rumors spread. Save a village, and statues are erected. Your choices have lasting consequences that persist across all sessions.',
                icon: '&#x1F9E0;',
              },
              {
                title: 'Adaptive Narrative Intelligence',
                description: 'The AI learns your playstyle and preferences. Love intrigue? Expect more political plots. Prefer combat? Face challenging tactical encounters. The story evolves to match how you play.',
                icon: '&#x1F4DC;',
              },
              {
                title: 'Rules-Aware Gameplay',
                description: 'Built-in understanding of classic fantasy RPG mechanics. Combat, skills, magic, character progression - all handled seamlessly so you can focus on roleplay and decisions.',
                icon: '&#x2694;',
              },
              {
                title: 'Character-Driven NPCs',
                description: 'NPCs with distinct personalities, motivations, and memory. Build friendships, make enemies, and watch relationships evolve based on how you treat each character.',
                icon: '&#x1F465;',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="flex gap-6 p-6 rounded-xl bg-slate-800/30 border border-slate-700/50 hover:border-amber-500/30 transition-colors"
              >
                <div className="text-4xl flex-shrink-0" dangerouslySetInnerHTML={{ __html: feature.icon }} />
                <div>
                  <h3 className="font-display text-xl font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="relative section" id="faq">
        <div className="container max-w-3xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white text-center mb-4">
            AI Game Master FAQ
          </h2>
          <p className="text-slate-400 text-center mb-12">
            Common questions about AI-powered tabletop gaming
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
                    className="faq-chevron w-5 h-5 text-violet-400 flex-shrink-0 transition-transform duration-200"
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
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(251, 191, 36, 0.1) 100%)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
            }}
          >
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
              Ready to Meet Your AI Game Master?
            </h2>
            <p className="text-slate-300 text-lg mb-8 max-w-xl mx-auto">
              Join the beta waitlist and be among the first to experience the future of solo tabletop gaming.
            </p>

            <form
              data-waitlist-form
              data-source="ai-gm-footer"
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-6"
            >
              <input
                type="email"
                name="email"
                placeholder="your@email.com"
                required
                className="flex-1 px-5 py-4 bg-slate-800/80 border border-slate-600/50 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
              />
              <button
                type="submit"
                data-track-cta="ai-gm-footer"
                className="px-8 py-4 font-semibold text-white rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-violet-500/25"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
                }}
              >
                Join Waitlist
              </button>
            </form>
            <p data-form-message className="text-sm" />
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
              <a href="/" className="hover:text-amber-400 transition-colors">Home</a>
              <a href="/solo-tabletop-rpg" className="hover:text-amber-400 transition-colors">Solo RPG</a>
              <a href="/blog" className="hover:text-amber-400 transition-colors">Blog</a>
              <a href="/privacy" className="hover:text-amber-400 transition-colors">Privacy</a>
            </nav>

            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} {site.name}
            </p>
          </div>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
}
