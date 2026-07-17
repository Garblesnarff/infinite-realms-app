import { describe, expect, test } from 'bun:test';

import { parseDmResponse } from '../../services/dm/dm-response-schema.js';
import { dispatchMapAction, dispatchWithOneCorrectiveRetry } from '../dispatch.js';
import { getAoETargets } from '../engine.js';
import { tacticalSizeForParticipant } from '../participant-size.js';
import { buildTacticalPrompt } from '../prompt.js';

import type { TacticalMap } from '../types.js';

const map = (): TacticalMap => ({
  id: 'map',
  sessionId: 'session',
  width: 6,
  height: 6,
  round: 1,
  sceneDescription: 'test',
  cells: Array.from({ length: 6 }, () =>
    Array.from({ length: 6 }, () => ({
      terrain: 'floor',
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'pc-participant',
      x: 0,
      y: 0,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'monster-participant',
      x: 5,
      y: 5,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});

describe('CM-2 tactical dispatch', () => {
  test('uses the engine for valid moves and returns the engine path', () => {
    const state = map();
    const result = dispatchMapAction(state, {
      action: 'move',
      entityId: 'pc-participant',
      x: 2,
      y: 0,
    });
    expect(result.applied).toBe(true);
    expect(state.entities[0].x).toBe(2);
  });
  test('returns a structured refusal with valid move summary', () => {
    const state = map();
    state.entities[0].movementRemaining = 20;
    const result = dispatchMapAction(state, {
      action: 'move',
      entityId: 'pc-participant',
      x: 5,
      y: 0,
    });
    expect(result.applied).toBe(false);
    if (!result.applied) expect(result.refusal).toHaveProperty('validMoves');
  });
  test('includes bounded map, digest, and non-negotiable narration instructions', () => {
    const prompt = buildTacticalPrompt(map(), 'pc-participant');
    expect(prompt.split(/\s+/).length).toBeLessThanOrEqual(500);
    expect(prompt).toContain('Spatial facts may only come from the tactical digest');
  });
  test('uses canonical SRD monster sizes while retaining combat participant IDs', () => {
    expect(
      tacticalSizeForParticipant({
        id: 'combat-participant-id',
        name: 'Aboleth',
        participantType: 'monster',
        speed: 40,
      }),
    ).toBe('large');
  });
  test('retries one refused DM action once, then drops a second refusal without looping', async () => {
    const refusal = {
      applied: false as const,
      action: { action: 'move' as const },
      refusal: { reason: 'blocked' },
    };
    const apply = async () => refusal;
    let prompts = 0;
    const result = await dispatchWithOneCorrectiveRetry({ action: 'move' }, apply, async () => {
      prompts++;
      return { action: 'move' };
    });
    expect(result.applied).toBe(false);
    expect(prompts).toBe(1);
  });
  test('moves a target with a shove without consuming its normal movement', () => {
    const state = map();
    state.entities[1].x = 2;
    state.entities[1].y = 0;
    const before = state.entities[1].movementRemaining;
    const result = dispatchMapAction(state, {
      action: 'forced_move',
      target: 'monster-participant',
      mode: 'shove',
      origin: { x: 0, y: 0 },
      distance: 10,
      destination: null,
    });
    expect(result.applied).toBe(true);
    expect(state.entities[1]).toMatchObject({ x: 4, y: 0, movementRemaining: before });
    if (result.applied)
      expect(result.path).toEqual([
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ]);
  });
  test('stops forced movement at a wall and refuses a fully blocked shove', () => {
    const state = map();
    state.entities[1].x = 2;
    state.entities[1].y = 0;
    state.cells[0][3].blocksMovement = true;
    const result = dispatchMapAction(state, {
      action: 'forced_move',
      target: 'monster-participant',
      mode: 'shove',
      origin: { x: 0, y: 0 },
      distance: 10,
      destination: null,
    });
    expect(result.applied).toBe(false);
    if (!result.applied) expect(result.refusal.reason).toBe('illegal_forced_movement');
  });
  test('allows teleport only to a clear destination', () => {
    const state = map();
    const result = dispatchMapAction(state, {
      action: 'forced_move',
      target: 'monster-participant',
      mode: 'teleport',
      origin: null,
      distance: null,
      destination: { x: 3, y: 3 },
    });
    expect(result.applied).toBe(true);
    expect(state.entities[1]).toMatchObject({ x: 3, y: 3 });
  });
  test('accepts forced_move only through the canonical runtime response parser', () => {
    const parsed = parseDmResponse({
      text: '',
      narration_segments: [],
      roll_requests: [],
      combat_transition: 'none',
      scene_spec: null,
      combatants: [],
      combat_actions: [],
      map_actions: [
        {
          action: 'forced_move',
          target: 'pc-participant',
          mode: 'pull',
          origin: { x: 2, y: 0 },
          distance: 5,
          destination: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
  test('scripts three combat turns: movement, friendly-fire AoE, and a door update', () => {
    const state = map();
    state.entities[1].x = 3;
    state.entities[1].y = 1;
    state.entities.push({
      id: 'pc-ally',
      x: 2,
      y: 1,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
    });
    expect(
      dispatchMapAction(state, { action: 'move', entityId: 'pc-participant', x: 1, y: 0 }).applied,
    ).toBe(true);
    const targets = getAoETargets(
      state,
      'sphere',
      { x: 2, y: 1 },
      { radiusFeet: 5, sourceEntityId: 'pc-participant' },
    );
    expect(targets).toEqual(
      expect.arrayContaining([
        { id: 'pc-ally', friendly: true },
        { id: 'monster-participant', friendly: false },
      ]),
    );
    expect(
      dispatchMapAction(state, {
        action: 'update_cell',
        x: 4,
        y: 1,
        changes: { terrain: 'door_open', blocksMovement: false, blocksSight: false, cover: 0 },
      }).applied,
    ).toBe(true);
    expect(state.cells[1][4].terrain).toBe('door_open');
  });
});
