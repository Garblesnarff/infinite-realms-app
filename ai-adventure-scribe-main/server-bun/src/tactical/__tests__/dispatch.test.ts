import { describe, expect, test } from 'bun:test';
import { dispatchMapAction } from '../dispatch.js';
import { dispatchWithOneCorrectiveRetry } from '../dispatch.js';
import { buildTacticalPrompt } from '../prompt.js';
import { tacticalSizeForParticipant } from '../participant-size.js';
import type { TacticalMap } from '../types.js';

const map = (): TacticalMap => ({ id: 'map', sessionId: 'session', width: 6, height: 6, round: 1, sceneDescription: 'test', cells: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ terrain: 'floor', blocksMovement: false, blocksSight: false, cover: 0 as const, elevation: 0 }))), entities: [
  { id: 'pc-participant', x: 0, y: 0, size: 'medium', type: 'pc', speedFeet: 30, movementRemaining: 30 },
  { id: 'monster-participant', x: 5, y: 5, size: 'medium', type: 'monster', speedFeet: 30, movementRemaining: 30 },
] });

describe('CM-2 tactical dispatch', () => {
  test('uses the engine for valid moves and returns the engine path', () => {
    const state = map(); const result = dispatchMapAction(state, { action: 'move', entityId: 'pc-participant', x: 2, y: 0 });
    expect(result.applied).toBe(true); expect(state.entities[0].x).toBe(2);
  });
  test('returns a structured refusal with valid move summary', () => {
    const state = map(); state.entities[0].movementRemaining = 20;
    const result = dispatchMapAction(state, { action: 'move', entityId: 'pc-participant', x: 5, y: 0 });
    expect(result.applied).toBe(false); if (!result.applied) expect(result.refusal).toHaveProperty('validMoves');
  });
  test('includes bounded map, digest, and non-negotiable narration instructions', () => {
    const prompt = buildTacticalPrompt(map(), 'pc-participant');
    expect(prompt.split(/\s+/).length).toBeLessThanOrEqual(500); expect(prompt).toContain('Spatial facts may only come from the tactical digest');
  });
  test('uses canonical SRD monster sizes while retaining combat participant IDs', () => {
    expect(tacticalSizeForParticipant({ id: 'combat-participant-id', name: 'Aboleth', participantType: 'monster', speed: 40 })).toBe('large');
  });
  test('retries one refused DM action once, then drops a second refusal without looping', async () => {
    const refusal = { applied: false as const, action: { action: 'move' as const }, refusal: { reason: 'blocked' } };
    const apply = async () => refusal;
    let prompts = 0;
    const result = await dispatchWithOneCorrectiveRetry({ action: 'move' }, apply, async () => { prompts++; return { action: 'move' }; });
    expect(result.applied).toBe(false); expect(prompts).toBe(1);
  });
});
