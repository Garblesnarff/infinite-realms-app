import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { BoxedCampaign } from '../src/features/campaigns/table/BoxedCampaign';
import { HeroFan } from '../src/features/campaigns/table/HeroFan';
import '../src/index.css';
import { mapTemplateRow } from '../src/hooks/use-starter-character-templates';

import type { StarterCampaign } from '../src/hooks/use-starter-campaigns';

// #1672 harness: the signed-in boxed card at phone and desktop card widths, and the hero fan.
const base: StarterCampaign = {
  id: 'c',
  slug: 'x',
  title: 'Campaign',
  tagline: null,
  genre: [],
  tone: [],
  difficulty: 'medium',
  levelRange: null,
  estimatedSessions: null,
  premise: 'A descent into the dark.',
  creativeBrief: null,
  overview: null,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: null,
  bannerImageUrl: null,
};

const campaigns: StarterCampaign[] = [
  {
    ...base,
    id: 'a',
    slug: 'quiet-hallway',
    title: 'The Quiet Hallway',
    genre: ['Psychological Terror', 'Conspiracy', 'Horror'],
    difficulty: 'hard',
    levelRange: '7-10-11',
  },
  {
    ...base,
    id: 'b',
    slug: 'abyssal-descent',
    title: 'Abyssal Descent',
    genre: ['Horror', 'Dungeon', 'Mystery'],
    difficulty: 'medium',
    levelRange: '7-10-11',
  },
  {
    ...base,
    id: 'd',
    slug: 'long-genre',
    title: 'Long Genre',
    genre: ['Extraordinarily Long Genre Name Beyond The Row Width'],
    difficulty: 'hard',
    levelRange: '1-3',
  },
  {
    ...base,
    id: 'c',
    slug: 'short-one',
    title: 'Short One',
    genre: ['Fantasy'],
    difficulty: 'easy',
    levelRange: '1-3',
  },
];

const names = ['Bram', 'Lysa Vaughn', 'Odran Pell', 'Mirela Thorn', 'Kestrel Ashe'];
const templates = names.map((name, i) =>
  mapTemplateRow({
    id: `t${i}`,
    starter_campaign_id: 'a',
    template_key: `t${i}`,
    name,
    tagline: 'A survivor of the deep',
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
  }),
);

const vitals = (): { hp: number; ac: number } => ({ hp: 10, ac: 14 });

const App: React.FC = () => (
  <MemoryRouter>
    <div style={{ padding: 16 }}>
      {[342, 384].map((width) => (
        <div key={width}>
          {campaigns.map((campaign) => (
            <div key={campaign.id} data-width={width} style={{ width, marginBottom: 24 }}>
              <BoxedCampaign campaign={campaign} index={1} />
            </div>
          ))}
        </div>
      ))}
      {[342, 848].map((width) => (
        <div key={`fan-${width}`} data-fan={width} style={{ width, marginBottom: 24 }}>
          <HeroFan
            templates={templates}
            vitals={vitals}
            disabled={false}
            signedIn={false}
            onPlay={() => undefined}
          />
        </div>
      ))}
    </div>
  </MemoryRouter>
);

createRoot(document.getElementById('root')!).render(<App />);
