import { describe, expect, test } from 'bun:test';

import { dispatchMapAction } from '../dispatch.js';
import { generateMap } from '../generator.js';
import {
  assignEntitySlugs,
  entitySlug,
  normalizeEntityToken,
  resolveEntityRef,
  unknownEntityMessage,
} from '../identity.js';
import { buildTacticalPrompt } from '../prompt.js';
import { buildTacticalDigest } from '../tactical-context.js';

import type { MapEntity, TacticalMap } from '../types.js';

/**
 * The board as run 6 actually had it: entities keyed by UUID, addressed by the DM in slugs.
 * Every id below is a real UUID so that nothing in these tests can pass by accident on a
 * fixture whose ids happened to already be slug-shaped.
 */
const SEEKER_UUID = '3f1c9a72-8d4b-4c21-9e77-2b6f0a5d1e33';
const ROACH_ONE_UUID = 'a71e4d05-6c92-4f18-b3aa-90e7c2418d64';
const ROACH_TWO_UUID = 'c04b8e19-2a37-4d56-8f10-7e5b39ca62d1';

const entity = (id: string, name: string, x: number, y: number, type: 'pc' | 'monster') =>
  ({
    id,
    name,
    x,
    y,
    size: 'medium',
    type,
    speedFeet: 30,
    movementRemaining: 30,
  }) satisfies MapEntity;

const board = (): TacticalMap => {
  const entities = [
    entity(SEEKER_UUID, 'The Seeker', 1, 1, 'pc'),
    entity(ROACH_ONE_UUID, 'Shadow Roach', 12, 10, 'monster'),
    entity(ROACH_TWO_UUID, 'Shadow Roach', 12, 8, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 16,
    height: 14,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 14 }, () =>
      Array.from({ length: 16 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as const,
        elevation: 0,
      })),
    ),
    entities,
  };
};

describe('slug-based entity identity', () => {
  test('assigns bare slugs to lone names and one-based indices to duplicates', () => {
    const map = board();
    expect(map.entities.map(entitySlug)).toEqual([
      'the-seeker',
      'shadow-roach-1',
      'shadow-roach-2',
    ]);
  });

  test('normalizes case, spaces, and underscores to one canonical token', () => {
    expect(normalizeEntityToken('Shadow_Roach 1')).toBe('shadow-roach-1');
    expect(normalizeEntityToken('  SHADOW-ROACH-1  ')).toBe('shadow-roach-1');
  });

  // These are the exact strings the DM emitted in run 6, verbatim.
  test.each(['shadow-roach-1', 'shadow_roach_1', 'Shadow-Roach-1', 'SHADOW_ROACH_1'])(
    'resolves the run 6 spelling %p to the roach UUID',
    (token) => {
      expect(resolveEntityRef(board().entities, token)?.id).toBe(ROACH_ONE_UUID);
    },
  );

  test('resolves the article-dropped "seeker" and the raw UUID alike', () => {
    const entities = board().entities;
    expect(resolveEntityRef(entities, 'seeker')?.id).toBe(SEEKER_UUID);
    expect(resolveEntityRef(entities, 'The Seeker')?.id).toBe(SEEKER_UUID);
    expect(resolveEntityRef(entities, SEEKER_UUID)?.id).toBe(SEEKER_UUID);
    expect(resolveEntityRef(entities, SEEKER_UUID.toUpperCase())?.id).toBe(SEEKER_UUID);
  });

  test('refuses to guess when a reference names more than one entity', () => {
    // Two roaches answer to "shadow-roach"; picking one would be a coin flip.
    expect(resolveEntityRef(board().entities, 'shadow-roach')).toBeNull();
    expect(resolveEntityRef(board().entities, 'wyvern')).toBeNull();
  });

  test('the digest speaks slugs, never UUIDs', () => {
    const prompt = buildTacticalPrompt(board());
    expect(prompt).toContain('the-seeker|The Seeker@1,1');
    expect(prompt).toContain('shadow-roach-1|Shadow Roach@12,10');
    expect(prompt).toContain('vs[shadow-roach-1:');
    expect(prompt).not.toContain(SEEKER_UUID);
    expect(prompt).not.toContain(ROACH_ONE_UUID);
  });

  test('dispatch applies a slug-addressed move and reports the internal id', () => {
    const map = board();
    const result = dispatchMapAction(map, {
      action: 'move',
      entityId: 'shadow_roach_1',
      x: 10,
      y: 9,
      changes: null,
    });
    expect(result.applied).toBe(true);
    expect(result.action.action === 'move' && result.action.entityId).toBe(ROACH_ONE_UUID);
    expect(map.entities.find((e) => e.id === ROACH_ONE_UUID)).toMatchObject({ x: 10, y: 9 });
  });

  test('an unresolvable reference refuses with the live roster instead of dropping', () => {
    const map = board();
    const result = dispatchMapAction(map, {
      action: 'move',
      entityId: 'shadow-roach',
      x: 10,
      y: 9,
      changes: null,
    });
    expect(result.applied).toBe(false);
    if (result.applied) return;
    expect(result.refusal.reason).toBe('unknown_entity');
    expect(result.refusal.message).toBe(
      "no entity 'shadow-roach'; current entities: the-seeker@1,1, shadow-roach-1@12,10, shadow-roach-2@12,8",
    );
    // The board is untouched: a rejected action never half-applies.
    expect(map.entities.find((e) => e.id === ROACH_ONE_UUID)).toMatchObject({ x: 12, y: 10 });
  });

  test('forced_move and remove resolve slugs on the same terms as move', () => {
    const shoved = dispatchMapAction(board(), {
      action: 'forced_move',
      target: 'Shadow_Roach 1',
      mode: 'shove',
      origin: { x: 12, y: 12 },
      distance: 10,
      destination: null,
    });
    expect(shoved.applied).toBe(true);

    const map = board();
    expect(
      dispatchMapAction(map, {
        action: 'remove',
        entityId: 'seeker',
        x: null,
        y: null,
        changes: null,
      }).applied,
    ).toBe(true);
    expect(map.entities.some((e) => e.id === SEEKER_UUID)).toBe(false);

    const missing = dispatchMapAction(board(), {
      action: 'remove',
      entityId: 'the-wyvern',
      x: null,
      y: null,
      changes: null,
    });
    expect(missing.applied).toBe(false);
    if (!missing.applied) expect(missing.refusal.reason).toBe('unknown_entity');
  });

  test('mid-combat placements mint a slug that cannot collide', () => {
    const map = board();
    const summon = entity('9d2f7b60-1e58-4a93-8c07-46da2f83b915', 'Shadow Roach', 3, 3, 'monster');
    expect(
      dispatchMapAction(map, {
        action: 'place',
        entityId: null,
        x: null,
        y: null,
        changes: summon as unknown as Record<string, unknown>,
      }).applied,
    ).toBe(true);
    const placed = map.entities.find((e) => e.id === summon.id)!;
    expect(entitySlug(placed)).toBe('shadow-roach');
    expect(new Set(map.entities.map(entitySlug)).size).toBe(map.entities.length);
  });

  test('a full UUID-keyed party and warband still fits the 500-token budget, and slugs pay for it', () => {
    const uuid = (n: number) => `${String(n).repeat(8)}-1e58-4a93-8c07-46da2f83b915`;
    const roster = (i: number, name: string, type: 'pc' | 'monster') =>
      entity(uuid(i), name, 0, 0, type);
    const map = generateMap({
      environment: 'ruins',
      size: 'large',
      seed: 7,
      pcEntities: [roster(1, 'The Seeker', 'pc'), roster(2, 'Brann Ironfoot', 'pc')],
      enemyEntities: [
        roster(3, 'Shadow Roach', 'monster'),
        roster(4, 'Shadow Roach', 'monster'),
        roster(5, 'Shadow Roach', 'monster'),
        roster(6, 'Void-Maw', 'monster'),
      ],
    });
    expect(map.entities).toHaveLength(6);
    expect(map.entities.map(entitySlug)).toEqual([
      'the-seeker',
      'brann-ironfoot',
      'shadow-roach-1',
      'shadow-roach-2',
      'shadow-roach-3',
      'void-maw',
    ]);
    // The budget guard is enforced inside buildTacticalPrompt; assert the headroom too.
    expect(buildTacticalPrompt(map).split(/\s+/).length).toBeLessThanOrEqual(500);

    const slugged = buildTacticalDigest(map);
    map.entities.forEach((candidate) => delete candidate.slug);
    expect(slugged.length).toBeLessThan(buildTacticalDigest(map).length * 0.75);
  });

  test('the roster message names every entity with its cell', () => {
    expect(unknownEntityMessage(board().entities, 'roach')).toContain(
      'current entities: the-seeker@1,1',
    );
  });
});
