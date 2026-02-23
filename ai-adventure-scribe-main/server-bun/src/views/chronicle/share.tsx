/* eslint-disable max-lines */
/**
 * Chronicle Share Page
 *
 * Completely standalone SSR page for publicly shared session chronicles.
 * No React app shell, no Vite assets, no Tailwind — pure inline styles.
 * Optimised for social sharing via Open Graph and Twitter Card meta tags.
 */

const FALLBACK_OG_IMAGE = 'https://infiniterealms.app/og-image.png';
const SITE_URL = 'https://infiniterealms.app';

export interface ChronicleSharePageProps {
  chronicle: {
    chapterTitle: string;
    chronicleText: string;
    illustrationUrl: string | null;
    generatedAt: Date | null;
    sessionNumber: number | null;
    campaignName: string;
    shareToken: string;
  };
}

export function ChronicleSharePage({ chronicle }: ChronicleSharePageProps) {
  const {
    chapterTitle,
    chronicleText,
    illustrationUrl,
    generatedAt,
    sessionNumber,
    campaignName,
    shareToken,
  } = chronicle;

  const ogImage = illustrationUrl ?? FALLBACK_OG_IMAGE;
  const ogDescription =
    chronicleText.slice(0, 160).trimEnd() + (chronicleText.length > 160 ? '…' : '');
  const canonicalUrl = `${SITE_URL}/chronicle/${shareToken}`;

  const sessionLabel =
    sessionNumber !== null ? `${campaignName} — Session ${sessionNumber}` : campaignName;

  const formattedDate = generatedAt
    ? new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(generatedAt)
    : null;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{chapterTitle} | Infinite Realms — AI Dungeon Master</title>
        <link rel="canonical" href={canonicalUrl} />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="Infinite Realms — AI Dungeon Master" />
        <meta property="og:title" content={chapterTitle} />
        <meta property="og:description" content={ogDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={`Illustration for "${chapterTitle}"`} />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={chapterTitle} />
        <meta name="twitter:description" content={ogDescription} />
        <meta name="twitter:image" content={ogImage} />

        {/* Standard meta */}
        <meta name="description" content={ogDescription} />
        <meta name="robots" content="index, follow" />

        <style>{`
          *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          :root {
            --bg: #0a0a14;
            --surface: #12121f;
            --surface-border: #1e1e35;
            --text: #e8e0d0;
            --text-muted: #9490a0;
            --gold: #c9a84c;
            --gold-light: #e0c06a;
            --gold-dim: rgba(201, 168, 76, 0.15);
          }

          html, body {
            background-color: var(--bg);
            color: var(--text);
            font-family: Georgia, 'Times New Roman', Times, serif;
            line-height: 1.6;
            min-height: 100vh;
          }

          .page-wrapper {
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem 1.25rem 4rem;
          }

          /* ── Site badge ── */
          .site-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 0.75rem;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--gold);
            text-decoration: none;
            margin-bottom: 2.5rem;
            display: block;
          }

          .site-badge:hover {
            color: var(--gold-light);
          }

          /* ── Hero image ── */
          .hero-image {
            width: 100%;
            max-height: 300px;
            object-fit: cover;
            border-radius: 0.75rem;
            display: block;
            margin-bottom: 2rem;
            border: 1px solid var(--surface-border);
          }

          /* ── Session label ── */
          .session-label {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 0.8rem;
            font-weight: 500;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 0.75rem;
          }

          /* ── Chapter title ── */
          .chapter-title {
            font-family: Georgia, 'Times New Roman', Times, serif;
            font-size: clamp(1.75rem, 5vw, 2.75rem);
            font-weight: 700;
            line-height: 1.2;
            color: var(--gold);
            margin-bottom: 1rem;
          }

          /* ── Date line ── */
          .chronicle-date {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 0.8rem;
            color: var(--text-muted);
            margin-bottom: 2rem;
          }

          /* ── Divider ── */
          .divider {
            border: none;
            border-top: 1px solid var(--surface-border);
            margin: 0 0 2rem;
          }

          /* ── Chronicle prose ── */
          .chronicle-text {
            font-size: 1.0625rem;
            line-height: 1.8;
            color: var(--text);
            white-space: pre-wrap;
          }

          .chronicle-text p {
            margin-bottom: 1.25em;
          }

          .chronicle-text p:last-child {
            margin-bottom: 0;
          }

          /* ── CTA box ── */
          .cta-box {
            margin-top: 3.5rem;
            padding: 2rem 1.75rem;
            background-color: var(--surface);
            border: 1px solid var(--surface-border);
            border-radius: 0.75rem;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1rem;
          }

          .cta-eyebrow {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 0.75rem;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--gold);
          }

          .cta-heading {
            font-family: Georgia, 'Times New Roman', Times, serif;
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text);
            line-height: 1.35;
          }

          .cta-sub {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 0.875rem;
            color: var(--text-muted);
          }

          .cta-button {
            display: inline-block;
            padding: 0.65rem 1.75rem;
            background-color: var(--gold);
            color: #0a0a14;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 0.9rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-decoration: none;
            border-radius: 0.375rem;
            transition: background-color 0.15s ease;
          }

          .cta-button:hover {
            background-color: var(--gold-light);
          }

          /* ── Footer ── */
          .page-footer {
            margin-top: 3rem;
            padding-top: 1.5rem;
            border-top: 1px solid var(--surface-border);
            text-align: center;
          }

          .page-footer p {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 0.75rem;
            color: var(--text-muted);
          }

          .page-footer a {
            color: var(--gold);
            text-decoration: none;
          }

          .page-footer a:hover {
            color: var(--gold-light);
          }

          @media (max-width: 600px) {
            .page-wrapper {
              padding: 1.5rem 1rem 3rem;
            }

            .cta-box {
              padding: 1.5rem 1.25rem;
            }
          }
        `}</style>
      </head>
      <body>
        <main className="page-wrapper" role="main">
          <a
            href={SITE_URL}
            className="site-badge"
            aria-label="Infinite Realms — AI Dungeon Master"
          >
            Infinite Realms
          </a>

          {illustrationUrl ? (
            <img
              src={illustrationUrl}
              alt={`Illustration for "${chapterTitle}"`}
              className="hero-image"
              loading="eager"
              decoding="async"
              width="800"
              height="300"
            />
          ) : null}

          <p className="session-label">{sessionLabel}</p>

          <h1 className="chapter-title">{chapterTitle}</h1>

          {formattedDate ? (
            <p className="chronicle-date">
              {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
              <time dateTime={generatedAt!.toISOString()}>{formattedDate}</time>
            </p>
          ) : null}

          <hr className="divider" aria-hidden="true" />

          <article className="chronicle-text" aria-label="Chronicle">
            {chronicleText.split('\n\n').map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>

          <aside className="cta-box" aria-label="Play Infinite Realms">
            <p className="cta-eyebrow">Written by an AI Dungeon Master</p>
            <p className="cta-heading">Your adventure awaits in the Infinite Realms</p>
            <p className="cta-sub">
              Create a character, choose your campaign, and let the AI guide your story.
            </p>
            <a href={SITE_URL} className="cta-button">
              Play for Free &rarr;
            </a>
          </aside>
        </main>

        <footer className="page-footer">
          <p>
            &copy; {new Date().getFullYear()} <a href={SITE_URL}>Infinite Realms</a>. All adventures
            generated by AI.
          </p>
        </footer>
      </body>
    </html>
  );
}
