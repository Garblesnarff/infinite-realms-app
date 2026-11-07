import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchPublicChronicle } from '@/features/game-session/components/game/chronicle/chronicleShareApi';

import '@/features/game-session/components/game/chronicle/chronicle.css';

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const PublicChroniclePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const query = useQuery({
    queryKey: ['public-chronicle', token],
    queryFn: () => fetchPublicChronicle(token ?? ''),
    enabled: !!token,
  });

  if (query.isLoading) {
    return (
      <div className="ir-chronicle-page">
        <header className="ir-chronicle-header">
          <Link to="/" aria-label="Infinite Realms, home" className="ir-chronicle-home">
            <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16.5" fill="#0c1220" stroke="#4fb6c4" strokeWidth="1.5" />
              <path
                d="M18 8 L20.2 15.8 L28 18 L20.2 20.2 L18 28 L15.8 20.2 L8 18 L15.8 15.8 Z"
                fill="#4fb6c4"
              />
            </svg>
            <span className="ir-chronicle-logo">
              INFINITE <span className="ir-chronicle-logo-accent">REALMS</span>
            </span>
          </Link>
          <Link to="/explore" className="ir-chronicle-nav-link">
            Explore adventures
          </Link>
        </header>
        <main className="ir-chronicle-message">
          <p>Loading chronicle…</p>
        </main>
        <footer className="ir-chronicle-footer">© 2026 InfiniteRealms. All rights reserved.</footer>
      </div>
    );
  }

  const chronicle = query.data ?? null;
  if (query.isError || !chronicle) {
    return (
      <div className="ir-chronicle-page">
        <header className="ir-chronicle-header">
          <Link to="/" aria-label="Infinite Realms, home" className="ir-chronicle-home">
            <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16.5" fill="#0c1220" stroke="#4fb6c4" strokeWidth="1.5" />
              <path
                d="M18 8 L20.2 15.8 L28 18 L20.2 20.2 L18 28 L15.8 20.2 L8 18 L15.8 15.8 Z"
                fill="#4fb6c4"
              />
            </svg>
            <span className="ir-chronicle-logo">
              INFINITE <span className="ir-chronicle-logo-accent">REALMS</span>
            </span>
          </Link>
          <Link to="/explore" className="ir-chronicle-nav-link">
            Explore adventures
          </Link>
        </header>
        <main className="ir-chronicle-message">
          <p>This chronicle is not available. The link may have been turned off.</p>
          <Link to="/explore" className="ir-chronicle-nav-link">
            Explore adventures
          </Link>
        </main>
        <footer className="ir-chronicle-footer">© 2026 InfiniteRealms. All rights reserved.</footer>
      </div>
    );
  }

  const eyebrowParts = ['CHRONICLE'];
  if (chronicle.campaignName) {
    eyebrowParts.push(chronicle.campaignName.toUpperCase());
  }
  if (chronicle.sessionNumber != null) {
    eyebrowParts.push(`SESSION ${chronicle.sessionNumber}`);
  }
  const paragraphs = splitParagraphs(chronicle.story);

  return (
    <div className="ir-chronicle-page">
      <header className="ir-chronicle-header">
        <Link to="/" aria-label="Infinite Realms, home" className="ir-chronicle-home">
          <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="16.5" fill="#0c1220" stroke="#4fb6c4" strokeWidth="1.5" />
            <path
              d="M18 8 L20.2 15.8 L28 18 L20.2 20.2 L18 28 L15.8 20.2 L8 18 L15.8 15.8 Z"
              fill="#4fb6c4"
            />
          </svg>
          <span className="ir-chronicle-logo">
            INFINITE <span className="ir-chronicle-logo-accent">REALMS</span>
          </span>
        </Link>
        <Link to="/explore" className="ir-chronicle-nav-link">
          Explore adventures
        </Link>
      </header>
      <main className="ir-chronicle-main">
        <article className="ir-chronicle-article">
          <div className="ir-chronicle-eyebrow">{eyebrowParts.join(' · ')}</div>
          <h1 className="ir-chronicle-article-title">{chronicle.title}</h1>
          {chronicle.illustrationUrl ? (
            <figure className="ir-chronicle-article-figure">
              <img src={chronicle.illustrationUrl} alt={`Illustration for ${chronicle.title}.`} />
            </figure>
          ) : null}
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="ir-chronicle-article-story">
              {paragraph}
            </p>
          ))}
        </article>
        <aside aria-label="Play this campaign" className="ir-chronicle-aside">
          {chronicle.illustrationUrl ? (
            <div className="ir-chronicle-aside-image">
              <img src={chronicle.illustrationUrl} alt="" />
            </div>
          ) : null}
          <div className="ir-chronicle-aside-body">
            {chronicle.campaignName ? (
              <h2 className="ir-chronicle-aside-title">{chronicle.campaignName}</h2>
            ) : null}
            <p className="ir-chronicle-aside-copy">
              You play the hero. An AI Dungeon Master tells the story.
            </p>
            <Link to="/explore" className="ir-chronicle-aside-play">
              Play this campaign
            </Link>
            <div className="ir-chronicle-aside-others">
              <Link to="/explore" className="ir-chronicle-aside-others-link">
                See other adventures
              </Link>
            </div>
          </div>
        </aside>
      </main>
      <footer className="ir-chronicle-footer">© 2026 InfiniteRealms. All rights reserved.</footer>
    </div>
  );
};

export default PublicChroniclePage;
