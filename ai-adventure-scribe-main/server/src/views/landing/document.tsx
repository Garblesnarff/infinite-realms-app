import type { ReactNode } from 'react';
import type { ResolvedAssets } from '../../lib/manifest.js';
import type { SiteConfig } from '../../config/site.js';

export interface LandingMeta {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string | null;
  keywords?: string[];
  noindex?: boolean;
}

interface LandingDocumentProps {
  site: SiteConfig;
  assets: ResolvedAssets | null;
  meta: LandingMeta;
  children: ReactNode;
  preloadState?: unknown;
  structuredData?: unknown[];
}

export function LandingDocument({
  site,
  assets,
  meta,
  children,
  preloadState,
  structuredData,
}: LandingDocumentProps) {
  const scripts = assets?.scripts ?? [];
  const styles = assets?.styles ?? [];
  const preloads = assets?.preloads ?? [];
  const additionalAssets = assets?.assets ?? [];
  const serializedState = preloadState ? serializeJson(preloadState) : null;
  const structuredJson = structuredData?.length ? structuredData.map(serializeJson) : [];
  const ogImage = meta.imageUrl || site.defaultSocialImageUrl;
  const allKeywords = meta.keywords ?? [];

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0a0a" />
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        {allKeywords.length > 0 ? <meta name="keywords" content={allKeywords.join(', ')} /> : null}
        <link rel="canonical" href={meta.canonicalUrl} />
        {meta.noindex ? <meta name="robots" content="noindex, nofollow" /> : <meta name="robots" content="index, follow" />}

        {/* Open Graph */}
        <meta property="og:site_name" content={site.name} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={meta.canonicalUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:alt" content={meta.title} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <meta name="twitter:image" content={ogImage} />
        <meta name="twitter:image:alt" content={meta.title} />
        <meta name="twitter:site" content={site.twitterHandle} />

        {/* Preloads */}
        {preloads.map((href) => (
          <link key={href} rel="modulepreload" href={href} crossOrigin="anonymous" />
        ))}
        {styles.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {additionalAssets.map((href) => (
          <link key={href} rel="preload" as="image" href={href} />
        ))}

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" />

        {/* Distinctive Fonts - NOT generic Inter/Roboto */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Crimson+Pro:ital,wght@0,400;0,500;0,600;0,700;1,400&family=MedievalSharp&display=swap"
        />

        {/* Critical CSS - Dark Arcane Tome Aesthetic */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* ========================================
                 DARK ARCANE TOME - Design System
                 Aesthetic: Ancient illuminated manuscripts
                 meet dark fantasy epic storytelling
              ======================================== */

              :root {
                /* Deep darkness with warmth */
                --void: #050505;
                --obsidian: #0a0a0a;
                --shadow: #121212;
                --stone: #1a1a1a;
                --ash: #2a2a2a;

                /* Parchment tones */
                --parchment: #f4e4c1;
                --aged-paper: #d4c4a1;
                --ink: #2c2416;

                /* Blood & Gold - the fantasy palette */
                --blood: #7f1d1d;
                --crimson: #991b1b;
                --ember: #dc2626;
                --gold: #b8860b;
                --antique-gold: #d4a017;
                --pale-gold: #f4d03f;

                /* Mystical accents */
                --arcane: #4c1d95;
                --mystic: #7c3aed;

                /* Text */
                --text-primary: #e8e0d5;
                --text-secondary: #a8a095;
                --text-muted: #6b6560;
              }

              *, *::before, *::after {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
              }

              html {
                scroll-behavior: smooth;
                font-size: 16px;
              }

              body {
                font-family: 'Crimson Pro', Georgia, 'Times New Roman', serif;
                background: var(--obsidian);
                color: var(--text-primary);
                line-height: 1.7;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                overflow-x: hidden;
              }

              /* Typography */
              .font-display {
                font-family: 'MedievalSharp', 'Luminari', fantasy;
                letter-spacing: 0.02em;
              }

              .font-elegant {
                font-family: 'Cormorant Garamond', 'Palatino Linotype', serif;
                font-weight: 500;
              }

              /* Parchment texture overlay */
              .parchment-noise {
                position: relative;
              }
              .parchment-noise::before {
                content: '';
                position: absolute;
                inset: 0;
                opacity: 0.03;
                pointer-events: none;
                background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
              }

              /* Vignette effect */
              .vignette::after {
                content: '';
                position: fixed;
                inset: 0;
                pointer-events: none;
                background: radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(0,0,0,0.4) 100%);
                z-index: 1;
              }

              /* Decorative border corners */
              .tome-border {
                position: relative;
                border: 1px solid rgba(184, 134, 11, 0.2);
              }
              .tome-border::before,
              .tome-border::after {
                content: '❧';
                position: absolute;
                font-size: 1.5rem;
                color: var(--gold);
                opacity: 0.6;
              }
              .tome-border::before {
                top: -0.75rem;
                left: 1rem;
              }
              .tome-border::after {
                bottom: -0.75rem;
                right: 1rem;
                transform: rotate(180deg);
              }

              /* Glowing text effect */
              .glow-gold {
                text-shadow:
                  0 0 10px rgba(184, 134, 11, 0.5),
                  0 0 30px rgba(184, 134, 11, 0.3),
                  0 0 60px rgba(184, 134, 11, 0.1);
              }

              .glow-crimson {
                text-shadow:
                  0 0 10px rgba(127, 29, 29, 0.6),
                  0 0 30px rgba(153, 27, 27, 0.4);
              }

              /* Hero gradient */
              .hero-gradient {
                background:
                  radial-gradient(ellipse 80% 50% at 50% 0%, rgba(127, 29, 29, 0.15) 0%, transparent 50%),
                  radial-gradient(ellipse 60% 40% at 20% 80%, rgba(184, 134, 11, 0.08) 0%, transparent 50%),
                  radial-gradient(ellipse 50% 50% at 80% 60%, rgba(76, 29, 149, 0.06) 0%, transparent 50%),
                  linear-gradient(180deg, var(--void) 0%, var(--obsidian) 50%, var(--void) 100%);
              }

              /* Scroll/parchment card */
              .scroll-card {
                background: linear-gradient(135deg, rgba(42, 42, 42, 0.8) 0%, rgba(26, 26, 26, 0.9) 100%);
                border: 1px solid rgba(184, 134, 11, 0.15);
                border-radius: 4px;
                position: relative;
                overflow: hidden;
              }
              .scroll-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: linear-gradient(90deg, transparent, var(--gold), transparent);
                opacity: 0.6;
              }

              /* Mystical divider */
              .divider-rune {
                display: flex;
                align-items: center;
                gap: 1rem;
                color: var(--gold);
                opacity: 0.5;
              }
              .divider-rune::before,
              .divider-rune::after {
                content: '';
                flex: 1;
                height: 1px;
                background: linear-gradient(90deg, transparent, var(--gold), transparent);
              }

              /* FAQ Accordion */
              .faq-item {
                background: rgba(26, 26, 26, 0.6);
                border: 1px solid rgba(184, 134, 11, 0.1);
                border-radius: 4px;
                overflow: hidden;
                transition: border-color 0.3s ease;
              }
              .faq-item:hover {
                border-color: rgba(184, 134, 11, 0.3);
              }
              .faq-item summary {
                cursor: pointer;
                list-style: none;
                padding: 1.25rem 1.5rem;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1rem;
              }
              .faq-item summary::-webkit-details-marker { display: none; }
              .faq-item[open] summary .faq-chevron { transform: rotate(180deg); }
              .faq-chevron {
                transition: transform 0.3s ease;
                color: var(--gold);
              }
              .faq-content {
                padding: 0 1.5rem 1.25rem;
                color: var(--text-secondary);
              }

              /* Answer box for AEO */
              .answer-box {
                background: linear-gradient(135deg, rgba(127, 29, 29, 0.08) 0%, rgba(42, 42, 42, 0.6) 100%);
                border-left: 3px solid var(--blood);
                padding: 1.5rem 2rem;
                border-radius: 0 4px 4px 0;
              }

              /* CTA Buttons */
              .btn-primary {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                padding: 1rem 2.5rem;
                font-family: 'Cormorant Garamond', serif;
                font-size: 1.125rem;
                font-weight: 600;
                letter-spacing: 0.05em;
                text-transform: uppercase;
                color: var(--obsidian);
                background: linear-gradient(135deg, var(--antique-gold) 0%, var(--gold) 50%, #8b6914 100%);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                transition: all 0.3s ease;
                text-decoration: none;
                position: relative;
                overflow: hidden;
              }
              .btn-primary::before {
                content: '';
                position: absolute;
                inset: 0;
                background: linear-gradient(135deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%);
                transform: translateX(-100%);
                transition: transform 0.5s ease;
              }
              .btn-primary:hover {
                transform: translateY(-2px);
                box-shadow:
                  0 10px 40px rgba(184, 134, 11, 0.3),
                  0 0 20px rgba(184, 134, 11, 0.2);
              }
              .btn-primary:hover::before {
                transform: translateX(100%);
              }

              .btn-secondary {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                padding: 0.875rem 2rem;
                font-family: 'Cormorant Garamond', serif;
                font-size: 1rem;
                font-weight: 600;
                letter-spacing: 0.05em;
                color: var(--gold);
                background: transparent;
                border: 1px solid var(--gold);
                border-radius: 2px;
                cursor: pointer;
                transition: all 0.3s ease;
                text-decoration: none;
              }
              .btn-secondary:hover {
                background: rgba(184, 134, 11, 0.1);
                box-shadow: 0 0 20px rgba(184, 134, 11, 0.2);
              }

              /* Form inputs */
              .input-arcane {
                width: 100%;
                padding: 1rem 1.25rem;
                font-family: 'Crimson Pro', serif;
                font-size: 1rem;
                color: var(--text-primary);
                background: rgba(26, 26, 26, 0.8);
                border: 1px solid rgba(184, 134, 11, 0.2);
                border-radius: 2px;
                outline: none;
                transition: all 0.3s ease;
              }
              .input-arcane::placeholder {
                color: var(--text-muted);
                font-style: italic;
              }
              .input-arcane:focus {
                border-color: var(--gold);
                box-shadow: 0 0 20px rgba(184, 134, 11, 0.15);
              }

              /* Feature cards */
              .feature-card {
                background: rgba(26, 26, 26, 0.5);
                border: 1px solid rgba(184, 134, 11, 0.1);
                padding: 2rem;
                position: relative;
                transition: all 0.4s ease;
              }
              .feature-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 2px;
                background: linear-gradient(90deg, transparent, var(--blood), transparent);
                opacity: 0;
                transition: opacity 0.4s ease;
              }
              .feature-card:hover {
                border-color: rgba(127, 29, 29, 0.4);
                transform: translateY(-4px);
              }
              .feature-card:hover::before {
                opacity: 1;
              }

              /* Section spacing */
              .section {
                padding: 6rem 1.5rem;
                position: relative;
              }
              @media (min-width: 768px) {
                .section { padding: 8rem 2rem; }
              }

              /* Container */
              .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 1rem;
              }

              /* Animations */
              @keyframes float {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-10px); }
              }
              @keyframes pulse-glow {
                0%, 100% { opacity: 0.6; }
                50% { opacity: 1; }
              }
              @keyframes flicker {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.8; }
              }

              .animate-float { animation: float 6s ease-in-out infinite; }
              .animate-pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }
              .animate-flicker { animation: flicker 4s ease-in-out infinite; }

              /* Scroll indicator */
              .scroll-indicator {
                position: absolute;
                bottom: 2rem;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.5rem;
                color: var(--text-muted);
                font-size: 0.875rem;
                letter-spacing: 0.1em;
              }
              .scroll-indicator::after {
                content: '';
                width: 1px;
                height: 40px;
                background: linear-gradient(180deg, var(--gold), transparent);
                animation: pulse-glow 2s ease-in-out infinite;
              }
            `,
          }}
        />

        {/* Structured Data */}
        {structuredJson.map((json, index) => (
          <script
            key={`jsonld-${index}`}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: json }}
          />
        ))}
      </head>
      <body className="parchment-noise vignette">
        <div id="landing-root">
          {children}
        </div>
        {serializedState ? (
          <script
            id="__LANDING_DATA__"
            type="application/json"
            dangerouslySetInnerHTML={{ __html: serializedState }}
          />
        ) : null}
        {serializedState ? (
          <script
            id="__LANDING_DATA_BOOTSTRAP__"
            dangerouslySetInnerHTML={{ __html: `window.__LANDING_DATA__=${serializedState};` }}
          />
        ) : null}
        {scripts.map((src) => (
          <script key={src} type="module" src={src} defer crossOrigin="anonymous" />
        ))}
      </body>
    </html>
  );
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
