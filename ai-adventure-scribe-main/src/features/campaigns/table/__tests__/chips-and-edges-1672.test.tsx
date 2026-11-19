import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BoxedCampaign } from '../BoxedCampaign';
import { genreChipCountFor, GenreChips, MAX_GENRE_CHIPS } from '../GenreChips';
import { HeroFan } from '../HeroFan';
import { scrollEdgesFor } from '../useScrollEdges';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

import { mapTemplateRow } from '@/hooks/use-starter-character-templates';

/** #1672: the signed-in card's genre chips, the level print, and the hero row's scroll cue. */
const campaign: StarterCampaign = {
  id: 'c1',
  slug: 'abyssal-descent',
  title: 'Abyssal Descent',
  tagline: null,
  genre: ['Psychological Terror', 'Conspiracy', 'Horror'],
  tone: [],
  difficulty: 'hard',
  levelRange: '7-10-11',
  estimatedSessions: null,
  premise: 'A descent.',
  creativeBrief: null,
  overview: null,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: null,
  bannerImageUrl: null,
};

describe('genre chip rule (#1672)', () => {
  it('shows at most two chips', () => {
    expect(MAX_GENRE_CHIPS).toBe(2);
    expect(genreChipCountFor(3)).toBe(2);
    expect(genreChipCountFor(1)).toBe(1);
    expect(genreChipCountFor(0)).toBe(0);
  });

  it('renders two whole words and counts the rest', () => {
    render(<GenreChips genres={['Psychological Terror', 'Conspiracy', 'Horror']} />);
    expect(screen.getByText('Psychological Terror')).toBeInTheDocument();
    expect(screen.getByText('Conspiracy')).toBeInTheDocument();
    expect(screen.queryByText('Horror')).not.toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('shows no count when every genre fits the rule', () => {
    render(<GenreChips genres={['Fantasy']} />);
    expect(screen.getByText('Fantasy')).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it('renders nothing for a campaign with no genres', () => {
    const { container } = render(<GenreChips genres={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('genre chips drop to fit the measured row (#1672)', () => {
  let original: PropertyDescriptor | undefined;
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    // Each chip is 100 px wide and the row is 150 px: two chips overflow, one fits.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.children.length * 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 150;
      },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  it('drops chips until the row fits and counts the rest', () => {
    render(<GenreChips genres={['Psychological Terror', 'Conspiracy', 'Horror']} />);
    expect(screen.getByText('Psychological Terror')).toBeInTheDocument();
    expect(screen.queryByText('Conspiracy')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});

describe('signed-in card level (#1672)', () => {
  it('prints the played range through formatStarterLevelRange', () => {
    render(
      <MemoryRouter>
        <BoxedCampaign campaign={campaign} index={1} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Level 7-11/)).toBeInTheDocument();
    expect(screen.queryByText(/7-10-11/)).not.toBeInTheDocument();
  });
});

describe('scrollEdgesFor (#1672)', () => {
  it('reports the side that has content out of view', () => {
    expect(scrollEdgesFor({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 })).toEqual({
      left: false,
      right: true,
    });
    expect(scrollEdgesFor({ scrollLeft: 500, scrollWidth: 800, clientWidth: 300 })).toEqual({
      left: true,
      right: false,
    });
    expect(scrollEdgesFor({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({
      left: false,
      right: false,
    });
  });
});

describe('hero row edge fade (#1672)', () => {
  const store = new WeakMap<Element, number>();
  let original: { sw?: PropertyDescriptor; cw?: PropertyDescriptor; sl?: PropertyDescriptor };

  beforeEach(() => {
    original = {
      sw: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth'),
      cw: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'),
      sl: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft'),
    };
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(Element.prototype, 'scrollLeft', {
      configurable: true,
      get(this: Element) {
        return store.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        store.set(this, value);
      },
    });
  });
  afterEach(() => {
    for (const [prop, desc] of [
      ['scrollWidth', original.sw],
      ['clientWidth', original.cw],
      ['scrollLeft', original.sl],
    ] as const) {
      if (desc) Object.defineProperty(Element.prototype, prop, desc);
      else delete (Element.prototype as unknown as Record<string, unknown>)[prop];
    }
  });

  const hero = (i: number) =>
    mapTemplateRow({
      id: `t${i}`,
      starter_campaign_id: 'c1',
      template_key: `t${i}`,
      name: `Hero ${i}`,
      race: 'Human',
      subrace: null,
      class: 'Fighter',
      subclass: null,
      background: null,
      level: 7,
      ability_scores: {
        strength: 14,
        dexterity: 12,
        constitution: 15,
        intelligence: 10,
        wisdom: 11,
        charisma: 9,
      },
      personality: {},
      skills: [],
      languages: [],
      equipment: [],
      adapted_backstory: null,
      campaign_hook: null,
      portrait_url: null,
      card_image_url: null,
      portrait_prompt: null,
      display_order: i,
      spells: null,
      tagline: null,
    });

  it('shows the right fade at the start and the left fade after scrolling to the end', () => {
    const { container } = render(
      <HeroFan
        templates={[hero(0), hero(1), hero(2)]}
        vitals={() => ({ hp: 10, ac: 14 })}
        disabled={false}
        signedIn={false}
        onPlay={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="hero-row-fade-right"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="hero-row-fade-left"]')).toBeNull();

    const row = screen.getByRole('group', { name: 'Choose your hero' });
    act(() => {
      store.set(row, 500);
      fireEvent.scroll(row);
    });
    expect(container.querySelector('[data-testid="hero-row-fade-left"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="hero-row-fade-right"]')).toBeNull();
  });
});
