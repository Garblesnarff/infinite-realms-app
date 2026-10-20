import { describe, expect, test } from 'bun:test';

import { createDmResponseSchema, dmResponseSchema } from '../dm-response-schema.js';

/**
 * Epic #782 item 1 — Measure. (Refs #782)
 *
 * RATCHET, not red-first: asserts the CURRENT measured schema budget as the
 * baseline, so any PR that grows the schema fails. The strict structured-output
 * targets live as `test.todo` below; each #782 step (items 5-8) turns one todo
 * into a real assertion and lowers the baseline.
 *
 * Baseline measured at bd9041bf (2026-10-17) with the walker in this file:
 *  - per phase (dmResponseSchema): 34 unions, 20 optionals, 1 oneOf,
 *    7 numeric/length keywords
 *  - createDmResponseSchema(): 28 unions, 13 optionals, 1 oneOf,
 *    1 numeric/length keyword
 *
 * #782 item 8 lowered the oneOf baselines to 0 (combat_actions now uses anyOf
 * between two disjoint variants); the oneOf target todos below are now real
 * assertions.
 *
 * Counting follows the Anthropic convention from
 * dm-response-schema-anthropic.test.ts: every `anyOf` / `oneOf` node and every
 * `type: [..., 'null']` array counts as one union; every object property not
 * listed in `required` counts as one optional. Nodes are counted once by
 * identity, matching the existing lint.
 *
 * Test-only: no model-facing text changes.
 */

/**
 * Strict structured-output targets (docs checked 2026-10-16/17). Items 5-8 of
 * the epic tighten the ratchet from the baseline to these; each target starts
 * as a todo and becomes a real assertion when its item lands (the oneOf target
 * landed in #782 item 8; the remaining three are still todos).
 */
const TARGET_MAX_UNIONS = 16;
const TARGET_MAX_OPTIONALS = 24;
const TARGET_MAX_ONE_OF = 0;
const TARGET_MAX_KEYWORDS = 0;

/** Baseline budget per phase, measured at bd9041bf — see header comment.
 *  ONE_OF lowered to 0 by #782 item 8 (was 1). */
const BASELINE_UNIONS = 34;
const BASELINE_OPTIONALS = 20;
const BASELINE_ONE_OF = 0;
const BASELINE_KEYWORDS = 7;

/** Baseline budget for createDmResponseSchema(), measured at bd9041bf.
 *  ONE_OF lowered to 0 by #782 item 8 (was 1). */
const BASELINE_DEFAULT_UNIONS = 28;
const BASELINE_DEFAULT_OPTIONALS = 13;
const BASELINE_DEFAULT_ONE_OF = 0;
const BASELINE_DEFAULT_KEYWORDS = 1;

/**
 * Placeholder body for the target todos. bun-types requires test.todo to take
 * a function; #782 items 5-8 turn each todo into a real assertion.
 */
const todoStub = (): void => {
  // Intentionally empty: the strict target is not yet implemented.
};

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
  // their optionals too.
  if (record['properties'] && typeof record['properties'] === 'object') {
    const required = Array.isArray(record['required']) ? (record['required'] as unknown[]) : [];
    const properties = record['properties'] as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) {
        budget.optionals += 1;
      }
      measureNode(properties[key], `${path}.${key}`, budget, seen);
    }
    // Sibling subtrees on the same node (oneOf/anyOf/items/$defs/…) must still
    // be walked, but the properties map itself is not a schema node: a property
    // literally named `anyOf`, `minimum`, … must not be miscounted as a keyword.
    // (`type`/`required` are primitives and walking them is a no-op.)
    for (const [key, value] of Object.entries(record)) {
      if (key === 'properties' || key === 'required' || key === 'type') continue;
      measureNode(value, `${path}.${key}`, budget, seen);
    }
    return;
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
      test(`ratchet: oneOf count stays at or below baseline (${BASELINE_ONE_OF})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.oneOfPaths.length).toBeLessThanOrEqual(BASELINE_ONE_OF);
      });

      test(`ratchet: unions stay at or below baseline (${BASELINE_UNIONS})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.unions).toBeLessThanOrEqual(BASELINE_UNIONS);
      });

      test(`ratchet: optional parameters stay at or below baseline (${BASELINE_OPTIONALS})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.optionals).toBeLessThanOrEqual(BASELINE_OPTIONALS);
      });

      test(`ratchet: numeric/length keywords stay at or below baseline (${BASELINE_KEYWORDS})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.constraintPaths.length).toBeLessThanOrEqual(BASELINE_KEYWORDS);
      });

      // #782 item 8: the last oneOf is gone; the target is now a real assertion.
      test(`target: ${TARGET_MAX_ONE_OF} oneOf (strict limit)`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.oneOfPaths).toEqual([]);
      });
      test.todo(
        `target: ≤${TARGET_MAX_UNIONS} unions (strict limit; baseline ${BASELINE_UNIONS})`,
        todoStub,
      );
      test.todo(
        `target: ≤${TARGET_MAX_OPTIONALS} optional parameters (strict limit; baseline ${BASELINE_OPTIONALS})`,
        todoStub,
      );
      test.todo(
        `target: ${TARGET_MAX_KEYWORDS} numeric/length keywords (strict limit; baseline ${BASELINE_KEYWORDS})`,
        todoStub,
      );
    });
  }

  describe('default createDmResponseSchema()', () => {
    test(`ratchet: oneOf count stays at or below baseline (${BASELINE_DEFAULT_ONE_OF})`, () => {
      const budget = measureSchemaBudget(createDmResponseSchema(), 'createDmResponseSchema()');
      expect(budget.oneOfPaths.length).toBeLessThanOrEqual(BASELINE_DEFAULT_ONE_OF);
    });

    test(`ratchet: unions stay at or below baseline (${BASELINE_DEFAULT_UNIONS})`, () => {
      const budget = measureSchemaBudget(createDmResponseSchema(), 'createDmResponseSchema()');
      expect(budget.unions).toBeLessThanOrEqual(BASELINE_DEFAULT_UNIONS);
    });

    test(`ratchet: optional parameters stay at or below baseline (${BASELINE_DEFAULT_OPTIONALS})`, () => {
      const budget = measureSchemaBudget(createDmResponseSchema(), 'createDmResponseSchema()');
      expect(budget.optionals).toBeLessThanOrEqual(BASELINE_DEFAULT_OPTIONALS);
    });

    test(`ratchet: numeric/length keywords stay at or below baseline (${BASELINE_DEFAULT_KEYWORDS})`, () => {
      const budget = measureSchemaBudget(createDmResponseSchema(), 'createDmResponseSchema()');
      expect(budget.constraintPaths.length).toBeLessThanOrEqual(BASELINE_DEFAULT_KEYWORDS);
    });

    // #782 item 8: the last oneOf is gone; the target is now a real assertion.
    test(`target: ${TARGET_MAX_ONE_OF} oneOf (strict limit)`, () => {
      const budget = measureSchemaBudget(createDmResponseSchema(), 'createDmResponseSchema()');
      expect(budget.oneOfPaths).toEqual([]);
    });
    test.todo(
      `target: ≤${TARGET_MAX_UNIONS} unions (strict limit; baseline ${BASELINE_DEFAULT_UNIONS})`,
      todoStub,
    );
    test.todo(
      `target: ≤${TARGET_MAX_OPTIONALS} optional parameters (strict limit; baseline ${BASELINE_DEFAULT_OPTIONALS})`,
      todoStub,
    );
    test.todo(
      `target: ${TARGET_MAX_KEYWORDS} numeric/length keywords (strict limit; baseline ${BASELINE_DEFAULT_KEYWORDS})`,
      todoStub,
    );
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
        // A property literally named like a keyword is not a keyword.
        tricky: {
          type: 'object',
          properties: { minimum: { type: 'integer' } },
          required: [],
        },
      },
      required: ['discriminated'],
    };
    const budget = measureSchemaBudget(bad, 'bad');
    expect(budget.oneOfPaths).toEqual(['bad.discriminated', 'bad.sibling']);
    expect(budget.unions).toBe(5);
    // discriminated and sibling.inner are required; the seven other top-level
    // properties plus oneOf[0].deep, nullableObject.maybe and tricky.minimum
    // are optional.
    expect(budget.optionals).toBe(10);
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
