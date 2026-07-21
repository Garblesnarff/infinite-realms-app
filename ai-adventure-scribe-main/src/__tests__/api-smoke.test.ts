import { describe, expect, it, vi } from 'vitest';

import { runApiSmoke } from '../../scripts/api-smoke';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const templates = Array.from({ length: 5 }, (_, index) => ({
  id: `template-${index}`,
  backstory: 'A production-sized starter character. '.repeat(40),
}));

function successfulFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    if (url.pathname === '/health') {
      return jsonResponse({
        status: 'healthy',
        modelHealth: {
          openrouter: { unlistedModels: [] },
          gemini: { unlistedModels: [] },
        },
      });
    }
    if (url.pathname === '/v1/starter-character-templates') return jsonResponse(templates);
    if (url.pathname === '/v1/sessions') {
      return jsonResponse([
        {
          id: 'session-1',
          campaign_id: 'campaign-1',
          character_id: 'character-1',
          session_number: 1,
          start_time: '2026-07-20T00:00:00Z',
          end_time: null,
          status: 'active',
          current_scene_description: null,
          summary: null,
          session_notes: null,
          turn_count: 0,
          session_state: {},
          starter_campaign_id: 'the-eternal-feast',
          campaign_version: 1,
          ruleset: {},
          created_at: '2026-07-20T00:00:00Z',
          updated_at: '2026-07-20T00:00:00Z',
          character: { id: 'character-1' },
          session_chronicles: [],
        },
      ]);
    }
    if (url.pathname === '/v1/sessions/session-1/context') {
      return jsonResponse({
        id: 'session-1',
        campaign_id: 'campaign-1',
        character_id: 'character-1',
        session_number: 1,
        start_time: '2026-07-20T00:00:00Z',
        end_time: null,
        status: 'active',
        current_scene_description: null,
        summary: null,
        session_notes: null,
        turn_count: 0,
        starter_campaign_id: 'the-eternal-feast',
        campaign_version: 1,
        ruleset: {},
        created_at: '2026-07-20T00:00:00Z',
        updated_at: '2026-07-20T00:00:00Z',
        campaign: { id: 'campaign-1', name: 'The Eternal Feast', description: 'A feast.' },
        character: {
          id: 'character-1',
          name: 'Avery',
          level: 1,
          race: 'Human',
          class: 'Fighter',
          background: 'Noble',
          character_stats: [],
        },
      });
    }
    if (url.pathname === '/v1/llm/generate') {
      const request = JSON.parse(String(init?.body)) as { prompt?: unknown };
      expect(request.prompt).toContain('dungeon master');
      expect(request.prompt).toContain('what they do');
      return jsonResponse({ text: 'Cold wax scents the air. What do you do?' });
    }
    if (url.pathname.endsWith('/tactical-map')) {
      return jsonResponse({ error: 'Not found' }, 404);
    }
    return jsonResponse({ error: 'unexpected request' }, 500);
  });
}

describe('api smoke journey', () => {
  it('checks the full authenticated real-HTTP contract', async () => {
    const fetchImpl = successfulFetch();
    const lines: string[] = [];

    const results = await runApiSmoke({
      env: { LLM_SMOKE_BEARER_TOKEN: 'smoke-token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: (line) => lines.push(line),
    });

    expect(results).toHaveLength(6);
    expect(results.every((result) => result.status === 'PASS')).toBe(true);
    expect(lines).toHaveLength(6);
    expect(lines.every((line) => line.startsWith('PASS '))).toBe(true);
  });

  it('fails health when a configured model is no longer listed', async () => {
    const fetchImpl = successfulFetch();
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse({
        status: 'degraded',
        modelHealth: {
          openrouter: { unlistedModels: ['provider/delisted-model'] },
          gemini: { unlistedModels: [] },
        },
      }),
    );

    const results = await runApiSmoke({
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });

    expect(results[0]).toMatchObject({ name: 'health', status: 'FAIL' });
    expect(results[0].detail).toContain('provider/delisted-model');
  });

  it('skips authenticated checks locally but fails them when the gate requires auth', async () => {
    const local = await runApiSmoke({
      env: {},
      fetchImpl: successfulFetch() as unknown as typeof fetch,
      log: () => {},
    });
    const gated = await runApiSmoke({
      env: { API_SMOKE_REQUIRE_AUTH: '1' },
      fetchImpl: successfulFetch() as unknown as typeof fetch,
      log: () => {},
    });

    expect(local.slice(2).every((result) => result.status === 'PASS')).toBe(true);
    expect(local[2].detail).toContain('SKIP');
    expect(gated.slice(2).every((result) => result.status === 'FAIL')).toBe(true);
  });

  it('only allows database-backed public skips when explicitly requested locally', async () => {
    const fetchImpl = successfulFetch();
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse({ status: 'healthy', modelHealth: {} }),
    );
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse({ error: 'database unavailable' }, 500),
    );

    const results = await runApiSmoke({
      env: { API_SMOKE_ALLOW_INFRA_SKIPS: '1' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });

    expect(results[1]).toMatchObject({ name: 'starter-character-templates', status: 'PASS' });
    expect(results[1].detail).toContain('SKIP');
  });
});
