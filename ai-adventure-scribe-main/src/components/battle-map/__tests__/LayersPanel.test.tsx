import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayersPanel } from '../LayersPanel';

import { TRPCProvider } from '@/infrastructure/api';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: null }),
}));

const SCENE = '11111111-1111-4111-8111-111111111111';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function sceneIdSent(input: RequestInfo | URL): string | undefined {
  const raw = new URL(requestUrl(input), 'http://localhost').searchParams.get('input');
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as { 0?: { sceneId?: string } };
  return parsed[0]?.sceneId;
}

describe('LayersPanel scenes router', () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('scenes.getById')) {
          return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        const body = [
          {
            result: {
              data: {
                id: SCENE,
                layers: [{ id: 'layer-tokens', layerType: 'tokens' }],
              },
            },
          },
        ];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  });

  it('renders the layer list from scenes.getById', async () => {
    render(
      <TRPCProvider>
        <LayersPanel sceneId={SCENE} open />
      </TRPCProvider>,
    );

    expect(await screen.findByRole('button', { name: /hide tokens layer/i })).toBeInTheDocument();
    expect(screen.getAllByText('(Not initialized)').length).toBeGreaterThan(0);
    const sceneCalls = vi
      .mocked(fetch)
      .mock.calls.filter((call) => requestUrl(call[0]).includes('scenes.getById'));
    expect(sceneCalls.length).toBeGreaterThan(0);
    expect(sceneCalls.map((call) => sceneIdSent(call[0]))).toContain(SCENE);
  });
});
