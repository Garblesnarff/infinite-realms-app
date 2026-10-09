/**
 * #224 (QA-055): Use Feature, Short Rest and Long Rest on the real sheet.
 *
 * The real CharacterSheet, useCharacterData and rest/class-feature clients run.
 * Only fetch is stubbed, at the network boundary, the same way #2701 proves a
 * sheet save. The stub keeps the row the routes would keep: a PUT stores
 * class_features, a short rest restores short-rest uses, a long rest fills HP
 * and every stored use.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import CharacterSheet from '../character-sheet';

import { TooltipProvider } from '@/components/ui/tooltip';
import { markAuthReady } from '@/lib/auth-gate';

const { mockToast, authState } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  authState: { user: { id: 'user-1' } },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
  toast: mockToast,
}));

vi.mock('@/services/gallery-service', () => ({
  listEntityImages: vi.fn().mockResolvedValue([]),
}));

const CID = '123e4567-e89b-42d3-a456-426614174000';
const API = 'http://localhost:8888';

const STATS = {
  strength: 16,
  dexterity: 12,
  constitution: 14,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  armor_class: 16,
  max_hit_points: 10,
  current_hit_points: 5,
};

type FeatureUse = {
  name: string;
  currentUses: number;
  maxUses: number;
  usesPerRest: 'short' | 'long';
};

type ServerRow = Record<string, unknown> & {
  stats: typeof STATS & { current_hit_points: number };
  class_features: Record<string, FeatureUse> | null;
};

const serverRow: ServerRow = {
  id: CID,
  user_id: 'user-1',
  name: 'QA Dwarven Fighter Alpha',
  race: 'Dwarf',
  class: 'Fighter',
  level: 1,
  experience_points: 0,
  stats: { ...STATS },
  class_features: null,
};

const putBodies: Array<Record<string, unknown>> = [];
const restBodies: Array<{ restType: 'short' | 'long'; body: unknown }> = [];

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const restoreUses = (restType: 'short' | 'long'): void => {
  const features = serverRow.class_features;
  if (!features) return;
  for (const feature of Object.values(features)) {
    if (
      feature.usesPerRest === restType ||
      (restType === 'long' && (feature.usesPerRest === 'short' || feature.usesPerRest === 'long'))
    ) {
      feature.currentUses = feature.maxUses;
    }
  }
};

const resetRow = (overrides: Partial<ServerRow> = {}): void => {
  serverRow.stats = { ...STATS, current_hit_points: 5 };
  serverRow.class_features = null;
  Object.assign(serverRow, overrides);
};

const renderSheet = (): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[`/app/character/${CID}`]}>
          <Routes>
            <Route path="/app/character/:id" element={<CharacterSheet />} />
            <Route path="/app/characters" element={<div>characters list</div>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

const openFeatures = async (): Promise<void> => {
  const user = userEvent.setup();
  await screen.findByRole('tab', { name: /main/i }, { timeout: 10000 });
  await user.click(screen.getByRole('tab', { name: /features & traits/i }));
};

const featuresTab = (): HTMLElement => screen.getByRole('tab', { name: /features & traits/i });

describe('CharacterSheet feature use and rests (#224)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putBodies.length = 0;
    restBodies.length = 0;
    resetRow();
    markAuthReady();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url === `${API}/v1/characters/${CID}` && method === 'GET') {
          return json({ ...serverRow, stats: { ...serverRow.stats } });
        }
        if (url === `${API}/v1/characters/${CID}/equipment`) {
          return json([]);
        }
        if (url === `${API}/v1/characters/${CID}` && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          putBodies.push(body);
          if (body.class_features && typeof body.class_features === 'object') {
            serverRow.class_features = body.class_features as ServerRow['class_features'];
          }
          return json({ ...serverRow });
        }
        const shortUrl = `${API}/v1/rest/characters/${CID}/short`;
        const longUrl = `${API}/v1/rest/characters/${CID}/long`;
        if ((url === shortUrl || url === longUrl) && method === 'POST') {
          const restType = url === shortUrl ? 'short' : 'long';
          restBodies.push({ restType, body: JSON.parse(String(init?.body ?? '{}')) });
          restoreUses(restType);
          if (restType === 'long')
            serverRow.stats.current_hit_points = serverRow.stats.max_hit_points;
          return json({
            characterId: CID,
            restType,
            hpRestored: restType === 'long' ? 5 : 0,
            hitDiceRemaining: [],
            resourcesRestored: [],
            spellSlots: null,
            pactSlots: null,
            classFeatures: serverRow.class_features,
            restEventId: 'rest-1',
          });
        }
        return json({ error: 'not found' }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Use Feature decrements second_wind, toasts, stays on the tab, and survives reload', async () => {
    const view = renderSheet();
    const user = userEvent.setup();
    await openFeatures();

    expect(screen.getAllByText('1 / 1').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /use feature/i }));

    await waitFor(() => {
      expect(putBodies.some((body) => body.class_features)).toBe(true);
    });
    const saved = putBodies.find((body) => body.class_features)!.class_features as Record<
      string,
      FeatureUse
    >;
    expect(saved.second_wind.currentUses).toBe(0);
    expect(saved.second_wind.maxUses).toBe(1);
    expect(saved.second_wind.usesPerRest).toBe('short');

    await waitFor(() => {
      expect(screen.getAllByText('0 / 1').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: /use feature/i })).not.toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Feature used' }));
    expect(featuresTab().getAttribute('data-state')).toBe('active');

    view.unmount();
    renderSheet();
    await openFeatures();
    expect(screen.getAllByText('0 / 1').length).toBeGreaterThan(0);
    expect(featuresTab().getAttribute('data-state')).toBe('active');
  });

  it('Short Rest restores a spent short-rest feature, toasts, and stays on the tab', async () => {
    resetRow({
      class_features: {
        second_wind: {
          name: 'second_wind',
          currentUses: 0,
          maxUses: 1,
          usesPerRest: 'short',
        },
      },
    });
    renderSheet();
    const user = userEvent.setup();
    await openFeatures();
    expect(screen.getAllByText('0 / 1').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /^short rest$/i }));

    await waitFor(() => {
      expect(restBodies.map((call) => call.restType)).toContain('short');
    });
    expect(restBodies.find((call) => call.restType === 'short')!.body).toEqual({
      hitDiceToSpend: 0,
    });
    await waitFor(() => {
      expect(screen.getAllByText('1 / 1').length).toBeGreaterThan(0);
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Short rest complete' }),
    );
    expect(featuresTab().getAttribute('data-state')).toBe('active');
    expect(screen.queryByText('characters list')).not.toBeInTheDocument();
  });

  it('Long Rest restores HP and every use, toasts, and stays on the tab', async () => {
    resetRow({
      class_features: {
        second_wind: {
          name: 'second_wind',
          currentUses: 0,
          maxUses: 1,
          usesPerRest: 'short',
        },
      },
    });
    renderSheet();
    const user = userEvent.setup();
    await screen.findByText('5/10');
    await openFeatures();

    await user.click(screen.getByRole('button', { name: /^long rest$/i }));

    await waitFor(() => {
      expect(restBodies.map((call) => call.restType)).toContain('long');
    });
    expect(restBodies.find((call) => call.restType === 'long')!.body).toEqual({});
    await waitFor(() => {
      expect(screen.getByText('10/10')).toBeInTheDocument();
    });
    expect(screen.getAllByText('1 / 1').length).toBeGreaterThan(0);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Long rest complete' }),
    );
    expect(featuresTab().getAttribute('data-state')).toBe('active');
    expect(screen.queryByText('characters list')).not.toBeInTheDocument();
  });
});
