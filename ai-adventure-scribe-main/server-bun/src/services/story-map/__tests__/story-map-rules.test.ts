import { describe, expect, it } from 'bun:test';

import {
  currentPlaceKey,
  decidePlace,
  planMove,
  storyMapPromptBlock,
  visibleMap,
  type MapEdge,
  type MapPlace,
  type MapProgress,
} from '../story-map-rules.js';

const place = (placeKey: string, zoneKey: string | null = 'upper'): MapPlace => ({
  placeKey,
  name: placeKey
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' '),
  zoneKey,
  x: 0.5,
  y: 0.5,
});
const both = (a: string, b: string, hidden = false, label: string | null = null): MapEdge[] => [
  { fromKey: a, toKey: b, hidden, label },
  { fromKey: b, toKey: a, hidden, label },
];

// ledge <-> archive <-(hidden)-> crypt ; ledge -> gate (one way). Each place is in a zone of its
// own here, so only the routes connect them; the same-zone rule has its own test below.
const PLACES = ['the-ledge', 'the-archive', 'the-crypt', 'the-gate'].map((key) => place(key, key));
const EDGES: MapEdge[] = [
  ...both('the-ledge', 'the-archive'),
  ...both('the-archive', 'the-crypt', true, 'secret stair'),
  { fromKey: 'the-ledge', toKey: 'the-gate', hidden: false, label: 'rope bridge' },
];
const at = (
  rows: Array<[string, 'known' | 'visited', number?]>,
  revealed: MapProgress['revealed'] = [],
): MapProgress => ({
  rows: rows.map(([placeKey, state, minute]) => ({
    placeKey,
    state,
    visitedAt: minute === undefined ? null : new Date(Date.UTC(2026, 10, 25, 0, minute)),
  })),
  revealed,
});

describe('currentPlaceKey', () => {
  it('is the visited place with the newest visit', () => {
    expect(
      currentPlaceKey(
        at([
          ['the-ledge', 'visited', 1],
          ['the-archive', 'visited', 5],
          ['the-gate', 'known'],
        ]),
      ),
    ).toBe('the-archive');
    expect(currentPlaceKey(at([['the-gate', 'known']]))).toBeNull();
  });
});

describe('decidePlace', () => {
  it('accepts any map key for the opening scene, before anything is visited', () => {
    expect(decidePlace('the-crypt', PLACES, EDGES, at([]))).toEqual({
      accepted: true,
      placeKey: 'the-crypt',
      via: 'opening',
    });
  });

  it('accepts the current place and a neighbour of any visited place', () => {
    const progress = at([
      ['the-ledge', 'visited', 1],
      ['the-archive', 'visited', 2],
    ]);
    expect(decidePlace('the-archive', PLACES, EDGES, progress)).toMatchObject({ via: 'current' });
    expect(decidePlace('the-gate', PLACES, EDGES, progress)).toMatchObject({ via: 'neighbour' });
    expect(decidePlace('the-crypt', PLACES, EDGES, progress)).toMatchObject({
      accepted: true,
      via: 'neighbour',
    });
  });

  it('drops a key that is not on the map, a place no route reaches, and a non-string', () => {
    const progress = at([['the-crypt', 'visited', 1]]);
    expect(decidePlace('the-moon', PLACES, EDGES, progress)).toEqual({
      accepted: false,
      reason: 'unknown_key',
    });
    expect(decidePlace('the-gate', PLACES, EDGES, progress)).toEqual({
      accepted: false,
      reason: 'not_reachable',
    });
    expect(decidePlace(42, PLACES, EDGES, progress)).toEqual({
      accepted: false,
      reason: 'not_a_string',
    });
  });
});

describe('same-zone neighbours (strategist decision on #1762)', () => {
  // The chapel shares the crypt's zone; the tower is in another zone. No route reaches either.
  const zoned = [
    place('the-crypt', 'the-deep'),
    place('the-chapel', 'the-deep'),
    place('the-tower', 'the-heights'),
    place('the-shrine', null),
  ];
  const progress = at([['the-crypt', 'visited', 1]]);

  it('accepts a place in the same zone with no route, and drops one in another zone', () => {
    expect(decidePlace('the-chapel', zoned, [], progress)).toEqual({
      accepted: true,
      placeKey: 'the-chapel',
      via: 'neighbour',
    });
    expect(decidePlace('the-tower', zoned, [], progress)).toEqual({
      accepted: false,
      reason: 'not_reachable',
    });
    expect(decidePlace('the-shrine', zoned, [], progress)).toEqual({
      accepted: false,
      reason: 'not_reachable',
    });
  });

  it('a visit makes same-zone places known, and the prompt lists them as onward', () => {
    expect(planMove('the-crypt', [], at([]), zoned).know).toEqual(['the-chapel']);
    const block = storyMapPromptBlock(zoned, [], progress);
    expect(block).toContain('- the-crypt (The Crypt) -> the-chapel (The Chapel) (same zone)');
    expect(block).not.toContain('the-tower (The Tower) (same zone)');
  });
});

describe('planMove', () => {
  it('visits the place and makes its neighbours by usable routes known', () => {
    expect(planMove('the-ledge', EDGES, at([]))).toEqual({
      visit: 'the-ledge',
      know: ['the-archive', 'the-gate'],
      reveal: [],
    });
  });

  it('reveals a hidden route, both ways, when that is the only way in', () => {
    const move = planMove('the-crypt', EDGES, at([['the-archive', 'visited', 1]]));
    expect(move.reveal).toEqual([
      { fromKey: 'the-archive', toKey: 'the-crypt' },
      { fromKey: 'the-crypt', toKey: 'the-archive' },
    ]);
    expect(move.know).toEqual(['the-archive']);
  });
});

describe('visibleMap', () => {
  it('shows known and visited places only, and hides hidden routes until revealed', () => {
    const progress = at([
      ['the-archive', 'visited', 1],
      ['the-ledge', 'known'],
      ['the-crypt', 'known'],
    ]);
    const view = visibleMap(PLACES, EDGES, progress);
    expect(view.places.map((p) => [p.placeKey, p.state, p.current])).toEqual([
      ['the-ledge', 'known', false],
      ['the-archive', 'visited', true],
      ['the-crypt', 'known', false],
    ]);
    expect(view.edges.map((e) => `${e.fromKey}>${e.toKey}`).sort()).toEqual([
      'the-archive>the-ledge',
      'the-ledge>the-archive',
    ]);
    const revealed = visibleMap(PLACES, EDGES, {
      ...progress,
      revealed: [{ fromKey: 'the-archive', toKey: 'the-crypt' }],
    });
    expect(revealed.edges.map((e) => `${e.fromKey}>${e.toKey}`)).toContain('the-archive>the-crypt');
  });
});

describe('storyMapPromptBlock', () => {
  it('lists every place before the first visit', () => {
    const block = storyMapPromptBlock(PLACES, EDGES, at([]));
    expect(block).toContain('not been placed on the map yet');
    for (const p of PLACES) expect(block).toContain(`- ${p.placeKey} (${p.name})`);
  });

  it('names the current place, the known places, and routes onward with hidden ones marked', () => {
    const block = storyMapPromptBlock(
      PLACES,
      EDGES,
      at([
        ['the-archive', 'visited', 2],
        ['the-ledge', 'known'],
      ]),
    );
    expect(block).toContain('The hero is at the-archive (The Archive).');
    expect(block).toContain('- the-ledge (The Ledge): known');
    expect(block).toContain(
      '- the-archive (The Archive) -> the-crypt (The Crypt) by secret stair [hidden: the hero must find it]',
    );
    expect(block).toContain('set `place` to its key');
    expect(block.startsWith('<story_map>')).toBe(true);
    expect(block.endsWith('</story_map>')).toBe(true);
  });
});
