import { describe, expect, test } from 'bun:test';

import { dmResponseSchema, parseDmResponse } from '../dm-response-schema.js';

const response = (overrides: Record<string, unknown> = {}) => ({
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

describe('dmResponseSchema options contract', () => {
  test('requires an array of strings in the provider schema', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.options).toEqual({ type: 'array', items: { type: 'string' } });
    expect(dmResponseSchema.required).toContain('options');
  });

  test('parses and preserves structured action options', () => {
    const options = [
      'A. **Study the passage**, look for signs of movement.',
      'B. **Call out**, see whether anyone answers.',
      'C. **Press onward**, keep your hand near your weapon.',
    ];

    const parsed = parseDmResponse(response({ options }));

    expect(parsed).toEqual({ success: true, data: expect.objectContaining({ options }) });
  });

  test('rejects an options value containing non-string items', () => {
    const parsed = parseDmResponse(response({ options: ['A. **Look**, inspect the passage.', 2] }));

    expect(parsed).toEqual({
      success: false,
      issues: ['options must be an array of strings'],
    });
  });

  test('accepts legacy local shells that omit options', () => {
    expect(parseDmResponse(response()).success).toBe(true);
  });
});
