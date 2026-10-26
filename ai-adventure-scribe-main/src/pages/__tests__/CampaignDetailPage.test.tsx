import { fireEvent, render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CampaignDetailPage from '../CampaignDetailPage';
import StarterCharacterSelectionPage from '../StarterCharacterSelectionPage';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';
import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';
import type * as StarterCharacterSeeding from '@/services/character/starter-character-seeding';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

const state = vi.hoisted(() => ({
  campaign: null as StarterCampaign | null,
  user: null as { id: string } | null,
  templates: [] as StarterCharacterTemplate[],
  templatesLoading: false,
  templatesError: null as Error | null,
  retry: vi.fn(),
  resolveOrCreate: vi.fn(),
  seed: vi.fn(),
}));

vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaign: () => ({ campaign: state.campaign, isLoading: false, error: null }),
}));
vi.mock('@/hooks/use-starter-character-templates', () => ({
  useStarterCharacterTemplates: () => ({
    templates: state.templates,
    isLoading: state.templatesLoading,
    error: state.templatesError,
    retry: state.retry,
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/services/starter-campaign-bootstrap', () => ({
  resolveOrCreateStarterCampaign: state.resolveOrCreate,
}));
vi.mock('@/services/character/starter-character-seeding', async (importOriginal) => {
  const actual = await importOriginal<typeof StarterCharacterSeeding>();
  return { ...actual, seedStarterCharacter: state.seed };
});
vi.mock('@/services/user-data-api', () => ({ userDataApi: {} }));

function campaign(overrides: Partial<StarterCampaign>): StarterCampaign {
  return {
    id: 'c1',
    slug: 'the-eternal-feast',
    title: 'The Eternal Feast',
    tagline: null,
    genre: [],
    tone: [],
    difficulty: 'medium',
    levelRange: null,
    estimatedSessions: null,
    premise: 'A banquet that never ends.',
    creativeBrief: null,
    overview: null,
    isComplete: true,
    isPublished: true,
    isFeatured: false,
    coverImageUrl: null,
    bannerImageUrl: null,
    ...overrides,
  };
}

function template(overrides: Partial<StarterCharacterTemplate> = {}): StarterCharacterTemplate {
  return {
    id: 't1',
    starterCampaignId: 'c1',
    templateKey: 'bram',
    name: 'Bram',
    tagline: 'A brave soul.',
    race: 'Human',
    subrace: null,
    class: 'Fighter',
    subclass: null,
    background: null,
    level: 1,
    abilityScores: {
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
    adaptedBackstory: null,
    campaignHook: null,
    portraitUrl: null,
    cardImageUrl: null,
    portraitPrompt: null,
    displayOrder: 0,
    ...overrides,
  };
}

const navTarget = vi.hoisted(() => ({ pathname: '', search: '', hash: '' }));

function LocationCapture({ label }: { label: string }): ReactElement {
  const location = useLocation();
  navTarget.pathname = location.pathname;
  navTarget.search = location.search;
  navTarget.hash = location.hash;
  return <div>{label}</div>;
}

function renderPage(): RenderResult {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/explore/the-eternal-feast']}>
        <Routes>
          <Route path="/explore/:slug" element={<CampaignDetailPage />} />
          <Route path="/app/game/:campaignId" element={<LocationCapture label="game page" />} />
          <Route path="/auth/callback" element={<div>callback page</div>} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  state.campaign = null;
  state.user = null;
  state.templates = [];
  state.templatesLoading = false;
  state.templatesError = null;
  state.retry.mockClear();
  state.resolveOrCreate.mockReset();
  state.seed.mockReset();
  state.resolveOrCreate.mockResolvedValue('camp9');
  state.seed.mockResolvedValue({ id: 'char9' });
  window.sessionStorage.clear();
  navTarget.pathname = '';
  navTarget.search = '';
  navTarget.hash = '';
});

describe('CampaignDetailPage "About this campaign" details (#2281, #89)', () => {
  it('fills the details from the first overview section with prose', () => {
    state.campaign = campaign({
      overview:
        '# The Eternal Feast\n\n---\n\n## Campaign Overview\n\nThe guests have been eating for a century.',
    });
    renderPage();

    const details = screen.getByText('About this campaign').closest('details');
    expect(details).toHaveTextContent('The guests have been eating for a century.');
  });

  it('shows the premise and no overview text when the overview has only a title', () => {
    state.campaign = campaign({ overview: '# The Eternal Feast\n\n## Campaign Overview\n' });
    renderPage();

    const details = screen.getByText('About this campaign').closest('details');
    expect(details).toHaveTextContent('A banquet that never ends.');
    expect(details).not.toHaveTextContent('Campaign Overview');
  });

  it('shows the premise when there is no overview', () => {
    state.campaign = campaign({ overview: null });
    renderPage();

    expect(screen.getByText('About this campaign').closest('details')).toHaveTextContent(
      'A banquet that never ends.',
    );
  });

  it('shows only the overview prose when the premise is empty', () => {
    state.campaign = campaign({ premise: '  ', overview: 'An opening line.' });
    renderPage();

    const details = screen.getByText('About this campaign').closest('details');
    expect(details).toHaveTextContent('An opening line.');
    expect(details).not.toHaveTextContent('A banquet');
  });

  it('hides the details entirely when there is no story at all', () => {
    state.campaign = campaign({ premise: '  ', overview: null });
    renderPage();

    expect(screen.queryByText('About this campaign')).not.toBeInTheDocument();
  });

  it('cuts the overview story at a sentence end, never mid-word', () => {
    state.campaign = campaign({
      premise: '  ',
      overview: `Sentence one. ${'word '.repeat(200)}`,
    });
    renderPage();

    const details = screen.getByText('About this campaign').closest('details');
    expect(details).toHaveTextContent('Sentence one.');
    expect(details).not.toHaveTextContent('word');
  });

  it('keeps an authorial ellipsis tail instead of cutting at it', () => {
    state.campaign = campaign({ premise: '  ', overview: 'He paused... then left.' });
    renderPage();

    const details = screen.getByText('About this campaign').closest('details');
    expect(details).toHaveTextContent('He paused... then left.');
  });
});

describe('CampaignDetailPage level and length labels (#829)', () => {
  // Fixture follows the real producers: parseOverview stores levelRange
  // "3-3" (Start 3 → Finish 3) and, today, estimatedSessions "2-4" — the
  // hours range of the one-shot line — and mapCampaignRow carries the raw
  // overview onto the campaign object.
  it('shows Level 3 and "One-shot (2–4 hours)" for a level-3 one-shot', () => {
    state.campaign = campaign({
      levelRange: '3-3',
      estimatedSessions: '2-4',
      overview: [
        '# Twelve Bells',
        '',
        '**Player Level Range:** Start **3** → Finish **3**',
        '',
        '**Estimated Length:** One-shot — 1 session (2–4 hours)',
        '',
        '## Campaign Overview',
        '',
        'The bell tolls for the village.',
      ].join('\n'),
    });
    renderPage();

    expect(screen.getByText('Level 3')).toBeInTheDocument();
    expect(screen.getByText('One-shot (2–4 hours)')).toBeInTheDocument();
    expect(screen.queryByText('2-4 sessions')).not.toBeInTheDocument();
  });

  it('keeps the level-1 full campaign labels byte-identical', () => {
    state.campaign = campaign({
      levelRange: '1-5',
      estimatedSessions: '8-12',
      overview: [
        '# The Eternal Feast',
        '',
        '**Player Level Range:** Start **1** → Finish **5**',
        '',
        '**Estimated Length:** 8-12 sessions',
        '',
        '## Campaign Overview',
        '',
        'The guests have been eating for a century.',
      ].join('\n'),
    });
    renderPage();

    expect(screen.getByText('Level 1-5')).toBeInTheDocument();
    expect(screen.getByText('8-12 sessions')).toBeInTheDocument();
  });
});

describe('CampaignDetailPage heroes (#89)', () => {
  it('shows the header, step hint, and back link', () => {
    state.campaign = campaign({
      tagline: 'A feast that never ends.',
      tone: ['dark', 'mystery'],
      levelRange: '1-5',
      estimatedSessions: '8-12',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'The Eternal Feast' })).toBeInTheDocument();
    expect(screen.getByText('A feast that never ends.')).toBeInTheDocument();
    expect(screen.getByText('← All campaigns')).toBeInTheDocument();
    expect(screen.getByText('2 Hero')).toBeInTheDocument();
    expect(screen.getByText('Tone: dark, mystery')).toBeInTheDocument();
  });

  it('renders the hero card with server-rule HP/AC for a level-1 fighter', () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    renderPage();

    // Fighter d10 + CON 14 (+2) = 12 HP; no armour + DEX 12 (+1) = 11 AC.
    // These are the shared server-rule values, not hand-written constants
    // in the component: the card calls the same helpers the server does.
    const card = screen.getByText('Play as Bram').closest('article');
    expect(card).toHaveTextContent('Human Fighter · Level 1');
    expect(card).toHaveTextContent('A brave soul.');
    expect(card).toHaveTextContent('HP 12 · AC 11');
  });

  it('starts the game in one click: resolve, seed, navigate', async () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    renderPage();

    fireEvent.click(screen.getByText('Play as Bram'));

    expect(await screen.findByText('game page')).toBeInTheDocument();
    expect(state.resolveOrCreate).toHaveBeenCalledTimes(1);
    expect(state.seed).toHaveBeenCalledTimes(1);
    expect(state.seed.mock.calls[0][0]).toMatchObject({ id: 't1', name: 'Bram' });
    // The navigate target is the retired page's exact target, query included.
    expect(navTarget.pathname).toBe('/app/game/camp9');
    expect(navTarget.search).toContain('character=char9');
    expect(navTarget.search).toContain('starterCampaign=c1');
    expect(navTarget.search).toContain('new=true');
  });

  it('omits the level segment when the campaign declares no range', () => {
    state.campaign = campaign({ levelRange: null, estimatedSessions: '8-12', tone: [] });
    state.templates = [];
    renderPage();

    expect(screen.getByText('8-12 sessions')).toBeInTheDocument();
    expect(screen.queryByText(/Level/)).not.toBeInTheDocument();
  });

  it('renders a card without vitals instead of crashing on an unresolvable class', () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template({ class: 'NotAClass' })];
    renderPage();

    const card = screen.getByText('Play as Bram').closest('article');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('Human NotAClass · Level 1');
    expect(card).not.toHaveTextContent('HP');
  });

  it('double-clicking seeds exactly one character', async () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    renderPage();

    const button = screen.getByText('Play as Bram');
    fireEvent.click(button);
    fireEvent.click(button);

    // The second click returns early on the synchronous in-flight guard;
    // the first click's seed runs after the awaited resolve step.
    expect(await screen.findByText('game page')).toBeInTheDocument();
    expect(state.seed).toHaveBeenCalledTimes(1);
  });

  it('shows the starting overlay and disables the other buttons', async () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template(), template({ id: 't2', name: 'Mira' })];
    let release!: (value: { id: string }) => void;
    state.seed.mockImplementation(() => new Promise((resolve) => void (release = resolve)));
    renderPage();

    fireEvent.click(screen.getByText('Play as Bram'));

    expect(await screen.findByText('Starting your adventure')).toBeInTheDocument();
    expect(screen.getByText('Setting up The Eternal Feast for Bram…')).toBeInTheDocument();
    expect(screen.getByText('Play as Mira')).toBeDisabled();
    release({ id: 'char9' });
    expect(await screen.findByText('game page')).toBeInTheDocument();
  });

  it('reads "Sign in to play as …" and routes to sign-in when signed out', async () => {
    state.campaign = campaign({});
    state.user = null;
    state.templates = [template()];
    renderPage();

    const originalLocation = window.location;
    delete (window as unknown as { location?: Location }).location;
    window.location = { ...originalLocation, href: '' } as Location;

    fireEvent.click(screen.getByText('Sign in to play as Bram'));

    expect(window.location.href).toBe(
      '/v1/auth/login?returnTo=%2Fexplore%2Fthe-eternal-feast%23heroes',
    );
    expect(state.seed).not.toHaveBeenCalled();
    window.location = originalLocation;
  });

  it('auto-starts the pending hero when returning from sign-in', async () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    window.sessionStorage.setItem(
      'ir-pending-starter-hero',
      JSON.stringify({ slug: 'the-eternal-feast', templateId: 't1', at: Date.now() }),
    );
    renderPage();

    expect(await screen.findByText('game page')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ir-pending-starter-hero')).toBeNull();
  });

  it('keeps the pending hero when templates fail, so a retry can resume it', () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templatesError = new Error('boom');
    window.sessionStorage.setItem(
      'ir-pending-starter-hero',
      JSON.stringify({ slug: 'the-eternal-feast', templateId: 't1', at: Date.now() }),
    );
    renderPage();

    expect(screen.getByText('We could not load the heroes.')).toBeInTheDocument();
    expect(state.seed).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('ir-pending-starter-hero')).not.toBeNull();
  });

  it('drops the pending hero when templates load cleanly without it', () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [];
    window.sessionStorage.setItem(
      'ir-pending-starter-hero',
      JSON.stringify({ slug: 'the-eternal-feast', templateId: 't1', at: Date.now() }),
    );
    renderPage();

    expect(screen.getByText('Heroes for this campaign are not ready yet.')).toBeInTheDocument();
    expect(state.seed).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('ir-pending-starter-hero')).toBeNull();
  });

  it('does not start from a stale pending hero, and removes it', () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    window.sessionStorage.setItem(
      'ir-pending-starter-hero',
      JSON.stringify({
        slug: 'the-eternal-feast',
        templateId: 't1',
        at: Date.now() - 11 * 60 * 1000,
      }),
    );
    renderPage();

    expect(screen.getByText('Play as Bram')).toBeInTheDocument();
    expect(state.seed).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('ir-pending-starter-hero')).toBeNull();
  });

  it('treats a pending hero without a timestamp as stale', () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    window.sessionStorage.setItem(
      'ir-pending-starter-hero',
      JSON.stringify({ slug: 'the-eternal-feast', templateId: 't1' }),
    );
    renderPage();

    expect(screen.getByText('Play as Bram')).toBeInTheDocument();
    expect(state.seed).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('ir-pending-starter-hero')).toBeNull();
  });

  it('clears the session-expired banner and refetches when the user signs in', async () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    state.seed.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    const { rerender } = renderPage();

    fireEvent.click(screen.getByText('Play as Bram'));
    expect(await screen.findByText('Your sign-in has expired.')).toBeInTheDocument();

    // Signed out elsewhere, then signed back in: the banner clears and the
    // heroes refetch instead of staring at the expired message. (Storage is
    // cleared here to isolate the banner clearing from the pending-hero
    // auto-start, which is covered by its own tests.)
    window.sessionStorage.clear();
    state.user = null;
    rerender(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/explore/the-eternal-feast']}>
          <Routes>
            <Route path="/explore/:slug" element={<CampaignDetailPage />} />
            <Route path="/app/game/:campaignId" element={<LocationCapture label="game page" />} />
            <Route path="/auth/callback" element={<div>callback page</div>} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    state.user = { id: 'u1' };
    rerender(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/explore/the-eternal-feast']}>
          <Routes>
            <Route path="/explore/:slug" element={<CampaignDetailPage />} />
            <Route path="/app/game/:campaignId" element={<LocationCapture label="game page" />} />
            <Route path="/auth/callback" element={<div>callback page</div>} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(state.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Your sign-in has expired.')).not.toBeInTheDocument();
    expect(screen.getByText('Play as Bram')).toBeInTheDocument();
  });

  it('retires /choose-character to the campaign page heroes section', async () => {
    render(
      <MemoryRouter initialEntries={['/explore/abyssal-descent/choose-character']}>
        <Routes>
          <Route
            path="/explore/:slug/choose-character"
            element={<StarterCharacterSelectionPage />}
          />
          <Route path="/explore/:slug" element={<LocationCapture label="campaign detail page" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('campaign detail page')).toBeInTheDocument();
    expect(navTarget.pathname).toBe('/explore/abyssal-descent');
    expect(navTarget.hash).toBe('#heroes');
  });

  it('shows the heroes-error banner with Try again, never a full-page error', () => {
    state.campaign = campaign({});
    state.templatesError = new Error('boom');
    renderPage();

    expect(screen.getByText('We could not load the heroes.')).toBeInTheDocument();
    expect(
      screen.getByText('Try again. If it keeps failing, pick another campaign.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Something Went Wrong')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Try again'));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });

  it('shows the gold sign-in banner on a 401 from the templates call', () => {
    state.campaign = campaign({});
    state.templatesError = Object.assign(new Error('unauthorized'), { status: 401 });
    renderPage();

    expect(screen.getByText('Your sign-in has expired.')).toBeInTheDocument();
    expect(screen.getByText('Sign in again to pick a hero.')).toBeInTheDocument();
    // The return promise was removed with the banner sentence (see the
    // follow-up linked from #89): it must not reappear.
    expect(screen.queryByText('You come back to this page.')).not.toBeInTheDocument();
    expect(screen.queryByText('Something Went Wrong')).not.toBeInTheDocument();
  });

  it('shows the sign-in banner on a 401 from the start call, not the failed banner', async () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    state.seed.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    renderPage();

    fireEvent.click(screen.getByText('Play as Bram'));

    expect(await screen.findByText('Your sign-in has expired.')).toBeInTheDocument();
    expect(screen.queryByText('We could not start the adventure.')).not.toBeInTheDocument();
  });

  it('shows the start-failed banner with a retry that succeeds', async () => {
    state.campaign = campaign({});
    state.user = { id: 'u1' };
    state.templates = [template()];
    state.seed.mockRejectedValueOnce(new Error('nope'));
    renderPage();

    fireEvent.click(screen.getByText('Play as Bram'));

    expect(await screen.findByText('We could not start the adventure.')).toBeInTheDocument();
    expect(screen.getByText('Nothing was lost. Try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText('game page')).toBeInTheDocument();
  });

  it('shows the no-heroes state with All campaigns', () => {
    state.campaign = campaign({});
    state.templates = [];
    renderPage();

    expect(screen.getByText('Heroes for this campaign are not ready yet.')).toBeInTheDocument();
    expect(screen.getByText('Try one of the other campaigns.')).toBeInTheDocument();
    expect(screen.getByText('All campaigns')).toBeInTheDocument();
  });

  it('shows skeleton cards while heroes load, with the header visible', () => {
    state.campaign = campaign({});
    state.templatesLoading = true;
    renderPage();

    expect(screen.getByRole('heading', { name: 'Choose your hero' })).toBeInTheDocument();
    expect(screen.queryByText(/Play as/)).not.toBeInTheDocument();
  });
});
