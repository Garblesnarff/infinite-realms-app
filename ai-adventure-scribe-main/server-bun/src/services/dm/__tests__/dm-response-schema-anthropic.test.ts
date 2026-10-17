import { describe, expect, test } from 'bun:test';

import { createDmResponseSchema, dmResponseSchema } from '../dm-response-schema.js';

/**
 * Anthropic structured-output lint (Refs #633).
 *
 * Anthropic compiles `output_config.format` / strict tool schemas into a grammar
 * and 400s when the schema is too complex. Per the platform docs
 * (https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
 * the explicit limits are:
 *  - no `oneOf` (not supported at all);
 *  - `anyOf` only for the nullable pattern `[{...T...}, {type: 'null'}]`;
 *  - at most 16 union-typed parameters (`anyOf` or `["T", "null"]`);
 *  - at most 24 optional parameters (not listed in `required`).
 *
 * This file walks the real emitted schema object (built by the real producer,
 * `createDmResponseSchema`) and fails on every pattern known to 400, including
 * the two from the 2026-10-16 Haiku 5.5 outage (PR 4): the `oneOf` in
 * combat_actions and the 32 union/nullable fields (limit 16).
 */

const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);

/** Anthropic's hard limits for structured-output schemas. */
export const ANTHROPIC_MAX_UNION_PARAMS = 16;
export const ANTHROPIC_MAX_OPTIONAL_PARAMS = 24;

/**
 * #633 PR 4: the schema sits at EXACTLY 16 unions / 24 optionals — the budget is
 * exhausted. The next PR that adds a nullable field or an optional parameter will
 * 400 on Haiku. If you need to add a field, convert an existing optional to
 * required (with an explicit default) or an existing nullable to optional-absent
 * first. Do not raise these constants without a live Haiku check.
 */

type Violation = { path: string; message: string };

/** True when node is exactly the nullable pattern Anthropic allows. */
function isNullableAnyOf(node: Record<string, unknown>): boolean {
  const anyOf = node['anyOf'];
  if (!Array.isArray(anyOf) || anyOf.length !== 2) return false;
  const isNull = (x: unknown) =>
    !!x && typeof x === 'object' && (x as Record<string, unknown>)['type'] === 'null';
  const [a, b] = anyOf as Array<Record<string, unknown>>;
  return (isNull(a) && !isNull(b)) || (isNull(b) && !isNull(a));
}

function lintNode(
  node: unknown,
  path: string,
  violations: Violation[],
  counts: { unions: number; optionals: number },
  seen: Set<object>,
): void {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((item, index) => lintNode(item, `${path}[${index}]`, violations, counts, seen));
    return;
  }

  const record = node as Record<string, unknown>;
  const type = record['type'];
  const enumValues = record['enum'];

  // (c) oneOf is not supported by Anthropic structured output at all.
  if ('oneOf' in record) {
    violations.push({ path, message: 'oneOf is not supported by Anthropic structured output' });
  }

  // (d) anyOf is only supported for the nullable pattern.
  if ('anyOf' in record) {
    if (isNullableAnyOf(record)) {
      counts.unions += 1;
    } else {
      violations.push({
        path,
        message: `anyOf is only supported for the nullable [{T}, {type: 'null'}] pattern`,
      });
    }
  }

  if (Array.isArray(type)) {
    if (enumValues !== undefined) {
      violations.push({
        path,
        message: `type is an array ${JSON.stringify(type)} but enum is also present`,
      });
    }
    if (type.length > 2) {
      violations.push({ path, message: `type array has ${type.length} members (max 2)` });
    }
    const unknownMembers = type.filter((member) => typeof member !== 'string' || !JSON_SCHEMA_TYPES.has(member));
    if (unknownMembers.length > 0) {
      violations.push({ path, message: `type array has unknown members ${JSON.stringify(unknownMembers)}` });
    }
    if (type.length === 2 && !type.includes('null')) {
      violations.push({ path, message: `type array ${JSON.stringify(type)} is a non-null union` });
    }
    if (type.includes('null')) {
      counts.unions += 1;
    }
  } else if (typeof type === 'string') {
    if (!JSON_SCHEMA_TYPES.has(type)) {
      violations.push({ path, message: `unknown type ${JSON.stringify(type)}` });
    }
    if (type !== 'null' && Array.isArray(enumValues) && enumValues.includes(null)) {
      violations.push({ path, message: `enum contains null but type is ${JSON.stringify(type)}` });
    }
  }

  // Count optional parameters: object properties not listed in `required`.
  if (type === 'object' && record['properties'] && typeof record['properties'] === 'object') {
    const required = Array.isArray(record['required']) ? (record['required'] as unknown[]) : [];
    const properties = record['properties'] as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) {
        counts.optionals += 1;
      }
      lintNode(properties[key], `${path}.${key}`, violations, counts, seen);
    }
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'properties') continue;
    lintNode(value, `${path}.${key}`, violations, counts, seen);
  }
}

function lintSchema(
  schema: unknown,
  label: string,
): { violations: Violation[]; unions: number; optionals: number } {
  const violations: Violation[] = [];
  const counts = { unions: 0, optionals: 0 };
  lintNode(schema, label, violations, counts, new Set());
  return { violations, unions: counts.unions, optionals: counts.optionals };
}

describe('dmResponseSchema Anthropic structured-output lint', () => {
  test('emitted dmResponseSchema has no Anthropic-rejected patterns', () => {
    const { violations } = lintSchema(dmResponseSchema, 'dmResponseSchema');
    expect(violations).toEqual([]);
  });

  test('default createDmResponseSchema() output has no Anthropic-rejected patterns', () => {
    const { violations } = lintSchema(createDmResponseSchema(), 'createDmResponseSchema()');
    expect(violations).toEqual([]);
  });

  test('union-typed parameters stay within the Anthropic limit of 16', () => {
    const { unions } = lintSchema(dmResponseSchema, 'dmResponseSchema');
    expect(unions).toBeLessThanOrEqual(ANTHROPIC_MAX_UNION_PARAMS);
  });

  test('optional parameters stay within the Anthropic limit of 24', () => {
    const { optionals } = lintSchema(dmResponseSchema, 'dmResponseSchema');
    expect(optionals).toBeLessThanOrEqual(ANTHROPIC_MAX_OPTIONAL_PARAMS);
  });

  test('combat_actions uses the flat schema (no oneOf)', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const items = (properties.combat_actions as { items: Record<string, unknown> }).items;
    expect('oneOf' in items).toBe(false);
    expect(items.type).toBe('object');
    // Both shapes are expressible: targeted (no origin) and AoE (origin present).
    const props = items.properties as Record<string, unknown>;
    expect(props.origin).toBeDefined();
    expect(props.target_ids).toBeDefined();
  });

  test('scene_spec inner fields are required (no unions, no optionals)', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const sceneSpec = (properties.scene_spec as { anyOf: Array<Record<string, unknown>> }).anyOf[0];
    // id/sessionId were removed in PR 4: the sanitizer always discards/replaces them.
    expect(sceneSpec.properties).not.toHaveProperty('id');
    expect(sceneSpec.properties).not.toHaveProperty('sessionId');
    const required = sceneSpec.required as string[];
    for (const field of ['environment', 'size', 'sceneDescription', 'seed', 'enemyPlacement']) {
      expect(required).toContain(field);
      const prop = (sceneSpec.properties as Record<string, Record<string, unknown>>)[field];
      expect('anyOf' in prop).toBe(false);
    }
  });

  test('lint rules fire on the known-bad patterns (negative control)', () => {
    const bad = {
      unionEnum: { type: ['string', 'null'], enum: ['a', null] },
      nullInEnum: { type: 'string', enum: ['a', null] },
      threeTypes: { type: ['string', 'number', 'null'] },
      nonNullUnion: { type: ['string', 'number'] },
      // #633 PR 4: oneOf and non-nullable anyOf are rejected outright.
      discriminated: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      stringOrNumber: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    };
    const { violations } = lintSchema(bad, 'bad');
    const messages = violations.map((violation) => violation.message);
    expect(messages.some((message) => message.includes('enum is also present'))).toBe(true);
    expect(messages.some((message) => message.includes('enum contains null'))).toBe(true);
    expect(messages.some((message) => message.includes('max 2'))).toBe(true);
    expect(messages.some((message) => message.includes('non-null union'))).toBe(true);
    expect(messages.some((message) => message.includes('oneOf is not supported'))).toBe(true);
    expect(messages.some((message) => message.includes('only supported for the nullable'))).toBe(true);
  });

  test('union counter trips above 16 (negative control)', () => {
    const manyUnions: Record<string, unknown> = { type: 'object', properties: {}, required: [] };
    const props = manyUnions.properties as Record<string, unknown>;
    for (let i = 0; i < 17; i++) {
      props[`f${i}`] = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    }
    const { unions } = lintSchema(manyUnions, 'manyUnions');
    expect(unions).toBe(17);
    expect(unions).toBeGreaterThan(ANTHROPIC_MAX_UNION_PARAMS);
  });
});
