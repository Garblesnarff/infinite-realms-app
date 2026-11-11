import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { BoxedCampaign } from '../BoxedCampaign';
import { HeroFan } from '../HeroFan';
import { tableImageUrl } from '../image-url';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

import { mapTemplateRow } from '@/hooks/use-starter-character-templates';

const storageImage = `${window.location.origin}/storage/v1/object/public/campaign-images/cover.png`;
const campaign: StarterCampaign = {
  id: 'campaign',
  slug: 'test',
  title: 'The Chasm',
  tagline: null,
  genre: ['horror'],
  tone: [],
  difficulty: 'Hard',
  levelRange: '1',
  estimatedSessions: null,
  premise: 'A descent.',
  creativeBrief: null,
  overview: null,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: storageImage,
  bannerImageUrl: null,
};
const hero = (id: string, name: string) =>
  mapTemplateRow({
    id,
    starter_campaign_id: campaign.id,
    template_key: id,
    name,
    race: 'Human',
    class: 'Fighter',
    level: 1,
    ability_scores: {
      strength: 15,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    personality: {},
    skills: [],
    languages: [],
    equipment: [],
    card_image_url: storageImage,
  });

describe('Table start screens', () => {
  it('requests bounded public images and rejects unsupported originals', () => {
    expect(tableImageUrl(storageImage, 360, 540)).toContain('/storage/v1/render/image/public/');
    expect(tableImageUrl(storageImage, 360, 540)).toContain('width=360');
    expect(tableImageUrl('/unknown/original.png', 360, 540)).toBeNull();
  });

  it('shows the campaign hook, difficulty default and its existing route', () => {
    render(
      <MemoryRouter>
        <BoxedCampaign campaign={campaign} />
      </MemoryRouter>,
    );
    expect(screen.getByText('A descent.')).toBeInTheDocument();
    fireEvent.error(screen.getByAltText('The Chasm cover art'));
    expect(screen.getByRole('img', { name: 'The Chasm artwork coming soon' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Hard campaign: target numbers (DC and AC) start hidden. You can show them in Settings → Table.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore The Chasm campaign' })).toHaveAttribute(
      'href',
      '/explore/test',
    );
  });

  it.each([
    ['easy', 'Easy', 'shown', 'hide'],
    ['Medium', 'Medium', 'shown', 'hide'],
    ['HARD', 'Hard', 'hidden', 'show'],
    ['deadly', 'Deadly', 'hidden', 'show'],
    ['unknown', 'Medium', 'shown', 'hide'],
  ])('words %s difficulty consistently', (difficulty, label, state, action) => {
    render(
      <MemoryRouter>
        <BoxedCampaign campaign={{ ...campaign, difficulty }} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        `${label} campaign: target numbers (DC and AC) start ${state}. You can ${action} them in Settings → Table.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(label, { exact: true })).toHaveClass('normal-case');
  });

  it('renders the difficulty tag in title case and genres in uppercase', () => {
    render(
      <MemoryRouter>
        <BoxedCampaign campaign={campaign} />
      </MemoryRouter>,
    );
    const word = screen.getByText('Hard', { exact: true });
    expect(word).toHaveClass('normal-case');
    expect(screen.getByText('horror')).toHaveClass('uppercase');
  });

  it('prints the level only when the campaign has one', () => {
    const { unmount } = render(
      <MemoryRouter>
        <BoxedCampaign campaign={campaign} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Level 1 · Ready-made heroes')).toBeInTheDocument();
    unmount();
    render(
      <MemoryRouter>
        <BoxedCampaign campaign={{ ...campaign, levelRange: null }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Ready-made heroes')).toBeInTheDocument();
    expect(screen.queryByText(/Level/)).toBeNull();
  });

  it('moves the hero selection with arrows and starts the selected hero once', () => {
    const onPlay = vi.fn();
    const first = hero('one', 'One');
    const second = hero('two', 'Two');
    render(
      <HeroFan
        vitals={() => ({ hp: 12, ac: 15 })}
        templates={[first, second]}
        disabled={false}
        signedIn
        onPlay={onPlay}
      />,
    );
    const choice = screen.getByRole('button', { name: 'Choose One' });
    expect(choice).toHaveTextContent('HP 12 · AC 15');
    fireEvent.error(choice.querySelector('img')!);
    expect(choice.querySelector('img')).toBeNull();
    expect(choice).toHaveAttribute('aria-pressed', 'true');
    expect(choice).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Choose Two' })).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(choice, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Choose Two' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Choose Two' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Choose Two' })).toHaveFocus();
    expect(choice).toHaveAttribute('tabindex', '-1');
    fireEvent.click(screen.getByRole('button', { name: 'Play as Two' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(second);
  });
  it('states the real hero count under the fan', () => {
    const render1 = render(
      <HeroFan
        vitals={() => ({ hp: 12, ac: 15 })}
        templates={[hero('one', 'One')]}
        disabled={false}
        signedIn
        onPlay={vi.fn()}
      />,
    );
    expect(screen.getByText('One ready-made hero.')).toBeInTheDocument();
    render1.unmount();
    render(
      <HeroFan
        vitals={() => ({ hp: 12, ac: 15 })}
        templates={[hero('one', 'One'), hero('two', 'Two')]}
        disabled={false}
        signedIn
        onPlay={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Two ready-made heroes. Tap a card to look at it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('YOUR HERO')).toBeInTheDocument();
  });

  it('keeps heroes available when a template cannot produce vitals', () => {
    const first = hero('one', 'One');
    const second = hero('two', 'Two');
    render(
      <HeroFan
        templates={[first, second]}
        disabled={false}
        signedIn
        onPlay={vi.fn()}
        vitals={(template) => {
          if (template.id === 'one') throw new Error('invalid class');
          return { hp: 12, ac: 15 };
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Choose One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Two' })).toHaveTextContent('HP 12 · AC 15');
  });
});
