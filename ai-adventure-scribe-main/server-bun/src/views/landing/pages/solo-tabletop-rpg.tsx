import type { SiteConfig } from '../../../config/site.js';
import type { FAQItem } from '../schema.js';

interface SoloTabletopRPGPageProps {
  site: SiteConfig;
  faqItems: FAQItem[];
}

export function SoloTabletopRPGPage({ site, faqItems }: SoloTabletopRPGPageProps) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* Atmospheric Background - Warm Ember Tones */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: `
            radial-gradient(ellipse 100% 70% at 30% -10%, rgba(234, 88, 12, 0.18) 0%, transparent 60%),
            radial-gradient(ellipse 70% 50% at 80% 60%, rgba(184, 134, 11, 0.1) 0%, transparent 50%),
            radial-gradient(ellipse 60% 50% at 10% 80%, rgba(127, 29, 29, 0.08) 0%, transparent 50%),
            linear-gradient(180deg, #050505 0%, #0a0a0a 50%, #050505 100%)
          `,
        }}
      />

      {/* Ember Particle Effect */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          opacity: 0.4,
          backgroundImage: `
            radial-gradient(2px 2px at 100px 80px, rgba(251, 146, 60, 0.8), transparent),
            radial-gradient(1.5px 1.5px at 250px 150px, rgba(234, 88, 12, 0.6), transparent),
            radial-gradient(1px 1px at 180px 250px, rgba(251, 146, 60, 0.5), transparent),
            radial-gradient(2px 2px at 380px 100px, rgba(184, 134, 11, 0.7), transparent),
            radial-gradient(1.5px 1.5px at 450px 200px, rgba(234, 88, 12, 0.5), transparent),
            radial-gradient(1px 1px at 520px 60px, rgba(251, 146, 60, 0.6), transparent)
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
        <div className="container" style={{ maxWidth: '1000px' }}>
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
            <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              {site.name}
            </a>
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <span style={{ color: '#fb923c' }}>Solo Tabletop RPG</span>
          </nav>

          {/* Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 1.25rem',
              marginBottom: '2rem',
              border: '1px solid rgba(251, 146, 60, 0.3)',
              background: 'rgba(234, 88, 12, 0.1)',
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>🎲</span>
            <span
              className="font-elegant"
              style={{
                fontSize: '0.875rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#fb923c',
              }}
            >
              No Group Required
            </span>
          </div>

          {/* H1 - SEO Focus */}
          <h1
            className="font-display"
            style={{
              fontSize: 'clamp(2.5rem, 7vw, 4rem)',
              lineHeight: 1.1,
              marginBottom: '1.5rem',
            }}
          >
            <span
              className="glow-gold"
              style={{ color: '#fb923c' }}
            >
              Solo Tabletop RPG
            </span>
            <br />
            <span
              className="font-elegant"
              style={{
                fontSize: 'clamp(1.5rem, 4vw, 2.25rem)',
                color: 'var(--text-primary)',
                fontWeight: 400,
              }}
            >
              Epic Adventures, Party of One
            </span>
          </h1>

          {/* AEO-Optimized Content */}
          <p
            className="font-elegant"
            style={{
              fontSize: '1.25rem',
              lineHeight: 1.7,
              color: 'var(--text-secondary)',
              marginBottom: '1rem',
              maxWidth: '700px',
            }}
          >
            <strong style={{ color: '#fb923c' }}>Yes, you can play tabletop RPG alone</strong> — and
            it's incredible. With an AI Game Master like Infinite Realms, you get the full tabletop
            experience: character creation, exploration, combat, and storytelling on your schedule.
          </p>

          <p
            style={{
              fontSize: '1.1rem',
              lineHeight: 1.7,
              color: 'var(--text-muted)',
              marginBottom: '2.5rem',
              maxWidth: '650px',
            }}
          >
            No more scheduling conflicts. No more canceled sessions. No more waiting for your group.
            Your adventure is always ready when you are.
          </p>

          {/* CTA Form */}
          <form
            data-waitlist-form
            data-source="solo-rpg-hero"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1rem',
              maxWidth: '500px',
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
            <button
              type="submit"
              data-track-cta="solo-rpg-hero"
              className="btn-primary"
              style={{
                background: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
              }}
            >
              Start Solo Adventure
            </button>
          </form>
          <p data-form-message style={{ fontSize: '0.875rem' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Free beta access — no credit card required
          </p>
        </div>
      </section>

      {/* ========== ANSWER BOX (AEO) ========== */}
      <section className="section" style={{ paddingTop: 0, position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '800px' }}>
          <div className="answer-box" style={{ borderLeftColor: '#ea580c' }}>
            <h2
              className="font-display"
              style={{
                fontSize: '1.5rem',
                color: '#fb923c',
                marginBottom: '1.25rem',
              }}
            >
              Can You Play Tabletop RPG Alone? Absolutely.
            </h2>
            <p
              style={{
                fontSize: '1.1rem',
                color: 'var(--text-primary)',
                marginBottom: '1rem',
                lineHeight: 1.7,
              }}
            >
              Solo tabletop RPG is a growing hobby with thousands of players worldwide.
              Here's what you need to know:
            </p>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {[
                'Full RPG experience — same character creation, exploration, and combat',
                'AI Game Master handles storytelling, NPCs, and rules',
                'Play anytime — 10 minutes or 10 hours, your choice',
                'No experience required — perfect for newcomers',
                'Your world persists — continue your story across sessions',
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
                  <span style={{ color: '#ea580c', marginTop: '0.2rem' }}>✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ========== WHY SOLO SECTION ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '1000px' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2
              className="font-display glow-gold"
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                color: 'var(--parchment)',
                marginBottom: '1rem',
              }}
            >
              Why Play Tabletop RPG Solo?
            </h2>
            <p className="font-elegant" style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
              Solo gaming offers a unique experience that group play can't match
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.5rem',
            }}
          >
            {[
              {
                icon: '⏰',
                title: 'Play on Your Schedule',
                description:
                  'No more coordinating calendars with 4-6 people. Your adventure is ready whenever you have 10 minutes or 10 hours.',
              },
              {
                icon: '🎭',
                title: 'Deep Character Immersion',
                description:
                  'Fully inhabit your character without distractions. Explore motivations, make tough choices, develop their arc.',
              },
              {
                icon: '🛤️',
                title: 'Your Story, Your Pace',
                description:
                  'Spend an hour in the tavern gathering rumors, or rush into the dungeon. No pressure from other players.',
              },
              {
                icon: '📖',
                title: 'Learn at Your Speed',
                description:
                  'New to tabletop RPG? Practice rules, try different strategies, and learn without judgment.',
              },
              {
                icon: '🌍',
                title: 'Explore Freely',
                description:
                  'Go off the beaten path. Investigate that mysterious ruin. Follow your curiosity wherever it leads.',
              },
              {
                icon: '✨',
                title: 'Consistent World',
                description:
                  'The AI remembers everything. NPCs recall your deeds. Your choices matter and persist forever.',
              },
            ].map((item, index) => (
              <div key={index} className="feature-card">
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{item.icon}</div>
                <h3
                  className="font-display"
                  style={{
                    fontSize: '1.125rem',
                    color: 'var(--parchment)',
                    marginBottom: '0.5rem',
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '800px' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2
              className="font-display glow-gold"
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
                color: 'var(--parchment)',
                marginBottom: '1rem',
              }}
            >
              How Solo Tabletop RPG Works
            </h2>
            <p className="font-elegant" style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
              With Infinite Realms, getting started is simple
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {[
              {
                step: 'I',
                title: 'Create Your Character',
                description:
                  'Build your hero with our guided character creator. Choose your class, background, and personality — or let the AI surprise you.',
              },
              {
                step: 'II',
                title: 'Set Your Adventure',
                description:
                  'Pick a campaign setting or describe the world you want to explore. The AI adapts to create the perfect adventure for you.',
              },
              {
                step: 'III',
                title: 'Play Your Way',
                description:
                  'Type your actions, make choices, roll dice. The AI Game Master responds with vivid descriptions, NPC dialogue, and dynamic encounters.',
              },
              {
                step: 'IV',
                title: 'Continue Anytime',
                description:
                  'Your world is saved automatically. Pick up your adventure whenever inspiration strikes — the story remembers where you left off.',
              },
            ].map((item, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  gap: '1.5rem',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: '3.5rem',
                    height: '3.5rem',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid #fb923c',
                    background: 'rgba(251, 146, 60, 0.1)',
                  }}
                >
                  <span className="font-display" style={{ fontSize: '1.25rem', color: '#fb923c' }}>
                    {item.step}
                  </span>
                </div>
                <div style={{ paddingTop: '0.25rem' }}>
                  <h3
                    className="font-display"
                    style={{
                      fontSize: '1.25rem',
                      color: 'var(--parchment)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    {item.title}
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== QUOTE SECTION ========== */}
      <section className="section" style={{ position: 'relative', zIndex: 2 }}>
        <div className="container" style={{ maxWidth: '700px' }}>
          <blockquote
            className="tome-border"
            style={{
              textAlign: 'center',
              padding: '2.5rem 2rem',
              background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.08) 0%, rgba(26, 26, 26, 0.6) 100%)',
            }}
          >
            <p
              className="font-elegant"
              style={{
                fontSize: 'clamp(1.25rem, 3vw, 1.75rem)',
                color: 'var(--text-primary)',
                fontStyle: 'italic',
                marginBottom: '1.5rem',
                lineHeight: 1.6,
              }}
            >
              "Solo RPG isn't a compromise — it's a different kind of magic. A chance to lose yourself
              completely in another world, on your terms."
            </p>
            <cite
              style={{
                color: '#fb923c',
                fontStyle: 'normal',
                fontSize: '0.9rem',
                letterSpacing: '0.05em',
              }}
            >
              — The Solo RPG Community
            </cite>
          </blockquote>
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
              Solo Tabletop RPG FAQ
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>Everything you need to know about playing alone</p>
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
                    style={{ color: '#fb923c' }}
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
              background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.1) 0%, rgba(234, 88, 12, 0.05) 100%)',
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
              Ready for Solo Adventure?
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
              Join the beta waitlist and start your solo tabletop RPG journey with an AI Game Master
              that's always ready to play.
            </p>

            <form
              data-waitlist-form
              data-source="solo-rpg-footer"
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
                data-track-cta="solo-rpg-footer"
                className="btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
                }}
              >
                Join Waitlist
              </button>
            </form>
            <p data-form-message style={{ fontSize: '0.875rem' }} />

            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '1rem' }}>
              No group required. No experience needed.
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
            <a href="/" className="font-display" style={{ fontSize: '1.25rem', color: 'var(--parchment)', textDecoration: 'none' }}>
              {site.name}
            </a>

            <nav style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              {[
                { href: '/', label: 'Home' },
                { href: '/ai-game-master', label: 'AI Game Master' },
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
