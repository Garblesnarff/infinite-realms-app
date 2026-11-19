import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_EXPLORE_COLOURS,
  PublicExploreCard,
  difficultyLabelFor,
  metaLineFor,
} from '../PublicExploreCard';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

const campaign: StarterCampaign = {
  id: 'abyssal',
  slug: 'abyssal-descent',
  title: 'Abyssal Descent',
  tagline: null,
  genre: ['horror', 'survival'],
  tone: [],
  difficulty: 'Hard',
  levelRange: '1',
  estimatedSessions: '10-15',
  premise: 'The party joins an expedition to descend the Infinite Chasm.',
  creativeBrief: null,
  overview: null,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: null,
  bannerImageUrl: null,
};

const renderCard = (overrides: Partial<StarterCampaign> = {}) =>
  render(
    <MemoryRouter>
      <PublicExploreCard campaign={{ ...campaign, ...overrides }} />
    </MemoryRouter>,
  );

/** WCAG relative luminance and contrast ratio, for the board's colour pairs. */
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('PublicExploreCard (#1610, PublicExplore board)', () => {
  it('links to the campaign page with the board accessible name', () => {
    renderCard();
    const link = screen.getByRole('link', {
      name: 'Abyssal Descent, Hard difficulty. Begin your journey',
    });
    expect(link).toHaveAttribute('href', '/explore/abyssal-descent');
  });

  it('shows the board copy: title, hook, meta line and "Begin your journey"', () => {
    renderCard();
    expect(screen.getByRole('heading', { level: 2, name: 'Abyssal Descent' })).toBeInTheDocument();
    expect(
      screen.getByText('The party joins an expedition to descend the Infinite Chasm.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Level 1 · 10–15 sessions')).toBeInTheDocument();
    expect(screen.getByText('Begin your journey')).toBeInTheDocument();
  });

  it('does not show the boxed card copy ("Open the box", the target-number note)', () => {
    renderCard();
    expect(screen.queryByText('Open the box')).not.toBeInTheDocument();
    expect(screen.queryByText(/target numbers/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Ready-made heroes')).not.toBeInTheDocument();
  });

  it('shows genre tags and the difficulty pill in the board colours', () => {
    renderCard();
    expect(screen.getByText('horror')).toBeInTheDocument();
    expect(screen.getByText('survival')).toBeInTheDocument();
    const pill = screen.getByText('Hard');
    expect(pill).toHaveStyle({ color: PUBLIC_EXPLORE_COLOURS.hard });
  });

  it('leaves out the session count when the campaign has none (no placeholder)', () => {
    renderCard({ estimatedSessions: null });
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.queryByText(/sessions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[sessions\]/)).not.toBeInTheDocument();
  });

  it('keeps the card as one link target of at least 44 px (the card is the target)', () => {
    renderCard();
    // The card uses a fixed 8:9 aspect ratio, and its width is fluid; the 44 px floor is met
    // at 390 px (358 px wide, 402 px tall) and at 1280 px (three columns of about 384 px).
    const link = screen.getByRole('link', {
      name: 'Abyssal Descent, Hard difficulty. Begin your journey',
    });
    expect(link.className).toContain('aspect-[8/9]');
    expect(link.className).toContain('block');
  });

  it('holds the board text and label pairs at WCAG AA (4.5:1) or better on the navy card', () => {
    const navy = PUBLIC_EXPLORE_COLOURS.navy;
    expect(contrast(PUBLIC_EXPLORE_COLOURS.gold, navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PUBLIC_EXPLORE_COLOURS.goldText, navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PUBLIC_EXPLORE_COLOURS.hook, navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PUBLIC_EXPLORE_COLOURS.meta, navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PUBLIC_EXPLORE_COLOURS.tag, navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PUBLIC_EXPLORE_COLOURS.hard, navy)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('PublicExploreCard helpers', () => {
  it('maps difficulty text to the board label, defaulting to Medium', () => {
    expect(difficultyLabelFor('Hard')).toBe('Hard');
    expect(difficultyLabelFor('deadly')).toBe('Deadly');
    expect(difficultyLabelFor('Easy')).toBe('Easy');
    expect(difficultyLabelFor(null)).toBe('Medium');
  });

  it('builds the meta line from the fields the campaign has', () => {
    expect(metaLineFor({ levelRange: '1', estimatedSessions: '8-10' })).toBe(
      'Level 1 · 8–10 sessions',
    );
    expect(metaLineFor({ levelRange: null, estimatedSessions: '5' })).toBe('5 sessions');
    expect(metaLineFor({ levelRange: null, estimatedSessions: null })).toBe('');
  });

  it('says "1 session" for one session and "N sessions" otherwise', () => {
    expect(metaLineFor({ levelRange: '1', estimatedSessions: '1' })).toBe('Level 1 · 1 session');
    expect(metaLineFor({ levelRange: null, estimatedSessions: '1' })).toBe('1 session');
    expect(metaLineFor({ levelRange: null, estimatedSessions: '2' })).toBe('2 sessions');
  });

  it('shows the played level for the glued Abyssal Descent span (7-10-11 is 7-11)', () => {
    expect(metaLineFor({ levelRange: '7-10-11', estimatedSessions: '10-15' })).toBe(
      'Level 7-11 · 10–15 sessions',
    );
  });
});

describe('PublicExploreCard board copy', () => {
  it('renders the played level and "1 session" on the card', () => {
    renderCard({ levelRange: '7-10-11', estimatedSessions: '1' });
    expect(screen.getByText('Level 7-11 · 1 session')).toBeInTheDocument();
    expect(screen.queryByText(/7-10-11/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 sessions/)).not.toBeInTheDocument();
  });
});
