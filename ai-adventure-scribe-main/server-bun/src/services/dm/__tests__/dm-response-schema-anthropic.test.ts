import { describe, expect, test } from 'bun:test';

import { createDmResponseSchema, dmResponseSchema } from '../dm-response-schema.js';

/**
 * Anthropic tool-use `input_schema` lint (Refs #633).
 *
 * Anthropic's tool schema validation rejects a subset of JSON Schema that
 * other providers accept. This file walks the real emitted schema object
 * (built by the real producer, `createDmResponseSchema`) and fails on the
 * patterns known to 400:
 *  (a) an `enum` sitting on a union-typed property (`type` is an array):
 *      enum values must be coherent with a single declared type. This is the
 *      exact 400 from the bake-off (`scene_spec.size`, `scene_spec.enemyPlacement`).
 *  (b) `null` inside `enum` while the declared type is a single non-null type;
 *      `type` arrays with more than 2 members, with unknown member names, or
 *      with two non-null members (ambiguous unions).
 */

const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);

type Violation = { path: string; message: string };

function lintNode(node: unknown, path: string, violations: Violation[], seen: Set<object>): void {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((item, index) => lintNode(item, `${path}[${index}]`, violations, seen));
    return;
  }

  const record = node as Record<string, unknown>;
  const type = record['type'];
  const enumValues = record['enum'];

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
  } else if (typeof type === 'string') {
    if (!JSON_SCHEMA_TYPES.has(type)) {
      violations.push({ path, message: `unknown type ${JSON.stringify(type)}` });
    }
    if (type !== 'null' && Array.isArray(enumValues) && enumValues.includes(null)) {
      violations.push({ path, message: `enum contains null but type is ${JSON.stringify(type)}` });
    }
  }

  for (const [key, value] of Object.entries(record)) {
    lintNode(value, `${path}.${key}`, violations, seen);
  }
}

function lintSchema(schema: unknown, label: string): Violation[] {
  const violations: Violation[] = [];
  lintNode(schema, label, violations, new Set());
  return violations;
}

describe('dmResponseSchema Anthropic input_schema lint', () => {
  test('emitted dmResponseSchema has no Anthropic-rejected type/enum patterns', () => {
    const violations = lintSchema(dmResponseSchema, 'dmResponseSchema');
    expect(violations).toEqual([]);
  });

  test('default createDmResponseSchema() output has no Anthropic-rejected type/enum patterns', () => {
    const violations = lintSchema(createDmResponseSchema(), 'createDmResponseSchema()');
    expect(violations).toEqual([]);
  });

  test('scene_spec enums use the nullable() anyOf form', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const sceneSpec = (properties.scene_spec as { anyOf: Array<{ properties: Record<string, unknown> }> }).anyOf[0]
      .properties;
    expect(sceneSpec.size).toEqual({
      anyOf: [{ type: 'string', enum: ['small', 'medium', 'large'] }, { type: 'null' }],
    });
    expect(sceneSpec.enemyPlacement).toEqual({
      anyOf: [{ type: 'string', enum: ['ambush', 'guarding', 'formation'] }, { type: 'null' }],
    });
  });

  test('lint rules fire on the known-bad patterns (negative control)', () => {
    const bad = {
      unionEnum: { type: ['string', 'null'], enum: ['a', null] },
      nullInEnum: { type: 'string', enum: ['a', null] },
      threeTypes: { type: ['string', 'number', 'null'] },
      nonNullUnion: { type: ['string', 'number'] },
    };
    const violations = lintSchema(bad, 'bad');
    const messages = violations.map((violation) => violation.message);
    expect(messages.some((message) => message.includes('enum is also present'))).toBe(true);
    expect(messages.some((message) => message.includes('enum contains null'))).toBe(true);
    expect(messages.some((message) => message.includes('max 2'))).toBe(true);
    expect(messages.some((message) => message.includes('non-null union'))).toBe(true);
  });
});
