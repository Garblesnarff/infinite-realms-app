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
    expect(screen.getByText(/target numbers \(DC and AC\) start hidden/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore The Chasm campaign' })).toHaveAttribute(
      'href',
      '/explore/test',
    );
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
    fireEvent.keyDown(choice, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Choose Two' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'PLAY AS TWO' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(second);
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
