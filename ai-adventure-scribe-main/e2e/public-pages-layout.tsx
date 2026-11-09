import React from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider } from '../src/contexts/AuthContext';
import { supabase } from '../src/integrations/supabase/client';
import CampaignDetailPage from '../src/pages/CampaignDetailPage';
import ExploreGalleryPage from '../src/pages/ExploreGalleryPage';
import LaunchPage from '../src/pages/LaunchPage';
import PricingPage from '../src/pages/PricingPage';
import { userDataApi } from '../src/services/user-data-api';
import '../src/index.css';

/**
 * Public pages layout harness (measurements only, no live data).
 *
 * Mounts the real route components (LaunchPage, ExploreGalleryPage,
 * CampaignDetailPage, PricingPage) inside the real AuthProvider, with safe
 * fixture rows served by stubbing the two data sources the pages read:
 * `supabase.from('starter_campaigns')` (campaigns) and
 * `userDataApi.listStarterCharacterTemplates` (hero templates). No DM,
 * provider, prod or DB access: the Supabase URL is empty in this harness and
 * `from` is replaced before render, so no network request is ever made for
 * fixture data.
 */

const CAMPAIGN_ROWS = [
  {
    id: 'c-abyssal',
    slug: 'abyssal-descent',
    title: 'Abyssal Descent',
    tagline: 'A descent into the Infinite Chasm.',
    genre: ['Horror', 'Survival'],
    tone: ['Terrifying', 'Claustrophobic'],
    difficulty: 'hard',
    level_range: '7-11',
    estimated_sessions: '10-15',
    premise: 'The party joins an expedition to descend the Infinite Chasm.',
    creative_brief: null,
    overview:
      '# Abyssal Descent\n\n## Campaign Overview\n\nWhat begins as scientific exploration becomes a nightmare as the depths reveal horrors that shatter sanity.',
    is_complete: true,
    is_published: true,
    is_featured: true,
    cover_image_url: null,
    banner_image_url: null,
  },
  {
    id: 'c-feast',
    slug: 'the-eternal-feast',
    title: 'The Eternal Feast',
    tagline: 'A banquet that never ends.',
    genre: ['Fantasy'],
    tone: ['Mysterious'],
    difficulty: 'medium',
    level_range: '1-5',
    estimated_sessions: '8-12',
    premise: 'The guests have been eating for a century.',
    creative_brief: null,
    overview:
      '# The Eternal Feast\n\n## Campaign Overview\n\nThe guests have been eating for a century.',
    is_complete: true,
    is_published: true,
    is_featured: true,
    cover_image_url: null,
    banner_image_url: null,
  },
];

const TEMPLATE_ROWS = [
  {
    id: 't-bram',
    starter_campaign_id: 'c-abyssal',
    template_key: 'bram',
    name: 'Bram',
    tagline: 'A brave soul.',
    race: 'Human',
    subrace: null,
    class: 'Fighter',
    subclass: null,
    background: null,
    level: 1,
    ability_scores: {
      strength: 16,
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
    adapted_backstory: null,
    campaign_hook: null,
    portrait_url: null,
    card_image_url: null,
    portrait_prompt: null,
    display_order: 0,
    spells: null,
  },
];

function createBuilder(): Record<string, unknown> {
  let slugFilter: string | null = null;
  const builder: Record<string, unknown> = {};
  const chain = (): Record<string, unknown> => builder;
  builder.select = chain;
  builder.eq = (column: string, value: unknown): Record<string, unknown> => {
    if (column === 'slug') slugFilter = String(value);
    return builder;
  };
  builder.order = chain;
  builder.single = () => {
    const row = slugFilter
      ? CAMPAIGN_ROWS.find((candidate) => candidate.slug === slugFilter)
      : CAMPAIGN_ROWS[0];
    if (!row)
      return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    return Promise.resolve({ data: row, error: null });
  };
  builder.then = (resolve: (value: unknown) => void): Promise<unknown> => {
    const result = { data: CAMPAIGN_ROWS, error: null };
    Promise.resolve(result).then(resolve);
    return Promise.resolve(result);
  };
  return builder;
}

const supabaseUnknown = supabase as unknown as { from: (table: string) => unknown };
supabaseUnknown.from = (table: string) => {
  if (table === 'starter_campaigns') {
    return createBuilder();
  }
  return createBuilder();
};

const userDataApiUnknown = userDataApi as unknown as {
  listStarterCharacterTemplates: (campaignId: string) => Promise<unknown>;
};
userDataApiUnknown.listStarterCharacterTemplates = async () => TEMPLATE_ROWS;

const params = new URLSearchParams(window.location.search);
const pathname = window.location.pathname;
const routeParam = params.get('route');
const initialRoute =
  routeParam ?? (pathname.startsWith('/e2e/') ? '/' : pathname && pathname !== '' ? pathname : '/');

const root = document.getElementById('root');
if (!root) throw new Error('missing root');

try {
  window.localStorage.clear();
  window.sessionStorage.clear();
} catch {
  // Storage unavailable: the pages still render signed-out.
}

createRoot(root).render(
  <HelmetProvider>
    <AuthProvider>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/" element={<LaunchPage />} />
          <Route path="/explore" element={<ExploreGalleryPage />} />
          <Route path="/explore/:slug" element={<CampaignDetailPage />} />
          <Route path="/pricing" element={<PricingPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  </HelmetProvider>,
);
