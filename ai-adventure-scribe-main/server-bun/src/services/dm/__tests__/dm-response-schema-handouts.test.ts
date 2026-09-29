import { describe, expect, test } from 'bun:test';

import { parseDmResponse } from '../dm-response-schema.js';

const response = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  text: 'The lantern flame gutters in the cold passage.',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
  ...overrides,
});

describe('dmResponseSchema handout action diagnostics (#2309)', () => {
  const authored = {
    mode: 'authored',
    key: 'harbor-map',
    title: 'Harbor map',
    body: null,
    giver: 'Captain Vey',
  };
  const improvised = {
    mode: 'improvised',
    key: null,
    title: 'Ransom note',
    body: 'Bring the ledger to the old mill by moonrise.',
    giver: 'A masked stranger',
  };

  test('names the failing action index and field, never the handout content', () => {
    // Action 1 is improvised but carries a key: `key` is the offending field.
    const bad = {
      mode: 'improvised',
      key: 'LEAKED-KEY-VALUE',
      title: 'LEAKED-TITLE-TEXT',
      body: 'LEAKED-BODY-TEXT the vault code is 4471',
      giver: 'LEAKED-GIVER-NAME',
    };

    const result = parseDmResponse(response({ handout_actions: [authored, bad, improvised] }));

    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.issues.join('\n');
    expect(message).toContain('handout_actions[1]');
    expect(message).toContain('key');
    for (const leaked of [
      'LEAKED-KEY-VALUE',
      'LEAKED-TITLE-TEXT',
      'LEAKED-BODY-TEXT',
      '4471',
      'LEAKED-GIVER-NAME',
    ]) {
      expect(message).not.toContain(leaked);
    }
  });

  test.each([
    ['mode', { ...improvised, mode: 'mystery-mode-value' }],
    ['title', { ...improvised, title: 12345 }],
    ['giver', { ...improvised, giver: null }],
    ['key', { ...authored, key: null }],
    ['body', { ...authored, body: 'authored handouts carry no inline body' }],
    ['body', { ...improvised, body: null }],
    ['action', 'not-an-object-payload'],
  ])('reports field %s and the action index for %j', (field, badAction) => {
    const result = parseDmResponse(response({ handout_actions: [improvised, badAction] }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual([`handout_actions[1].${field} is invalid`]);
  });

  test('reports a non-array handout_actions without an index', () => {
    const result = parseDmResponse(response({ handout_actions: 'nope' }));

    expect(result).toEqual({ success: false, issues: ['handout_actions must be an array'] });
  });

  test('still accepts a valid authored and a valid improvised action', () => {
    const result = parseDmResponse(response({ handout_actions: [authored, improvised] }));

    expect(result.success).toBe(true);
  });
});
