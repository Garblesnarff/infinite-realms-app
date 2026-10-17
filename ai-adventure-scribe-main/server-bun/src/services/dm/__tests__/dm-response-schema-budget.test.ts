import { describe, expect, test } from 'bun:test';

import { createDmResponseSchema, dmResponseSchema } from '../dm-response-schema.js';

/**
 * Epic #782 item 1 — Measure. (Refs #782)
 *
 * A budget test that walks the LIVE DM reply schema per phase and asserts the
 * strict structured-output limits any current model must satisfy:
 *  - unions ≤ 16
 *  - optional parameters ≤ 24
 *  - no `oneOf`
 *  - no numeric or length constraint keywords
 *
 * Red first: this test FAILS on the current schema (34 unions, 1 oneOf, 7
 * numeric/length keywords). Items 5-8 of the epic fix the schema; this PR only
 * adds the measurement. Test-only: no model-facing text changes.
 *
 * Counting follows the Anthropic convention from
 * dm-response-schema-anthropic.test.ts: every `anyOf` / `oneOf` node and every
 * `type: [..., 'null']` array counts as one union; every object property not
 * listed in `required` counts as one optional. Nodes are counted once by
 * identity, matching the existing lint.
 */

/** Anthropic strict structured-output limits (docs checked 2026-10-16/17). */
const MAX_UNIONS = 16;
const MAX_OPTIONALS = 24;

/** JSON Schema keywords Anthropic strict mode rejects (numeric + length family). */
const NUMERIC_OR_LENGTH_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'uniqueItems',
];

/**
 * Phases from the epic (#782 item 8): narrative, combat, tactical.
 * Item 8 threads the phase through createDmResponseSchema; until then every
 * phase emits the one live schema, so the budget is measured per phase against
 * the same object.
 */
const PHASES = ['narrative', 'combat', 'tactical'] as const;
type Phase = (typeof PHASES)[number];

function schemaForPhase(phase: Phase): Record<string, unknown> {
  // #782 item 8: createDmResponseSchema({ phase }). Today there is one live schema.
  void phase;
  return dmResponseSchema as unknown as Record<string, unknown>;
}

type Budget = {
  unions: number;
  optionals: number;
  oneOfPaths: string[];
  constraintPaths: string[];
};

function measureNode(node: unknown, path: string, budget: Budget, seen: Set<object>): void {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((item, index) => measureNode(item, `${path}[${index}]`, budget, seen));
    return;
  }

  const record = node as Record<string, unknown>;

  if ('oneOf' in record) {
    budget.oneOfPaths.push(path);
    budget.unions += 1;
  } else if (Array.isArray(record['anyOf'])) {
    budget.unions += 1;
  }

  const type = record['type'];
  if (Array.isArray(type) && type.includes('null')) {
    budget.unions += 1;
  }

  for (const keyword of NUMERIC_OR_LENGTH_KEYWORDS) {
    if (keyword in record) {
      budget.constraintPaths.push(`${path}.${keyword}`);
    }
  }

  // Keyed on `properties` being present rather than `type === 'object'`, so
  // nullable-object (`type: ['object', 'null']`) and typeless property bags count
  // their optionals too. No `return` here: sibling subtrees on the same node
  // (oneOf/anyOf/items/$defs/…) must still be walked; the `seen` set above
  // keeps already-visited nodes from being counted twice.
  if (record['properties'] && typeof record['properties'] === 'object') {
    const required = Array.isArray(record['required']) ? (record['required'] as unknown[]) : [];
    const properties = record['properties'] as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) {
        budget.optionals += 1;
      }
      measureNode(properties[key], `${path}.${key}`, budget, seen);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    measureNode(value, `${path}.${key}`, budget, seen);
  }
}

function measureSchemaBudget(schema: unknown, label: string): Budget {
  const budget: Budget = { unions: 0, optionals: 0, oneOfPaths: [], constraintPaths: [] };
  measureNode(schema, label, budget, new Set());
  return budget;
}

describe('dmResponseSchema strict budget (Refs #782 item 1)', () => {
  for (const phase of PHASES) {
    describe(`phase ${phase}`, () => {
      test('has no oneOf', () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.oneOfPaths).toEqual([]);
      });

      test('stays within 16 unions', () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.unions).toBeLessThanOrEqual(MAX_UNIONS);
      });

      test('stays within 24 optional parameters', () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.optionals).toBeLessThanOrEqual(MAX_OPTIONALS);
      });

      test('has no numeric or length constraint keywords', () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.constraintPaths).toEqual([]);
      });
    });
  }

  test('default createDmResponseSchema() is also measured', () => {
    const budget = measureSchemaBudget(createDmResponseSchema(), 'createDmResponseSchema()');
    expect(budget.oneOfPaths).toEqual([]);
    expect(budget.unions).toBeLessThanOrEqual(MAX_UNIONS);
    expect(budget.optionals).toBeLessThanOrEqual(MAX_OPTIONALS);
    expect(budget.constraintPaths).toEqual([]);
  });

  test('the walker fires on every budget violation (negative control)', () => {
    const bad = {
      type: 'object',
      properties: {
        discriminated: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        padded: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        typeArrayNull: { type: ['integer', 'null'] },
        ranged: { type: 'integer', minimum: 1, maximum: 10 },
        sized: { type: 'string', minLength: 1, maxLength: 50 },
        // Sibling subtrees on an object-with-properties node must be walked.
        sibling: {
          type: 'object',
          properties: { inner: { type: 'string' } },
          required: ['inner'],
          oneOf: [
            { type: 'object', properties: { deep: { type: 'integer', minimum: 5 } }, required: [] },
          ],
        },
        // Optionals count even without an exact `type: 'object'`.
        nullableObject: {
          type: ['object', 'null'],
          properties: { maybe: { type: 'string' } },
          required: [],
        },
      },
      required: ['discriminated'],
    };
    const budget = measureSchemaBudget(bad, 'bad');
    expect(budget.oneOfPaths).toEqual(['bad.discriminated', 'bad.sibling']);
    expect(budget.unions).toBe(5);
    // discriminated and sibling.inner are required; the six other top-level
    // properties plus oneOf[0].deep and nullableObject.maybe are optional.
    expect(budget.optionals).toBe(8);
    expect(budget.constraintPaths).toEqual([
      'bad.ranged.minimum',
      'bad.ranged.maximum',
      'bad.sized.minLength',
      'bad.sized.maxLength',
      'bad.sibling.oneOf[0].deep.minimum',
    ]);
  });

  test('the walker stays quiet on a minimal valid schema (positive control)', () => {
    const good = {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        count: { type: 'integer' },
      },
      required: ['text', 'count'],
    };
    const budget = measureSchemaBudget(good, 'good');
    expect(budget).toEqual({ unions: 0, optionals: 0, oneOfPaths: [], constraintPaths: [] });
  });
});
