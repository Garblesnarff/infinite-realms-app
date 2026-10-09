/**
 * #2701: the sheet's save path through the real network stack.
 *
 * Unlike character-sheet-notes-tab.test.tsx (which mocks userDataApi), this
 * test mocks only `fetch` — the real userDataApi, prepareCharacterPayload,
 * normalizeCharacter, useCharacterData and persistCharacterUpdate all run, so
 * the asserted PUT body is the exact wire body the client sends.
 *
 * The notes test FAILS on main: there onUpdate was wired straight to refetch,
 * so editing notes and blurring sent no PUT at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import CharacterSheet from '../character-sheet';

import { TooltipProvider } from '@/components/ui/tooltip';
import { markAuthReady } from '@/lib/auth-gate';

const { mockToast, authState } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  // Stable identity: a fresh user object per render re-runs fetchCharacter (#2149).
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

// Server shape (mapCharacterToApi after normalizeCharacter), as the real route
// returns it. Mutable so the silent post-save refresh reads back what the PUT
// wrote, like the real route does.
const serverRow: Record<string, unknown> = {
  id: CID,
  user_id: 'user-1',
  name: 'Test Hero',
  description: null,
  race: 'Human',
  subrace: null,
  class: 'Fighter',
  level: 1,
  background: null,
  alignment: '',
  experience_points: 0,
  appearance: null,
  personality_traits: null,
  personality_notes: null,
  backstory_elements: null,
  session_notes: null,
  character_stats: null,
};

const putBodies: Array<Record<string, unknown>> = [];
let getCount = 0;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

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

const resetServerRow = (overrides: Record<string, unknown> = {}): void => {
  for (const key of Object.keys(serverRow)) delete serverRow[key];
  Object.assign(serverRow, {
    id: CID,
    user_id: 'user-1',
    name: 'Test Hero',
    description: null,
    race: 'Human',
    subrace: null,
    class: 'Fighter',
    level: 1,
    background: null,
    alignment: '',
    experience_points: 0,
    appearance: null,
    personality_traits: null,
    personality_notes: null,
    backstory_elements: null,
    session_notes: null,
    character_stats: null,
    ...overrides,
  });
};

describe('CharacterSheet network save (#2701)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putBodies.length = 0;
    getCount = 0;
    resetServerRow();
    // The real AuthContext isn't running (mocked), so open the auth gate the
    // real userDataApi waits on.
    markAuthReady();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url === `${API}/v1/characters/${CID}` && method === 'GET') {
          getCount += 1;
          return json({ ...serverRow });
        }
        if (url === `${API}/v1/characters/${CID}/equipment`) {
          return json([]);
        }
        if (url === `${API}/v1/characters/${CID}` && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          putBodies.push(body);
          Object.assign(serverRow, body);
          return json({ ...serverRow });
        }
        return json({ error: 'not found' }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blur-saving notes PUTs the changed field through the real stack', async () => {
    renderSheet();
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: /main/i }, { timeout: 10000 });
    await user.click(screen.getByRole('tab', { name: /notes & backstory/i }));
    await user.click(screen.getByRole('tab', { name: /^notes$/i }));

    const textarea = screen.getByPlaceholderText(/keep track of important events/i);
    fireEvent.change(textarea, { target: { value: 'Met the innkeeper.' } });
    fireEvent.blur(textarea);

    // The real persistCharacterUpdate diffed, PUT through the real
    // userDataApi.updateCharacter (prepareCharacterPayload), and only then the
    // sheet refreshed. On main this PUT never happened.
    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    expect(putBodies[0]).toEqual({ session_notes: 'Met the innkeeper.' });

    // Wait for the silent post-save refresh to land before asserting the tab
    // stayed put — the refresh must not unmount the tabs.
    await waitFor(() => {
      expect(getCount).toBeGreaterThan(1);
    });
    expect(
      screen.getByRole('tab', { name: /notes & backstory/i }).getAttribute('data-state'),
    ).toBe('active');
  });

  it('a legacy plain-text personality value survives a trait edit', async () => {
    resetServerRow({ personality_notes: 'Brave and bold.' });
    renderSheet();
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: /main/i }, { timeout: 10000 });
    await user.click(screen.getByRole('tab', { name: /notes & backstory/i }));
    await user.click(screen.getByRole('tab', { name: /^personality$/i }));

    const input = screen.getByLabelText(/add new trait/i);
    await user.type(input, 'Never backs down');
    await user.click(screen.getByRole('button', { name: /^add trait$/i }));

    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    const envelope = JSON.parse(String(putBodies[0].personality_notes));
    expect(envelope.traits).toEqual(['Never backs down']);
    // The legacy text is kept inside the envelope, not erased.
    expect(envelope.legacyNotes).toBe('Brave and bold.');

    // After the refresh, the old text still loads (Personality Notes card).
    await waitFor(() => {
      expect(getCount).toBeGreaterThan(1);
    });
    await user.click(screen.getByRole('tab', { name: /^overview$/i }));
    expect(screen.getByText('Brave and bold.')).toBeInTheDocument();
  });

  it('awarding XP across a threshold persists the new level', async () => {
    renderSheet();
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: /main/i }, { timeout: 10000 });
    await user.click(screen.getByRole('tab', { name: /advancement/i }));

    await user.type(screen.getByPlaceholderText(/enter xp amount/i), '300');
    await user.type(screen.getByPlaceholderText(/defeated dragon/i), 'Goblin patrol');
    await user.click(screen.getByRole('button', { name: /award xp/i }));

    // 300 XP is level 2; the PUT must carry both, or the toast's "level up"
    // never reaches the DB.
    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    expect(putBodies[0]).toEqual({ experience_points: 300, level: 2 });
  });

  it('an award never drops a level stored above the XP-derived level', async () => {
    // Level 5 with 0 XP (manual set): 50 XP derives level 1, but the award
    // must not demote. The PUT carries only the XP change; level stays 5
    // because the diff omits unchanged fields.
    resetServerRow({ level: 5, experience_points: 0 });
    renderSheet();
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: /main/i }, { timeout: 10000 });
    await user.click(screen.getByRole('tab', { name: /advancement/i }));

    await user.type(screen.getByPlaceholderText(/enter xp amount/i), '50');
    await user.type(screen.getByPlaceholderText(/defeated dragon/i), 'Rats');
    await user.click(screen.getByRole('button', { name: /award xp/i }));

    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    expect(putBodies[0]).toEqual({ experience_points: 50 });
    expect(putBodies[0]).not.toHaveProperty('level');
  });
});
