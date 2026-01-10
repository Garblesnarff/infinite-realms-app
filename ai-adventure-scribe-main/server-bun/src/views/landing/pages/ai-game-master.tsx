import type { SiteConfig } from '../../../config/site.js';
import type { FAQItem } from '../schema.js';

interface AIGameMasterPageProps {
  site: SiteConfig;
  faqItems: FAQItem[];
}

export function AIGameMasterPage({ site, faqItems }: AIGameMasterPageProps) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* Atmospheric Background - Mystical Purple/Gold blend */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: `
            radial-gradient(ellipse 120% 80% at 50% -30%, rgba(76, 29, 149, 0.2) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 90% 40%, rgba(184, 134, 11, 0.1) 0%, transparent 50%),
            radial-gradient(ellipse 80% 60% at 10% 70%, rgba(127, 29, 29, 0.08) 0%, transparent 50%),
            linear-gradient(180deg, #050505 0%, #0a0a0a 50%, #050505 100%)
          `,
        }}
      />

      {/* Arcane Particle Field */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          opacity: 0.35,
          backgroundImage: `
            radial-gradient(2px 2px at 80px 100px, rgba(124, 58, 237, 0.7), transparent),
            radial-gradient(1.5px 1.5px at 200px 50px, rgba(184, 134, 11, 0.6), transparent),
            radial-gradient(1px 1px at 150px 200px, rgba(124, 58, 237, 0.5), transparent),
            radial-gradient(2px 2px at 350px 150px, rgba(184, 134, 11, 0.8), transparent),
            radial-gradient(1.5px 1.5px at 450px 80px, rgba(124, 58, 237, 0.6), transparent),
            radial-gradient(1px 1px at 500px 250px, rgba(184, 134, 11, 0.5), transparent)
          `,
          backgroundSize: '600px 350px',
        }}
      />

      {/* ========== HERO SECTION ========== */}
      <section
        style={{
          position: 'relative',
          minHeight: '90vh',
          display: 'flex',
          alignItems: 'center',
          padding: '8rem 1.5rem 6rem',
          zIndex: 2,
        }}
      >
        <div className="container" style={{ maxWidth: '1100px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
              gap: '4rem',
              alignItems: 'center',
            }}
          >
            {/* Left: Content */}
            <div>
              {/* Breadcrumb */}
              <nav
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '2rem',
                  fontSize: '0.9rem',
                }}
              >
                <a
                  href="/"
                  style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
                >
                  {site.name}
                </a>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <span style={{ color: 'var(--mystic)' }}>AI Game Master</span>
              </nav>

              {/* H1 - SEO Keyword Focus */}
              <h1
                className="font-display"
                style={{
                  fontSize: 'clamp(2rem, 6vw, 3.5rem)',
                  lineHeight: 1.15,
                  marginBottom: '1.5rem',
                }}
              >
                <span style={{ color: 'var(--text-primary)' }}>What is an</span>
                <br />
                <span
                  className="glow-gold"
                  style={{ color: 'var(--gold)' }}
                >
                  AI Game Master?
                </span>
              </h1>

              {/* AEO-Optimized First Paragraph */}
              <p
                className="font-elegant"
                style={{
                  fontSize: '1.25rem',
                  lineHeight: 1.7,
                  color: 'var(--text-secondary)',
                  marginBottom: '1rem',
                }}
              >
                An <strong style={{ color: 'var(--gold)' }}>AI Game Master</strong> is an artificial
                intelligence system that runs tabletop roleplaying games. Unlike human GMs, an AI GM
                is available 24/7, remembers every detail of your campaign, and never needs prep time.
              </p>

              <p
                style={{
                  fontSize: '1.1rem',
                  lineHeight: 1.7,
                  color: 'var(--text-muted)',
                  marginBottom: '2rem',
                }}
              >
                Infinite Realms creates an intelligent GM that understands classic fantasy RPG rules,
                crafts adaptive narratives based on your choices, and brings NPCs to life with
                distinct personalities. Perfect for solo players, busy schedules, or anyone craving
                epic adventures.
              </p>

              {/* CTA Form */}
              <form
                data-waitlist-form
                data-source="ai-gm-hero"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  marginBottom: '1rem',
                }}
              >
                <input
                  type="email"
                  name="email"
                  placeholder="Enter your email..."
                  required
                  className="input-arcane"
                  style={{ flex: '1 1 250px' }}
                />
                <button type="submit" data-track-cta="ai-gm-hero" className="btn-primary">
                  Try AI GM Free
                </button>
              </form>
              <p data-form-message style={{ fontSize: '0.875rem' }} />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Join the beta waitlist — no credit card required
              </p>
            </div>

            {/* Right: Mystical Visualization */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  position: 'relative',
                  width: '320px',
                  height: '320px',
                }}
              >
                {/* Outer mystical ring */}
                <div
                  className="animate-float"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                    borderRadius: '50%',
                  }}
                />
                {/* Inner ring */}
                <div
                  style={{
                    position: 'absolute',
                    inset: '30px',
                    border: '1px solid rgba(184, 134, 11, 0.25)',
                    borderRadius: '50%',
                  }}
                />
                {/* Core */}
                <div
                  style={{
                    position: 'absolute',
                    inset: '60px',
                    background: 'radial-gradient(circle, rgba(76, 29, 149, 0.3) 0%, rgba(184, 134, 11, 0.1) 100%)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ fontSize: '4rem' }}>🧙</span>
                </div>
                {/* Rune markers */}
                <span
                  className="animate-pulse-glow"
                  style={{
                    position: 'absolute',
                    top: '0',
                    left: '50%',
                    transform: 'translateX(-50%) translateY(-50%)',
                    color: 'var(--mystic)',
                    fontSize: '1.5rem',
                  }}
                >
                  ✦
                </span>
                <span
                  className="animate-pulse-glow"
                  style={{
                    position: 'absolute',
                    bottom: '0',
                    left: '50%',
                    transform: 'translateX(-50%) translateY(50%)',
                    color: 'var(--gold)',
                    fontSize: '1.5rem',
                    animationDelay: '1s',
                  }}
                >
                  ✦
                </span>
                <span
                  className="animate-pulse-glow"
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '0',
                    transform: 'translateY(-50%) translateX(-50%)',
                    color: 'var(--mystic)',
                    fontSize: '1.5rem',
                    animationDelay: '0.5s',
                  }}
                >
                  ✧
                </span>
                <span
                  className="animate-pulse-glow"
                  style={{
                    position: 'absolute',
                    top: '50%',
                    right: '0',
                    transform: 'translateY(-50%) translateX(50%)',
                    color: 'var(--gold)',
                    fontSize: '1.5rem',
                    animationDelay: '1.5s',
                  }}
                >
                  ✧
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== QUICK ANSWER BOX (AEO) ========== */}
      <section className="section" style={{ paddingTop: 0, position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '800px' }}>
          <div
            className="answer-box"
            style={{ borderLeftColor: 'var(--mystic)' }}
          >
            <h2
              className="font-display"
              style={{
                fontSize: '1.5rem',
                color: 'var(--mystic)',
                marginBottom: '1.25rem',
              }}
            >
              Quick Answer: AI Game Master Explained
            </h2>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {[
                { text: 'Artificial intelligence that runs tabletop RPG games', bold: true },
                { text: 'Available anytime, no scheduling needed' },
                { text: 'Remembers your entire campaign history' },
                { text: 'Handles all rules and dice mechanics' },
                { text: 'Creates adaptive, personalized stories' },
              ].map((item, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    marginBottom: '0.6rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ color: 'var(--mystic)', marginTop: '0.2rem' }}>✓</span>
                  <span style={{ fontWeight: item.bold ? 600 : 400 }}>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ========== COMPARISON SECTION ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '1000px' }}>
          <h2
            className="font-display glow-gold"
            style={{
              fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
              color: 'var(--parchment)',
              textAlign: 'center',
              marginBottom: '3rem',
            }}
          >
            AI Game Master vs Human Game Master
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '2rem',
            }}
          >
            {/* AI GM Column */}
            <div
              style={{
                padding: '2rem',
                background: 'linear-gradient(135deg, rgba(184, 134, 11, 0.08) 0%, rgba(26, 26, 26, 0.6) 100%)',
                border: '1px solid rgba(184, 134, 11, 0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '2rem' }}>🤖</span>
                <h3 className="font-display" style={{ fontSize: '1.25rem', color: 'var(--gold)' }}>
                  AI Game Master
                </h3>
              </div>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {[
                  'Available 24/7 — play anytime you want',
                  'Perfect memory — never forgets NPCs or plot',
                  'Zero prep time — start playing instantly',
                  'Consistent rules application',
                  'Infinite patience and adaptability',
                ].map((item, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      marginBottom: '0.75rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ color: '#22c55e', marginTop: '0.2rem' }}>✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Human GM Column */}
            <div
              style={{
                padding: '2rem',
                background: 'linear-gradient(135deg, rgba(76, 29, 149, 0.08) 0%, rgba(26, 26, 26, 0.6) 100%)',
                border: '1px solid rgba(76, 29, 149, 0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '2rem' }}>🧙</span>
                <h3 className="font-display" style={{ fontSize: '1.25rem', color: 'var(--mystic)' }}>
                  Human Game Master
                </h3>
              </div>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {[
                  'Requires scheduling and coordination',
                  'May forget details between sessions',
                  'Needs significant prep time',
                  'Creative improvisation and emotional depth',
                  'Social connection with friends',
                ].map((item, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      marginBottom: '0.75rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ color: 'var(--mystic)', marginTop: '0.2rem' }}>◆</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p
            className="font-elegant"
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '1.1rem',
              marginTop: '2rem',
              maxWidth: '700px',
              margin: '2rem auto 0',
            }}
          >
            AI Game Masters don't replace human GMs — they complement them. Perfect for solo adventures,
            practice sessions, or when your group can't coordinate schedules.
          </p>
        </div>
      </section>

      {/* ========== FEATURES DEEP DIVE ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '900px' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2
              className="font-display glow-gold"
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
                color: 'var(--parchment)',
                marginBottom: '1rem',
              }}
            >
              What Makes Our AI Game Master Different
            </h2>
            <p className="font-elegant" style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
              Built specifically for tabletop RPG storytelling, not generic chatbots
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {[
              {
                icon: '🧠',
                title: 'Persistent World Memory',
                description:
                  'Every NPC remembers their interactions with you. Steal from a merchant, and rumors spread. Save a village, and statues are erected. Your choices have lasting consequences.',
              },
              {
                icon: '📜',
                title: 'Adaptive Narrative Intelligence',
                description:
                  'The AI learns your playstyle and preferences. Love intrigue? Expect more political plots. Prefer combat? Face challenging tactical encounters.',
              },
              {
                icon: '⚔️',
                title: 'Rules-Aware Gameplay',
                description:
                  'Built-in understanding of classic fantasy RPG mechanics. Combat, skills, magic, character progression — all handled seamlessly.',
              },
              {
                icon: '🎭',
                title: 'Character-Driven NPCs',
                description:
                  'NPCs with distinct personalities, motivations, and memory. Build friendships, make enemies, and watch relationships evolve.',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="feature-card"
                style={{
                  display: 'flex',
                  gap: '1.5rem',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ fontSize: '2.5rem', flexShrink: 0 }}>{feature.icon}</div>
                <div>
                  <h3
                    className="font-display"
                    style={{
                      fontSize: '1.25rem',
                      color: 'var(--parchment)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    {feature.title}
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FAQ SECTION ========== */}
      <section className="section" id="faq" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '750px' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2
              className="font-display"
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
                color: 'var(--parchment)',
                marginBottom: '0.75rem',
              }}
            >
              AI Game Master FAQ
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>Common questions about AI-powered tabletop gaming</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {faqItems.map((item, index) => (
              <details key={index} className="faq-item">
                <summary>
                  <span className="font-elegant" style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                    {item.question}
                  </span>
                  <svg
                    className="faq-chevron"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </summary>
                <div className="faq-content">{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FINAL CTA ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2, paddingBottom: '8rem' }}>
        <div className="container" style={{ maxWidth: '700px' }}>
          <div
            className="tome-border"
            style={{
              textAlign: 'center',
              padding: '3rem 2rem',
              background: 'linear-gradient(135deg, rgba(76, 29, 149, 0.1) 0%, rgba(184, 134, 11, 0.05) 100%)',
            }}
          >
            <h2
              className="font-display glow-gold"
              style={{
                fontSize: 'clamp(1.5rem, 4vw, 2.25rem)',
                color: 'var(--parchment)',
                marginBottom: '1rem',
              }}
            >
              Ready to Meet Your AI Game Master?
            </h2>
            <p
              className="font-elegant"
              style={{
                fontSize: '1.1rem',
                color: 'var(--text-secondary)',
                marginBottom: '2rem',
                maxWidth: '500px',
                margin: '0 auto 2rem',
              }}
            >
              Join the beta waitlist and be among the first to experience the future of solo tabletop gaming.
            </p>

            <form
              data-waitlist-form
              data-source="ai-gm-footer"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '1rem',
                maxWidth: '450px',
                margin: '0 auto 1rem',
              }}
            >
              <input
                type="email"
                name="email"
                placeholder="your@email.com"
                required
                className="input-arcane"
                style={{ flex: '1 1 200px' }}
              />
              <button
                type="submit"
                data-track-cta="ai-gm-footer"
                className="btn-primary"
                style={{
                  background: 'linear-gradient(135deg, var(--mystic) 0%, #6d28d9 100%)',
                }}
              >
                Join Waitlist
              </button>
            </form>
            <p data-form-message style={{ fontSize: '0.875rem' }} />
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer
        style={{
          position: 'relative',
          zIndex: 2,
          borderTop: '1px solid rgba(184, 134, 11, 0.1)',
          padding: '3rem 1.5rem',
        }}
      >
        <div className="container" style={{ maxWidth: '1100px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1.5rem',
            }}
          >
            <a href="/" className="font-display" style={{ fontSize: '1.25rem', color: 'var(--parchment)', textDecoration: 'none' }}>
              {site.name}
            </a>

            <nav style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              {[
                { href: '/', label: 'Home' },
                { href: '/solo-tabletop-rpg', label: 'Solo RPG' },
                { href: '/blog', label: 'Blog' },
                { href: '/privacy', label: 'Privacy' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  style={{
                    color: 'var(--text-muted)',
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                  }}
                >
                  {link.label}
                </a>
              ))}
            </nav>

            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              © {new Date().getFullYear()} {site.name}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
