import { describe, expect, test } from 'bun:test';

import { getSpellById } from '../../data/spellData.js';
import { parseDmResponse } from '../../services/dm/dm-response-schema.js';
import { calculateAoECast } from '../aoe.js';
import { dispatchMapAction } from '../dispatch.js';
import { getAoECells } from '../engine.js';

import type { TacticalMap } from '../types.js';

const map = (): TacticalMap => ({
  id: 'map', sessionId: 'session', width: 8, height: 8, round: 1, sceneDescription: 'test',
  cells: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({
    terrain: 'floor' as const, blocksMovement: false, blocksSight: false, cover: 0 as const, elevation: 0,
  }))),
  entities: [
    { id: 'caster', x: 1, y: 3, size: 'medium', type: 'pc', speedFeet: 30, movementRemaining: 30 },
    { id: 'imp-a', x: 2, y: 3, size: 'medium', type: 'monster', speedFeet: 30, movementRemaining: 30 },
    { id: 'imp-b', x: 3, y: 3, size: 'medium', type: 'monster', speedFeet: 30, movementRemaining: 30 },
  ],
});

describe('AoE cell geometry', () => {
  test('accepts an AoE intent without LLM-supplied target IDs and rejects one with them', () => {
    const response = {
      text: '', narration_segments: [], roll_requests: [], combat_transition: 'none', scene_spec: null,
      map_actions: [], handout_actions: [], combatants: [],
      combat_actions: [{ actor_id: 'caster', action_type: 'cast_spell', spell_id: 'thunderwave', origin: { x: 1, y: 3 }, direction: null, slot_level: null }],
    };
    expect(parseDmResponse(response).success).toBe(true);
    expect(parseDmResponse({
      ...response,
      combat_actions: [{ ...response.combat_actions[0], target_ids: ['imp-a'] }],
    }).success).toBe(false);
  });

  test('uses the same exact cells for sphere, cone, cube, and line targeting', () => {
    const state = map();
    const sphere = getAoECells(state, 'sphere', { x: 3, y: 3 }, { radiusFeet: 5 });
    const cube = getAoECells(state, 'cube', { x: 3, y: 3 }, { sizeFeet: 10 });
    const cone = getAoECells(state, 'cone', { x: 3, y: 3 }, { lengthFeet: 10, direction: { x: 1, y: 0 } });
    const line = getAoECells(state, 'line', { x: 3, y: 3 }, { lengthFeet: 10, widthFeet: 5, direction: { x: 1, y: 0 } });
    expect(sphere).toHaveLength(9);
    expect(cube).toEqual(sphere);
    expect(cone).toEqual(expect.arrayContaining([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }]));
    expect(line).toEqual(expect.arrayContaining([{ x: 4, y: 3 }, { x: 5, y: 3 }]));
    expect(line).not.toEqual(expect.arrayContaining([{ x: 3, y: 4 }]));
  });

  test('Thunderwave produces cube-15 geometry and legal failed-save pushes', () => {
    const state = map();
    const spell = getSpellById('thunderwave');
    expect(spell?.areaOfEffect).toEqual({ shape: 'cube', sizeFeet: 15 });
    expect(spell?.forcedMove).toEqual({ distanceFeet: 10, direction: 'away' });
    const cast = calculateAoECast(state, 'caster', spell!.areaOfEffect!, { x: 1, y: 3 }, null);
    expect(cast.geometry).toMatchObject({ shape: 'cube', sizeFeet: 15, origin: { x: 1, y: 3 } });
    expect(cast.targets.map((target) => target.id)).toEqual(['imp-a', 'imp-b']);
    state.entities = state.entities.filter((entity) => entity.id !== 'imp-b');
    const pushed = dispatchMapAction(state, {
      action: 'forced_move', target: 'imp-a', mode: 'shove', origin: cast.geometry.origin,
      distance: spell!.forcedMove!.distanceFeet, destination: null,
    });
    expect(pushed).toMatchObject({ applied: true, path: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }] });
    expect(state.entities.find((entity) => entity.id === 'imp-a')).toMatchObject({ x: 4, y: 3 });
  });

  test('a forced AoE push stops at an obstacle rather than crossing it', () => {
    const state = map();
    state.cells[3][3].blocksMovement = true;
    const result = dispatchMapAction(state, {
      action: 'forced_move', target: 'imp-a', mode: 'shove', origin: { x: 1, y: 3 }, distance: 10, destination: null,
    });
    expect(result).toMatchObject({ applied: false, refusal: { reason: 'illegal_forced_movement' } });
  });
});
