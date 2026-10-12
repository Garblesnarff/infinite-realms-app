import { describe, expect, test } from 'bun:test';

import { sanitizeRefusedEnvelope } from '../dm-feature-gate.js';

describe('sanitizeRefusedEnvelope', () => {
  const envelope = {
    text: 'You call upon a power you do not have, and nothing answers.',
    options: ['A. **Flee**, run.'],
    narration_segments: [{ type: 'narration', text: 'Nothing answers.' }],
    roll_requests: [{ id: 'r1' }],
    combat_actions: [{ kind: 'attack' }],
    combatants: [{ id: 'c1' }],
    map_actions: [{ kind: 'move' }],
    handout_actions: [{ kind: 'give' }],
    scene_spec: { mood: 'tense' },
    combat_transition: 'start',
    combat_entry_pending: { encounterId: 'e1' },
    combat_exits: { type: 'flee' },
    xp_award: { amount: 100 },
    items: [{ name: 'Sword' }],
    conditions: [{ name: 'Poisoned' }],
    // #264: a rest the DM bundled with the refused turn must not survive.
    rest: { type: 'long' },
    someFutureField: 'kept',
  };

  test('strips every actionable field including the story rest', () => {
    const sanitized = sanitizeRefusedEnvelope(envelope, 'Mira cannot do that.');

    expect(sanitized.text).toBe('Mira cannot do that.');
    expect(sanitized.options).toEqual([]);
    expect(sanitized.narration_segments).toEqual([]);
    expect(sanitized.roll_requests).toEqual([]);
    expect(sanitized.combat_actions).toEqual([]);
    expect(sanitized.combatants).toEqual([]);
    expect(sanitized.map_actions).toEqual([]);
    expect(sanitized.handout_actions).toEqual([]);
    expect(sanitized.scene_spec).toBeNull();
    expect(sanitized.combat_transition).toBe('none');
    expect('combat_entry_pending' in sanitized).toBe(false);
    expect('combat_exits' in sanitized).toBe(false);
    expect('xp_award' in sanitized).toBe(false);
    expect('items' in sanitized).toBe(false);
    expect('conditions' in sanitized).toBe(false);
    expect('rest' in sanitized).toBe(false);
  });

  test('keeps non-actionable envelope fields', () => {
    const sanitized = sanitizeRefusedEnvelope(envelope, 'Mira cannot do that.');

    expect(sanitized.someFutureField).toBe('kept');
  });
});
