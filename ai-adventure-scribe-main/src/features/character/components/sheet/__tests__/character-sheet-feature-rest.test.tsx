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

import { SECOND_WIND_SHEET_BODY } from '../../../../../../shared/test-fixtures/second-wind-sheet';
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
const statsBodies: Array<Record<string, unknown>> = [];
const healBodies: Array<Record<string, unknown>> = [];
const restBodies: Array<{ restType: 'short' | 'long'; body: unknown }> = [];
// #1576: Second Wind is one server call. The stub plays the server: it rolls with `secondWindRoll`,
// spends the use, heals capped at max HP, and records the response the sheet must show.
const secondWindBodies: Array<Record<string, unknown>> = [];
const secondWindResponses: Array<Record<string, number>> = [];
const secondWindRoll = { value: 4 };
// When on, the stub refuses Second Wind with the route's 422 body (a refusal the server explained).
const secondWindRefusal = { on: false };

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
    statsBodies.length = 0;
    healBodies.length = 0;
    restBodies.length = 0;
    secondWindBodies.length = 0;
    secondWindResponses.length = 0;
    secondWindRoll.value = 4;
    secondWindRefusal.on = false;
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
        if (url === `${API}/v1/characters/${CID}/stats` && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          statsBodies.push(body);
          if (typeof body.current_hit_points === 'number') {
            serverRow.stats.current_hit_points = body.current_hit_points;
          }
          return json({ ok: true });
        }
        // #214: Second Wind heals through the server-side delta. The stub
        // mirrors the route: the server adds the amount and clamps to max HP.
        if (url === `${API}/v1/characters/${CID}/heal` && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as { amount: number };
          healBodies.push(body);
          serverRow.stats.current_hit_points = Math.min(
            serverRow.stats.max_hit_points,
            serverRow.stats.current_hit_points + Math.max(0, Math.trunc(body.amount)),
          );
          return json({
            currentHitPoints: serverRow.stats.current_hit_points,
            temporaryHitPoints: 0,
          });
        }
        if (url === `${API}/v1/characters/${CID}` && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          putBodies.push(body);
          if (body.class_features && typeof body.class_features === 'object') {
            serverRow.class_features = body.class_features as ServerRow['class_features'];
          }
          return json({ ...serverRow });
        }
        if (url === `${API}/v1/characters/${CID}/second-wind` && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          secondWindBodies.push(body);
          if (secondWindRefusal.on) {
            return json(
              {
                error: 'Second Wind has no uses remaining — it refreshes on a short rest',
                code: 'BUSINESS_LOGIC_ERROR',
                details: { reason: 'feature_uses_exhausted' },
              },
              422,
            );
          }
          const features = { ...(serverRow.class_features ?? {}) };
          const feature = features.second_wind ?? {
            name: 'second_wind',
            currentUses: 1,
            maxUses: 1,
            usesPerRest: 'short' as const,
          };
          if (feature.currentUses <= 0) {
            return json(
              {
                error: 'Second Wind has no uses remaining',
                code: 'BUSINESS_LOGIC_ERROR',
                details: { reason: 'feature_uses_exhausted' },
              },
              422,
            );
          }
          const before = serverRow.stats.current_hit_points;
          const healed = Math.min(
            secondWindRoll.value + 1,
            serverRow.stats.max_hit_points - before,
          );
          serverRow.stats.current_hit_points = before + healed;
          features.second_wind = { ...feature, currentUses: feature.currentUses - 1 };
          serverRow.class_features = features;
          const result = {
            roll: secondWindRoll.value,
            fighterLevel: 1,
            healed,
            newHp: serverRow.stats.current_hit_points,
            maxHp: serverRow.stats.max_hit_points,
            usesRemaining: features.second_wind.currentUses,
          };
          secondWindResponses.push(result);
          return json(result);
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

    // #1576: one server call with the shared wire body. The sheet no longer saves the use itself:
    // no heal write and no class-features PUT.
    await waitFor(() => {
      expect(secondWindBodies).toHaveLength(1);
    });
    expect(secondWindBodies[0]).toEqual(SECOND_WIND_SHEET_BODY);
    expect(healBodies).toHaveLength(0);
    expect(putBodies.some((body) => body.class_features)).toBe(false);
    expect(secondWindResponses[0].usesRemaining).toBe(0);

    await waitFor(() => {
      expect(screen.getAllByText('0 / 1').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: /use feature/i })).not.toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Feature used',
        description: expect.stringContaining('second wind: 0 / 1'),
      }),
    );
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

  it('Second Wind heals 1d10 + level and never above max HP', async () => {
    // #1576: the server rolls 1d10 + level and caps at max HP. That range and the cap are proven
    // by the real-route suite (fighter-second-wind-route.real-db.test.ts). This case proves the
    // sheet sends the one fixture, makes no heal write, and shows exactly the server's numbers.
    secondWindRoll.value = 1;
    const view = renderSheet();
    const user = userEvent.setup();
    await screen.findByText('5/10');
    await openFeatures();
    await user.click(screen.getByRole('button', { name: /use feature/i }));

    await waitFor(() => {
      expect(screen.getByText('7/10')).toBeInTheDocument();
    });
    expect(secondWindBodies).toEqual([SECOND_WIND_SHEET_BODY]);
    expect(healBodies).toHaveLength(0);
    expect(secondWindResponses[0]).toMatchObject({ healed: 2, newHp: 7, maxHp: 10 });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('Healed 2 HP (now 7 of 10)'),
      }),
    );
    view.unmount();

    // The server caps at max HP: 9 of 10 with a roll of 10 (+ level 1) heals 1, and the sheet
    // shows 10/10 with no overflow.
    secondWindRoll.value = 10;
    resetRow();
    serverRow.stats.current_hit_points = 9;
    secondWindBodies.length = 0;
    secondWindResponses.length = 0;
    healBodies.length = 0;
    renderSheet();
    await screen.findByText('9/10');
    await openFeatures();
    await user.click(screen.getByRole('button', { name: /use feature/i }));
    await waitFor(() => {
      expect(screen.getByText('10/10')).toBeInTheDocument();
    });
    expect(secondWindResponses[0]).toMatchObject({ healed: 1, newHp: 10, maxHp: 10 });
    expect(secondWindBodies).toEqual([SECOND_WIND_SHEET_BODY]);
    expect(healBodies).toHaveLength(0);
    expect(screen.queryByText('20/10')).not.toBeInTheDocument();
  });

  it('a refused Second Wind toasts the server reason, with no HTTP status number', async () => {
    secondWindRefusal.on = true;
    renderSheet();
    const user = userEvent.setup();
    await openFeatures();
    await user.click(screen.getByRole('button', { name: /use feature/i }));

    await waitFor(() => {
      expect(secondWindBodies).toHaveLength(1);
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Second Wind', variant: 'destructive' }),
      );
    });
    const refusal = mockToast.mock.calls.find(
      ([call]) => (call as { variant?: string }).variant === 'destructive',
    )![0] as { description: string };
    expect(refusal.description).toBe(
      'Second Wind has no uses remaining — it refreshes on a short rest',
    );
    expect(refusal.description).not.toContain('422');
    // A refusal spends nothing and heals nothing: the sheet is not reloaded for it.
    expect(healBodies).toHaveLength(0);
  });

  it('#214: the Main tab vitals also offer Short Rest and Long Rest', async () => {
    resetRow();
    renderSheet();
    const user = userEvent.setup();
    // The Main tab is the default; its Combat Vitals card carries the rest buttons.
    await screen.findByText('5/10');
    const mainTab = screen.getByRole('tab', { name: /main/i });
    expect(mainTab.getAttribute('data-state')).toBe('active');

    await user.click(screen.getByRole('button', { name: /^short rest$/i }));
    await waitFor(() => {
      expect(restBodies.map((call) => call.restType)).toContain('short');
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Short rest complete' }),
    );
    expect(mainTab.getAttribute('data-state')).toBe('active');

    // #214: the Main tab vitals also offer Long Rest, and it restores HP.
    await user.click(screen.getByRole('button', { name: /^long rest$/i }));
    await waitFor(() => {
      expect(restBodies.map((call) => call.restType)).toContain('long');
    });
    expect(restBodies.find((call) => call.restType === 'long')!.body).toEqual({});
    await waitFor(() => {
      expect(screen.getByText('10/10')).toBeInTheDocument();
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Long rest complete' }),
    );
    expect(mainTab.getAttribute('data-state')).toBe('active');
  });
});
