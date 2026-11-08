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
      <div className="ir-chronicle-page flex min-h-screen w-full max-w-full flex-col overflow-x-hidden break-words bg-[#070b14] text-[#eaeefa]">
        <header className="ir-chronicle-header flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-4 md:px-20">
          <Link
            to="/"
            aria-label="Infinite Realms, home"
            className="ir-chronicle-home inline-flex min-h-11 items-center gap-3 text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
          >
            <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16.5" fill="#0c1220" stroke="#4fb6c4" strokeWidth="1.5" />
              <path
                d="M18 8 L20.2 15.8 L28 18 L20.2 20.2 L18 28 L15.8 20.2 L8 18 L15.8 15.8 Z"
                fill="#4fb6c4"
              />
            </svg>
            <span className="ir-chronicle-logo font-serif text-lg tracking-[0.2em] md:text-xl">
              INFINITE <span className="ir-chronicle-logo-accent">REALMS</span>
            </span>
          </Link>
          <Link
            to="/explore"
            className="ir-chronicle-nav-link inline-flex min-h-11 items-center text-base font-bold text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
          >
            Explore adventures
          </Link>
        </header>
        <main className="ir-chronicle-message flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-5 py-16 text-center">
          <p>Loading chronicle…</p>
        </main>
        <footer className="ir-chronicle-footer flex min-h-16 items-center justify-center px-5 py-4 text-center text-sm break-words">
          © 2026 InfiniteRealms. All rights reserved.
        </footer>
      </div>
    );
  }

  const chronicle = query.data ?? null;
  if (query.isError || !chronicle) {
    return (
      <div className="ir-chronicle-page flex min-h-screen w-full max-w-full flex-col overflow-x-hidden break-words bg-[#070b14] text-[#eaeefa]">
        <header className="ir-chronicle-header flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-4 md:px-20">
          <Link
            to="/"
            aria-label="Infinite Realms, home"
            className="ir-chronicle-home inline-flex min-h-11 items-center gap-3 text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
          >
            <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16.5" fill="#0c1220" stroke="#4fb6c4" strokeWidth="1.5" />
              <path
                d="M18 8 L20.2 15.8 L28 18 L20.2 20.2 L18 28 L15.8 20.2 L8 18 L15.8 15.8 Z"
                fill="#4fb6c4"
              />
            </svg>
            <span className="ir-chronicle-logo font-serif text-lg tracking-[0.2em] md:text-xl">
              INFINITE <span className="ir-chronicle-logo-accent">REALMS</span>
            </span>
          </Link>
          <Link
            to="/explore"
            className="ir-chronicle-nav-link inline-flex min-h-11 items-center text-base font-bold text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
          >
            Explore adventures
          </Link>
        </header>
        <main className="ir-chronicle-message flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-5 py-16 text-center">
          <p>This chronicle is not available. The link may have been turned off.</p>
          <Link
            to="/explore"
            className="ir-chronicle-nav-link inline-flex min-h-11 items-center text-base font-bold text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
          >
            Explore adventures
          </Link>
        </main>
        <footer className="ir-chronicle-footer flex min-h-16 items-center justify-center px-5 py-4 text-center text-sm break-words">
          © 2026 InfiniteRealms. All rights reserved.
        </footer>
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
  const publicCampaign = chronicle.publicCampaign ?? null;
  const asideImage = publicCampaign
    ? (publicCampaign.coverImageUrl ?? chronicle.illustrationUrl ?? null)
    : (chronicle.illustrationUrl ?? null);
  const asideTitle = publicCampaign
    ? (publicCampaign.title ?? chronicle.campaignName)
    : chronicle.campaignName;
  const asideCopy = publicCampaign?.tagline
    ? publicCampaign.tagline
    : 'You play the hero. An AI Dungeon Master tells the story.';
  const playHref = publicCampaign?.slug ? `/explore/${publicCampaign.slug}` : '/explore';
  const playLabel = publicCampaign ? 'Play this campaign' : 'Find a campaign to play';

  return (
    <div className="ir-chronicle-page flex min-h-screen w-full max-w-full flex-col overflow-x-hidden break-words bg-[#070b14] text-[#eaeefa]">
      <header className="ir-chronicle-header flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-4 md:px-20">
        <Link
          to="/"
          aria-label="Infinite Realms, home"
          className="ir-chronicle-home inline-flex min-h-11 items-center gap-3 text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
        >
          <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="16.5" fill="#0c1220" stroke="#4fb6c4" strokeWidth="1.5" />
            <path
              d="M18 8 L20.2 15.8 L28 18 L20.2 20.2 L18 28 L15.8 20.2 L8 18 L15.8 15.8 Z"
              fill="#4fb6c4"
            />
          </svg>
          <span className="ir-chronicle-logo font-serif text-lg tracking-[0.2em] md:text-xl">
            INFINITE <span className="ir-chronicle-logo-accent">REALMS</span>
          </span>
        </Link>
        <Link
          to="/explore"
          className="ir-chronicle-nav-link inline-flex min-h-11 items-center text-base font-bold text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
        >
          Explore adventures
        </Link>
      </header>
      <main className="ir-chronicle-main flex w-full max-w-6xl flex-1 flex-col gap-8 self-center px-4 py-6 md:flex-row md:gap-[100px] md:px-20 md:py-10">
        <article className="ir-chronicle-article w-full min-w-0 max-w-[760px]">
          <div className="ir-chronicle-eyebrow break-words text-[13px] font-bold tracking-[0.16em]">
            {eyebrowParts.join(' · ')}
          </div>
          <h1 className="ir-chronicle-article-title m-0 mt-3 break-words font-serif text-3xl leading-tight md:text-[52px] md:leading-[1.08]">
            {chronicle.title}
          </h1>
          {chronicle.illustrationUrl ? (
            <figure className="ir-chronicle-article-figure m-0 mt-6 w-full overflow-hidden rounded-[14px]">
              <img
                src={chronicle.illustrationUrl}
                alt={`Illustration for ${chronicle.title}.`}
                className="block h-auto w-full max-h-[230px] object-cover"
              />
            </figure>
          ) : null}
          {paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className="ir-chronicle-article-story mt-6 break-words font-serif text-lg leading-relaxed md:text-[22px] md:leading-[1.65]"
            >
              {paragraph}
            </p>
          ))}
        </article>
        <aside
          aria-label="Play this campaign"
          className="ir-chronicle-aside w-full min-w-0 max-w-[420px] overflow-hidden rounded-[18px] md:shrink-0"
        >
          {asideImage ? (
            <div className="ir-chronicle-aside-image relative h-48 overflow-hidden md:h-[200px]">
              <img src={asideImage} alt="" className="block h-full w-full object-cover" />
            </div>
          ) : null}
          <div className="ir-chronicle-aside-body px-6 pb-6">
            {asideTitle ? (
              <h2 className="ir-chronicle-aside-title m-0 break-words font-serif text-2xl md:text-[28px]">
                {asideTitle}
              </h2>
            ) : null}
            <p className="ir-chronicle-aside-copy mt-2 break-words text-base leading-relaxed md:text-[17px]">
              {asideCopy}
            </p>
            <Link
              to={playHref}
              className="ir-chronicle-aside-play mt-5 flex min-h-11 items-center justify-center rounded-xl px-6 py-3 text-center font-serif text-base font-bold md:min-h-[56px] md:text-lg inline-flex min-h-11 items-center justify-center rounded-md bg-amber-200 px-5 font-semibold text-slate-950"
            >
              {playLabel}
            </Link>
            <div className="ir-chronicle-aside-others mt-2 text-center">
              <Link
                to="/explore"
                className="ir-chronicle-aside-others-link inline-flex min-h-11 items-center justify-center px-4 py-2 text-base font-bold text-amber-200 hover:text-amber-100 underline-offset-4 hover:underline"
              >
                See other adventures
              </Link>
            </div>
          </div>
        </aside>
      </main>
      <footer className="ir-chronicle-footer flex min-h-16 items-center justify-center px-5 py-4 text-center text-sm break-words">
        © 2026 InfiniteRealms. All rights reserved.
      </footer>
    </div>
  );
};

export default PublicChroniclePage;
