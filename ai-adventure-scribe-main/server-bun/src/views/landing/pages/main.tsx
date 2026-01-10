import type { SiteConfig } from '../../../config/site.js';
import type { FAQItem } from '../schema.js';

interface MainLandingPageProps {
  site: SiteConfig;
  faqItems: FAQItem[];
}

export function MainLandingPage({ site, faqItems }: MainLandingPageProps) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* Atmospheric Background with Mystical Gradients */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: `
            radial-gradient(ellipse 100% 80% at 50% -20%, rgba(127, 29, 29, 0.25) 0%, transparent 60%),
            radial-gradient(ellipse 80% 60% at 80% 50%, rgba(184, 134, 11, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse 60% 50% at 10% 80%, rgba(76, 29, 149, 0.06) 0%, transparent 50%),
            linear-gradient(180deg, #050505 0%, #0a0a0a 40%, #050505 100%)
          `,
        }}
      />

      {/* Floating Arcane Particles */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          opacity: 0.4,
          backgroundImage: `
            radial-gradient(1.5px 1.5px at 100px 50px, rgba(184, 134, 11, 0.8), transparent),
            radial-gradient(1px 1px at 200px 150px, rgba(184, 134, 11, 0.5), transparent),
            radial-gradient(1.5px 1.5px at 50px 200px, rgba(127, 29, 29, 0.6), transparent),
            radial-gradient(1px 1px at 300px 100px, rgba(184, 134, 11, 0.4), transparent),
            radial-gradient(2px 2px at 400px 300px, rgba(184, 134, 11, 0.7), transparent),
            radial-gradient(1px 1px at 500px 50px, rgba(127, 29, 29, 0.5), transparent)
          `,
          backgroundSize: '550px 400px',
        }}
      />

      {/* ========== HERO SECTION ========== */}
      <section
        style={{
          position: 'relative',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6rem 1.5rem',
          zIndex: 2,
        }}
      >
        {/* Decorative Corner Flourishes */}
        <div
          style={{
            position: 'absolute',
            top: '2rem',
            left: '2rem',
            fontSize: '3rem',
            color: 'rgba(184, 134, 11, 0.15)',
            fontFamily: 'serif',
          }}
          aria-hidden="true"
        >
          ❧
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '2rem',
            right: '2rem',
            fontSize: '3rem',
            color: 'rgba(184, 134, 11, 0.15)',
            fontFamily: 'serif',
            transform: 'rotate(180deg)',
          }}
          aria-hidden="true"
        >
          ❧
        </div>

        <div style={{ maxWidth: '900px', textAlign: 'center' }}>
          {/* Arcane Symbol */}
          <div
            className="animate-pulse-glow"
            style={{
              fontSize: '1rem',
              letterSpacing: '0.5em',
              color: 'var(--gold)',
              marginBottom: '1.5rem',
              opacity: 0.8,
            }}
          >
            ✧ ─────── ✦ ─────── ✧
          </div>

          {/* Beta Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 1.25rem',
              marginBottom: '2rem',
              border: '1px solid rgba(127, 29, 29, 0.4)',
              background: 'rgba(127, 29, 29, 0.1)',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--ember)',
                animation: 'pulse-glow 2s ease-in-out infinite',
              }}
            />
            <span
              className="font-elegant"
              style={{
                fontSize: '0.875rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--ember)',
              }}
            >
              Closed Beta — Coming Soon
            </span>
          </div>

          {/* Main Headline */}
          <h1
            className="font-display glow-gold"
            style={{
              fontSize: 'clamp(2.5rem, 8vw, 5rem)',
              lineHeight: 1.1,
              marginBottom: '1.5rem',
              color: 'var(--parchment)',
            }}
          >
            Your AI Game Master
            <br />
            <span style={{ color: 'var(--gold)' }}>Awaits</span>
          </h1>

          {/* Elegant Subheadline */}
          <p
            className="font-elegant"
            style={{
              fontSize: 'clamp(1.125rem, 2.5vw, 1.5rem)',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              marginBottom: '1rem',
              maxWidth: '700px',
              margin: '0 auto 1rem',
            }}
          >
            Embark on solo tabletop RPG adventures with an AI that{' '}
            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>remembers every choice</em>,{' '}
            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>evolves your world</em>, and{' '}
            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>crafts legends</em> unique to you.
          </p>

          {/* Value Prop */}
          <p
            style={{
              fontSize: '1.125rem',
              color: 'var(--text-muted)',
              marginBottom: '3rem',
              letterSpacing: '0.02em',
            }}
          >
            No scheduling. No prep. No waiting. Your quest begins now.
          </p>

          {/* Waitlist Form with Mystical Glow */}
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: '2rem' }}>
            {/* Glow Effect */}
            <div
              style={{
                position: 'absolute',
                inset: '-20px',
                background: 'radial-gradient(circle, rgba(184, 134, 11, 0.2) 0%, transparent 70%)',
                filter: 'blur(20px)',
                pointerEvents: 'none',
              }}
            />

            <form
              data-waitlist-form
              data-source="hero"
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                padding: '1.5rem',
                background: 'rgba(10, 10, 10, 0.8)',
                border: '1px solid rgba(184, 134, 11, 0.2)',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                <input
                  type="email"
                  name="email"
                  placeholder="Enter your email to join the quest..."
                  required
                  className="input-arcane"
                  style={{ flex: '1 1 280px' }}
                />
                <button
                  type="submit"
                  data-track-cta="hero-waitlist"
                  className="btn-primary"
                >
                  Request Access
                </button>
              </div>
            </form>
            <p data-form-message style={{ marginTop: '0.75rem', fontSize: '0.875rem' }} />
          </div>

          {/* Trust Indicator */}
          <p
            style={{
              fontSize: '0.9rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <span style={{ color: 'var(--gold)' }}>★</span>
            <span>Join 500+ adventurers awaiting the beta</span>
          </p>
        </div>

        {/* Scroll Indicator */}
        <div className="scroll-indicator">
          <span style={{ fontFamily: "'Cormorant Garamond', serif", letterSpacing: '0.1em' }}>
            DISCOVER
          </span>
        </div>
      </section>

      {/* ========== ANSWER BOX (AEO) ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '800px' }}>
          {/* Section Divider */}
          <div className="divider-rune" style={{ marginBottom: '4rem' }}>
            ✦
          </div>

          <div className="answer-box">
            <h2
              className="font-display"
              style={{
                fontSize: '1.75rem',
                color: 'var(--gold)',
                marginBottom: '1.5rem',
              }}
            >
              What is an AI Game Master?
            </h2>
            <p
              style={{
                fontSize: '1.125rem',
                color: 'var(--text-primary)',
                marginBottom: '1.5rem',
                lineHeight: 1.8,
              }}
            >
              An <strong style={{ color: 'var(--gold)' }}>AI Game Master</strong> is an artificial
              intelligence that runs tabletop roleplaying games. It handles storytelling, rules, NPCs,
              and combat—available 24/7 without scheduling. Infinite Realms creates an intelligent GM
              that understands classic fantasy RPG rules, crafts adaptive narratives, and brings
              characters to life with distinct personalities.
            </p>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {[
                'Available anytime—no scheduling, no waiting for your group',
                'Remembers every character, choice, and consequence across sessions',
                'Handles all rules and dice mechanics automatically',
                'Creates adaptive stories that evolve with your decisions',
              ].map((item, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem',
                    marginBottom: '0.75rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ color: 'var(--blood)', marginTop: '0.25rem' }}>◆</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ========== FEATURES SECTION ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '1100px' }}>
          <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
            <h2
              className="font-display glow-gold"
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                color: 'var(--parchment)',
                marginBottom: '1rem',
              }}
            >
              What We're Forging
            </h2>
            <p
              className="font-elegant"
              style={{
                fontSize: '1.25rem',
                color: 'var(--text-muted)',
                maxWidth: '500px',
                margin: '0 auto',
              }}
            >
              Features in active development for our beta launch
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '1.5rem',
            }}
          >
            {[
              {
                icon: '📜',
                title: 'Stories That Remember',
                description:
                  'Every choice creates ripples. Save a village and they erect statues. Betray an ally and face consequences sessions later.',
                status: 'In Development',
              },
              {
                icon: '🎭',
                title: 'NPCs With Memory',
                description:
                  'Build relationships that evolve. NPCs remember your heroic sacrifices, betrayals, and moments of kindness.',
                status: 'Beta',
              },
              {
                icon: '⚔️',
                title: 'Seamless Rules',
                description:
                  'Focus on story and roleplay. The AI handles mechanics, spell interactions, and combat calculations perfectly.',
                status: 'In Development',
              },
              {
                icon: '🖼️',
                title: 'Living Worlds',
                description:
                  'Watch adventures come alive with cinematic visuals. Every shadowy tavern and ancient ruin rendered beautifully.',
                status: 'Planned',
              },
              {
                icon: '🎙️',
                title: 'Voice Acting',
                description:
                  'Hear your adventures with professional narration. Distinct character voices bring NPCs to life.',
                status: 'Planned',
              },
              {
                icon: '📚',
                title: 'Campaign as a Book',
                description:
                  'Transform your adventure into a beautiful storybook. Share your legend with artwork and narrative summaries.',
                status: 'Coming Soon',
              },
            ].map((feature, index) => (
              <div key={index} className="feature-card">
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{feature.icon}</div>
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
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.25rem 0.75rem',
                    fontSize: '0.75rem',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--blood)',
                    border: '1px solid rgba(127, 29, 29, 0.3)',
                    marginBottom: '1rem',
                  }}
                >
                  {feature.status}
                </span>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '900px' }}>
          <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
            <h2
              className="font-display glow-gold"
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                color: 'var(--parchment)',
                marginBottom: '1rem',
              }}
            >
              Your Journey Begins
            </h2>
            <p className="font-elegant" style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>
              Three steps to join the beta
            </p>
          </div>

          <div style={{ position: 'relative' }}>
            {/* Connecting Line */}
            <div
              style={{
                position: 'absolute',
                top: '2rem',
                left: '50%',
                right: '0',
                height: '1px',
                background: 'linear-gradient(90deg, transparent, var(--gold), transparent)',
                opacity: 0.3,
                display: 'none',
              }}
              className="md-show"
            />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '3rem',
              }}
            >
              {[
                {
                  step: 'I',
                  title: 'Join the Waitlist',
                  description: "Sign up with your email. We'll notify you when spots open.",
                },
                {
                  step: 'II',
                  title: 'Receive Your Invitation',
                  description: 'Get early access to create your account and build your world.',
                },
                {
                  step: 'III',
                  title: 'Shape the Future',
                  description: 'Playtest features, provide feedback, and help forge the ultimate AI GM.',
                },
              ].map((item, index) => (
                <div key={index} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: '4rem',
                      height: '4rem',
                      margin: '0 auto 1.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid var(--gold)',
                      background: 'rgba(184, 134, 11, 0.1)',
                    }}
                  >
                    <span
                      className="font-display"
                      style={{ fontSize: '1.5rem', color: 'var(--gold)' }}
                    >
                      {item.step}
                    </span>
                  </div>
                  <h3
                    className="font-display"
                    style={{
                      fontSize: '1.25rem',
                      color: 'var(--parchment)',
                      marginBottom: '0.75rem',
                    }}
                  >
                    {item.title}
                  </h3>
                  <p style={{ color: 'var(--text-secondary)' }}>{item.description}</p>
                </div>
              ))}
            </div>
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
                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                color: 'var(--parchment)',
                marginBottom: '1rem',
              }}
            >
              Frequently Asked Questions
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {faqItems.map((item, index) => (
              <details key={index} className="faq-item">
                <summary>
                  <span
                    className="font-elegant"
                    style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}
                  >
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
              background: 'linear-gradient(135deg, rgba(127, 29, 29, 0.08) 0%, rgba(26, 26, 26, 0.6) 100%)',
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
              Your Adventure Awaits
            </h2>
            <p
              className="font-elegant"
              style={{
                fontSize: '1.125rem',
                color: 'var(--text-secondary)',
                marginBottom: '2rem',
                maxWidth: '500px',
                margin: '0 auto 2rem',
              }}
            >
              Beta spots are limited. Claim your place among the first to experience the AI Game Master.
            </p>

            <form
              data-waitlist-form
              data-source="footer"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '1rem',
                maxWidth: '450px',
                margin: '0 auto 1.5rem',
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
              <button type="submit" data-track-cta="footer-waitlist" className="btn-primary">
                Join the Quest
              </button>
            </form>
            <p data-form-message style={{ fontSize: '0.875rem' }} />

            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '1rem' }}>
              <span style={{ color: 'var(--gold)' }}>★</span> 500+ adventurers already waiting
            </p>
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
            <span className="font-display" style={{ fontSize: '1.25rem', color: 'var(--parchment)' }}>
              {site.name}
            </span>

            <nav style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              {[
                { href: '/ai-game-master', label: 'AI Game Master' },
                { href: '/solo-tabletop-rpg', label: 'Solo RPG' },
                { href: '/blog', label: 'Blog' },
                { href: '/privacy', label: 'Privacy' },
                { href: '/terms', label: 'Terms' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  style={{
                    color: 'var(--text-muted)',
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                    transition: 'color 0.3s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--gold)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                >
                  {link.label}
                </a>
              ))}
            </nav>

            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              © {new Date().getFullYear()} {site.name}
            </span>
          </div>

          <p
            style={{
              textAlign: 'center',
              color: 'rgba(107, 101, 96, 0.6)',
              fontSize: '0.75rem',
              marginTop: '2rem',
            }}
          >
            Infinite Realms is not affiliated with Wizards of the Coast. All game content uses SRD/OGL
            licensed material where applicable.
          </p>
        </div>
      </footer>
    </div>
  );
}
