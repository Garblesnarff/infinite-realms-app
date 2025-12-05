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
    <html lang="en" className="min-h-full bg-slate-950 text-slate-100">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0f172a" />
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

        {/* Favicon & Fonts */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap"
        />

        {/* Critical CSS for Landing Pages */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* Base Styles */
              *, *::before, *::after { box-sizing: border-box; }
              html { scroll-behavior: smooth; }
              body {
                margin: 0;
                font-family: 'Inter', system-ui, sans-serif;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
              }

              /* Typography */
              .font-display { font-family: 'Cinzel', serif; }

              /* Gradient Backgrounds */
              .gradient-hero {
                background: linear-gradient(135deg,
                  rgb(15 23 42) 0%,
                  rgb(30 41 59) 50%,
                  rgb(15 23 42) 100%
                );
              }

              /* FAQ Accordion Styles */
              .faq-item summary {
                cursor: pointer;
                list-style: none;
              }
              .faq-item summary::-webkit-details-marker {
                display: none;
              }
              .faq-item[open] summary .faq-chevron {
                transform: rotate(180deg);
              }

              /* AEO Answer Box */
              .answer-box {
                background: linear-gradient(135deg, rgb(30 41 59 / 0.8), rgb(51 65 85 / 0.5));
                border: 1px solid rgb(71 85 105 / 0.5);
                border-radius: 1rem;
                padding: 1.5rem;
              }
              .answer-box ul {
                margin: 0;
                padding-left: 1.5rem;
              }
              .answer-box li {
                margin-bottom: 0.5rem;
              }

              /* CTA Button */
              .cta-primary {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 1rem 2rem;
                font-weight: 600;
                font-size: 1.125rem;
                color: #0f172a;
                background: linear-gradient(135deg, #fbbf24, #f59e0b);
                border: none;
                border-radius: 0.5rem;
                cursor: pointer;
                transition: all 0.2s ease;
                text-decoration: none;
              }
              .cta-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 25px rgba(251, 191, 36, 0.3);
              }

              /* Feature Cards */
              .feature-card {
                background: linear-gradient(135deg, rgb(30 41 59 / 0.6), rgb(51 65 85 / 0.3));
                border: 1px solid rgb(71 85 105 / 0.3);
                border-radius: 1rem;
                padding: 1.5rem;
                transition: all 0.3s ease;
              }
              .feature-card:hover {
                border-color: rgb(251 191 36 / 0.5);
                transform: translateY(-4px);
              }

              /* Section Spacing */
              .section {
                padding: 5rem 1.5rem;
              }
              @media (min-width: 768px) {
                .section {
                  padding: 6rem 2rem;
                }
              }

              /* Container */
              .container {
                max-width: 1200px;
                margin: 0 auto;
              }

              /* Waitlist Form */
              .waitlist-form {
                display: flex;
                flex-direction: column;
                gap: 1rem;
                max-width: 400px;
              }
              @media (min-width: 640px) {
                .waitlist-form {
                  flex-direction: row;
                }
              }
              .waitlist-input {
                flex: 1;
                padding: 1rem;
                font-size: 1rem;
                background: rgb(30 41 59);
                border: 1px solid rgb(71 85 105);
                border-radius: 0.5rem;
                color: #f1f5f9;
              }
              .waitlist-input:focus {
                outline: none;
                border-color: #fbbf24;
              }
              .waitlist-input::placeholder {
                color: rgb(148 163 184);
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
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <div id="landing-root" className="min-h-screen">
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
