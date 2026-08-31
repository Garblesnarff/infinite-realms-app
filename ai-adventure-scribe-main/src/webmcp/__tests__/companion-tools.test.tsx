import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getActiveCompanions } from '../companion-api';
import {
  createCompanionTools,
  WebMcpCompanionBridge,
  type WebMcpModelContext,
  type WebMcpTool,
} from '../companion-tools';

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

vi.mock('@/lib/auth-gate', () => ({
  waitForAuth: vi.fn().mockResolvedValue(undefined),
}));

const responseFor = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as Response;

const toolByName = (tools: WebMcpTool[], name: string): WebMcpTool => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool ${name} was not registered`);
  return tool;
};

afterEach(() => {
  delete document.modelContext;
  delete navigator.modelContext;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('WebMcpCompanionBridge', () => {
  it('registers all seven tools and aborts their registrations on unmount', async () => {
    const registered: WebMcpTool[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const modelContext: WebMcpModelContext = {
      registerTool: vi.fn((tool, options) => {
        registered.push(tool);
        signals.push(options?.signal);
      }),
    };
    document.modelContext = modelContext;
    const queryClient = new QueryClient();

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <WebMcpCompanionBridge sessionId="session-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(registered).toHaveLength(7));
    expect(registered.map((tool) => tool.name)).toEqual([
      'join_party',
      'leave',
      'list_my_characters',
      'get_scene',
      'speak_as_companion',
      'roll_for_companion',
      'act_in_combat',
    ]);
    expect(toolByName(registered, 'list_my_characters').annotations).toEqual({
      readOnlyHint: true,
    });
    expect(toolByName(registered, 'get_scene').annotations).toEqual({ readOnlyHint: true });

    unmount();
    expect(signals).toHaveLength(7);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
  });

  it('falls back to navigator.modelContext when document.modelContext is absent', async () => {
    const registerTool = vi.fn();
    navigator.modelContext = { registerTool };
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <WebMcpCompanionBridge sessionId="session-2" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(7));
  });

  it('does not register tools when WebMCP is unavailable', () => {
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    const queryClient = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <WebMcpCompanionBridge sessionId="session-3" />
      </QueryClientProvider>,
    );

    unmount();
    expect(abort).not.toHaveBeenCalled();
  });
});

describe('companion WebMCP route contracts', () => {
  it('identifies companions in the redacted main-then-companion party roster', () => {
    const companion = { name: 'Kira', class: 'Cleric', current_hp: 12, max_hp: 16 };
    expect(
      getActiveCompanions({
        party: [{ name: 'Player' }, companion],
      }),
    ).toEqual([companion]);
  });

  it('uses the companion endpoints and injects the WorkOS bearer token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        responseFor([{ id: 'character-1', name: 'Kira', class: 'Rogue', race: 'Elf', level: 3 }]),
      )
      .mockResolvedValueOnce(responseFor({ id: 'companion-row' }))
      .mockResolvedValueOnce(
        responseFor({
          companions: [{ id: 'companion-row', name: 'Kira', is_companion: true }],
          combat: {
            encounter_id: 'encounter-1',
            your_companion_participant_id: 'participant-companion',
            participants: [{ id: 'enemy-1', name: 'Ogre' }],
          },
        }),
      )
      .mockResolvedValueOnce(responseFor({ message_id: 'message-1' }))
      .mockResolvedValueOnce(responseFor({ total: 14 }))
      .mockResolvedValueOnce(responseFor({ accepted: true }))
      .mockResolvedValueOnce(responseFor({ companion: { id: 'companion-row', status: 'left' } }));

    const lastSceneRef = { current: null };
    const companionIdRef = { current: null };
    const tools = createCompanionTools({
      sessionId: 'session with spaces',
      lastSceneRef,
      companionIdRef,
    });

    await toolByName(tools, 'list_my_characters').execute({});
    await toolByName(tools, 'join_party').execute({ character_id: 'character-1' });
    await toolByName(tools, 'get_scene').execute({});
    await toolByName(tools, 'speak_as_companion').execute({ text: 'I scout ahead.' });
    await toolByName(tools, 'roll_for_companion').execute({
      kind: 'skill',
      name: 'Perception',
      reason: 'Check the ambush route',
    });
    await toolByName(tools, 'act_in_combat').execute({
      action_type: 'attack',
      target_name: 'Ogre',
    });
    await toolByName(tools, 'leave').execute({});

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8888/v1/characters',
      'http://localhost:8888/v1/sessions/session%20with%20spaces/companions',
      'http://localhost:8888/v1/sessions/session%20with%20spaces/scene?companion_id=companion-row',
      'http://localhost:8888/v1/sessions/session%20with%20spaces/companions/companion-row/say',
      'http://localhost:8888/v1/sessions/session%20with%20spaces/companions/companion-row/roll',
      'http://localhost:8888/v1/combat/encounter-1/intent',
      'http://localhost:8888/v1/sessions/session%20with%20spaces/companions/companion-row',
    ]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain('http://localhost:8888/');
      expect(init.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      );
    }
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ character_id: 'character-1' });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ text: 'I scout ahead.' });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({
      kind: 'skill',
      name: 'Perception',
      reason: 'Check the ambush route',
    });
    expect(JSON.parse(fetchMock.mock.calls[5][1].body)).toEqual({
      intent: {
        type: 'attack',
        actorId: 'participant-companion',
        targetId: 'enemy-1',
      },
    });
    expect(fetchMock.mock.calls[6][1].method).toBe('DELETE');
    expect(companionIdRef.current).toBeNull();
  });

  it('returns a rejected route body verbatim as tool text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"error":"not your turn"}',
    });
    vi.stubGlobal('fetch', fetchMock);
    const tools = createCompanionTools({
      sessionId: 'session-1',
      lastSceneRef: {
        current: {
          combat: {
            encounter_id: 'encounter-1',
            your_companion_participant_id: 'participant-1',
          },
        },
      },
    });

    const result = await toolByName(tools, 'act_in_combat').execute({ action_type: 'dodge' });
    expect(result).toEqual({ content: [{ type: 'text', text: '{"error":"not your turn"}' }] });
  });
});
