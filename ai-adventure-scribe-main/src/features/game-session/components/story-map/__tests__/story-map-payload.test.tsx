/**
 * #1754: the server payload (the 19:05Z comment on #1754, story-map-service.ts in #1762) is
 * mapped to the view model inside fetchStoryMap. The JSON below is that comment's example
 * verbatim, so this test fails if the mapping drifts from the server's shape.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from './story-map-response';
import {
  canTravelTo,
  deriveStoryMapView,
  mapStoryMapPayload,
  resetStoryMapCache,
  useStoryMap,
  useStoryMapAvailable,
  type StoryMapPayload,
} from '../useStoryMap';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

vi.mock('@/infrastructure/api/rest-client', () => ({ fetchWithAuth: vi.fn() }));

const SERVER_PAYLOAD: StoryMapPayload = {
  campaignId: '00000000-0000-0000-0000-000000000000',
  available: true,
  currentPlaceKey: 'the-crypt',
  zones: [{ key: 'the-upper-reach', name: 'The Upper Reach' }],
  places: [
    {
      key: 'the-archive',
      name: 'The Archive',
      zoneKey: 'the-upper-reach',
      x: 0.2667,
      y: 0.3,
      state: 'visited',
      current: false,
      summary: 'Location in The Upper Reach: The Archive',
      imageUrl: 'https://example.test/archive.png',
    },
    {
      key: 'the-crypt',
      name: 'The Crypt',
      zoneKey: 'the-upper-reach',
      x: 0.7333,
      y: 0.3,
      state: 'visited',
      current: true,
      summary: 'Location in The Upper Reach: The Crypt',
      imageUrl: null,
    },
    {
      key: 'the-gate',
      name: 'The Gate',
      zoneKey: 'the-upper-reach',
      x: 0.2667,
      y: 0.7,
      state: 'known',
      current: false,
      summary: null,
      imageUrl: null,
    },
    {
      key: 'the-ledge',
      name: 'The Ledge',
      zoneKey: 'the-upper-reach',
      x: 0.7333,
      y: 0.7,
      state: 'visited',
      current: false,
      summary: null,
      imageUrl: null,
    },
  ],
  edges: [
    { from: 'the-ledge', to: 'the-archive', label: null },
    { from: 'the-archive', to: 'the-ledge', label: null },
    { from: 'the-archive', to: 'the-crypt', label: 'secret stair' },
    { from: 'the-crypt', to: 'the-archive', label: 'secret stair' },
    { from: 'the-ledge', to: 'the-gate', label: 'rope bridge' },
  ],
};

afterEach(() => {
  resetStoryMapCache();
  vi.mocked(fetchWithAuth).mockReset();
  vi.restoreAllMocks();
});

describe('mapStoryMapPayload: the #1754 example payload', () => {
  const graph = mapStoryMapPayload(SERVER_PAYLOAD);
  const view = graph ? deriveStoryMapView(graph) : null;

  it('keeps the places, the zone and the current place', () => {
    expect(view?.places.map((p) => p.key).sort()).toEqual(
      ['the-archive', 'the-crypt', 'the-gate', 'the-ledge'].sort(),
    );
    expect(view?.current?.name).toBe('The Crypt');
    expect(view?.zones.map((z) => z.name)).toEqual(['The Upper Reach']);
  });

  it('draws each two-way route once, with its label', () => {
    expect(view?.routes).toHaveLength(3);
    const label = (a: string, b: string) =>
      view?.routes.find(
        (r) => (r.from.key === a && r.to.key === b) || (r.from.key === b && r.to.key === a),
      )?.label;
    expect(label('the-archive', 'the-crypt')).toBe('secret stair');
    expect(label('the-ledge', 'the-gate')).toBe('rope bridge');
    expect(label('the-ledge', 'the-archive')).toBeNull();
  });

  it('lets the player travel to a neighbour of the current place only', () => {
    const place = (key: string) => view?.places.find((p) => p.key === key);
    expect(canTravelTo(place('the-archive')!)).toBe(true);
    expect(canTravelTo(place('the-ledge')!)).toBe(false);
    expect(canTravelTo(place('the-crypt')!)).toBe(false);
  });

  it('takes the thumbnail from imageUrl', () => {
    expect(graph?.places.find((p) => p.key === 'the-archive')?.thumbnailUrl).toBe(
      'https://example.test/archive.png',
    );
    expect(graph?.places.find((p) => p.key === 'the-crypt')?.thumbnailUrl).toBeNull();
  });

  it('returns no map when available is false', () => {
    expect(mapStoryMapPayload({ ...SERVER_PAYLOAD, available: false })).toBeNull();
  });
});

describe('useStoryMap: how GET /v1/story-map/:campaignId answers', () => {
  it('asks for the campaign map and shows it', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(jsonResponse(SERVER_PAYLOAD));
    const { result } = renderHook(() => useStoryMap('camp-a'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchWithAuth).toHaveBeenCalledWith('/v1/story-map/camp-a');
    expect(result.current.view?.current?.name).toBe('The Crypt');
  });

  it('a 404 means no map, and logs nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useStoryMap('camp-b'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('available false means no map button', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(
      jsonResponse({
        ...SERVER_PAYLOAD,
        available: false,
        places: [],
        edges: [],
        zones: [],
        currentPlaceKey: null,
      }),
    );
    const { result } = renderHook(() => useStoryMap('camp-c'));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    const { result: available } = renderHook(() => useStoryMapAvailable('camp-c'));
    expect(available.current).toBe(false);
  });

  it('a server error shows the error state, not a map', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { result } = renderHook(() => useStoryMap('camp-d'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.view).toBeNull();
  });

  it('the plaque and the panel share one request', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(jsonResponse(SERVER_PAYLOAD));
    const plaque = renderHook(() => useStoryMapAvailable('camp-e'));
    const panel = renderHook(() => useStoryMap('camp-e'));
    await waitFor(() => expect(panel.result.current.status).toBe('ready'));
    await waitFor(() => expect(plaque.result.current).toBe(true));
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });
});
