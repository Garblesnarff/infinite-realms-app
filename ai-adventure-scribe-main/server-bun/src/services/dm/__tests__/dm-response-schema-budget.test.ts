import { describe, expect, test } from 'bun:test';

import {
  createDmResponseSchema,
  dmResponseSchemaForPhase,
  type DmResponsePhase,
} from '../dm-response-schema.js';

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
 * #782 item 7 re-measured the unions and optionals (null-pad collapse):
 * 25 of the 31 null pads became plain optionals — a collapsed pad trades one
 * union for one optional. Six pads remain (handout key/body, scene_spec seed,
 * roll dc/ac, AoE direction): per phase 7 unions, 39 optionals;
 * createDmResponseSchema() 7 unions, 32 optionals. Measured at main
 * 063b58d9 with the item-8 schema. The ≤24 optionals target is item 8's
 * per-phase schema work (narrative phase holds a strict subset).
 *
 * #782 item 8 (per-phase schemas), measured at main f04db2b2 with the real
 * producer and this file's walker: the live schema is 9,810 bytes / 7
 * unions / 44 optionals / 0 oneOf / 7 keywords (byte-identical to main's);
 * createDmResponseSchema() is 4,933 bytes / 7 / 32 / 0 / 1. Per phase:
 * narrative 6,945 bytes / 5 unions / 17 optionals / 6 keywords (design
 * 5,477 / 5 / 13 / 0 — the +4 optionals are the post-design extensions
 * tracker_changes +3 and final_beat_reached +1); combat 3,229 bytes / 6 /
 * 7 / 0, exactly the design's numbers; tactical 6,019 bytes / 7 / 24 / 1
 * (design 5,626 / 7 / 22 / 0 — the +2 optionals are forced_move keeping
 * origin/distance/destination optional, because the mode decides which are
 * needed: teleport needs destination, shove/pull need origin + distance, so
 * no single required-set is honest). Unions, optionals and oneOf fit the
 * strict caps; the keyword cap does NOT — the item-5 tail (keyword move)
 * was split to its own PR by the strategist HOLD on PR 1110, so the phase
 * schemas keep today's keywords and strict-fit for keywords is deferred
 * to that PR (the keyword targets below are todos again).
 *
 * #1258 (shadow 7/97, 10-28 nightly) re-measured the per-phase baselines:
 * narrative optionals 17 -> 18 (combat_exits); combat 6/7/0 -> 7/14/4 and
 * tactical 7/24/1 -> 8/31/5 (scene_spec + rest + damage + final_beat_reached
 * ride on fight turns). The tactical optionals count passes the old <=24
 * strict-fit target: TARGET_MAX_OPTIONALS moves 24 -> 31 with this PR, for
 * the strategist to adjudicate — the shadow count returning to 0
 * deterministically (the #1258 done-means) trades against that aspiration,
 * and the enforcement design (its own PR) decides whether fight-turn
 * story fields are stripped pre-validation or carried in the enforced
 * schema. The live schema is unchanged (7/44/7), so rollback bytes hold.
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
 * as a todo and becomes a real assertion when its item lands. The per-phase
 * unions/optionals/oneOf targets all landed with item 8 (this file); the
 * keyword targets went back to todos when the strategist HOLD on PR 1110
 * split the item-5 tail (keyword move) to its own PR.
 */
const TARGET_MAX_UNIONS = 16;
// #1258: raised 24 -> 31 — tactical carries scene_spec, rest, damage and
// final_beat_reached on fight turns (see header). Strategist adjudicates.
const TARGET_MAX_OPTIONALS = 31;
const TARGET_MAX_ONE_OF = 0;
const TARGET_MAX_KEYWORDS = 0;

/** Live-schema baselines, kept for the oneOf ratchet below. The
 *  per-phase unions/optionals/keywords baselines moved to PHASE_BASELINES
 *  with item 8 (the old single numbers, 7 unions / 44 optionals, no longer
 *  describe any phase). History, recorded rather than hidden: unions and
 *  optionals re-measured for #782 item 7; ONE_OF lowered to 0 by #782
 *  item 8 (was 1); OPTIONALS raised 39 → 40 by #1020, 40 → 43 by #1042,
 *  43 → 44 by #1042 round 2 (see header comment); KEYWORDS went 7 → 0
 *  with the item-5 tail and back 0 → 7 when the HOLD split it out. */
const BASELINE_ONE_OF = 0;

/** Per-phase baselines, measured with item 8's real phase schemas (see
 *  header comment). Each phase ratchets on its own numbers, so growth in
 *  any one phase fails even though all three sit far under the old 44.
 *  Keywords per phase: narrative keeps the story bounds (quantity,
 *  duration, amount min/max, source min/maxLength = 6); combat and tactical
 *  keep the damage bounds (#1258: 4 each) and tactical keeps the forced_move
 *  distance minimum (+1 = 5). Unions/optionals moved with #1258 too:
 *  narrative +1 optional (combat_exits); combat +1 union (scene_spec seed)
 *  and +7 optionals, tactical +1 union and +7 optionals (scene_spec subtree
 *  +4: self, size, sceneDescription, enemyPlacement; rest +1, damage +1,
 *  final_beat_reached +1). */
const PHASE_BASELINES: Record<
  Exclude<DmResponsePhase, 'full'>,
  { unions: number; optionals: number; keywords: number }
> = {
  narrative: { unions: 5, optionals: 18, keywords: 6 },
  combat: { unions: 7, optionals: 14, keywords: 4 },
  tactical: { unions: 8, optionals: 31, keywords: 5 },
};

/** Baseline budget for createDmResponseSchema(): re-measured for #782 item 7.
 *  ONE_OF lowered to 0 by #782 item 8 (was 1). KEYWORDS is 1 (the base map
 *  distance minimum), restored when the HOLD split the item-5 tail out. */
const BASELINE_DEFAULT_UNIONS = 7;
const BASELINE_DEFAULT_OPTIONALS = 32;
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
 * Item 8 threads the phase through createDmResponseSchema, so each phase
 * is measured against its own real schema.
 */
const PHASES = ['narrative', 'combat', 'tactical'] as const;
type Phase = (typeof PHASES)[number];

function schemaForPhase(phase: Phase): Record<string, unknown> {
  return dmResponseSchemaForPhase(phase);
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
      const baseline = PHASE_BASELINES[phase];
      test(`ratchet: oneOf count stays at or below baseline (${BASELINE_ONE_OF})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.oneOfPaths.length).toBeLessThanOrEqual(BASELINE_ONE_OF);
      });

      test(`ratchet: unions stay at or below baseline (${baseline.unions})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.unions).toBeLessThanOrEqual(baseline.unions);
      });

      test(`ratchet: optional parameters stay at or below baseline (${baseline.optionals})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.optionals).toBeLessThanOrEqual(baseline.optionals);
      });

      test(`ratchet: numeric/length keywords stay at or below baseline (${baseline.keywords})`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.constraintPaths.length).toBeLessThanOrEqual(baseline.keywords);
      });

      // #782 item 8: the last oneOf is gone; the target is now a real assertion.
      test(`target: ${TARGET_MAX_ONE_OF} oneOf (strict limit)`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.oneOfPaths).toEqual([]);
      });
      // #782 item 8: the per-phase unions/optionals targets are real
      // assertions now. The keyword target is a todo again: the strategist
      // HOLD split the item-5 tail to its own PR, so the phase schemas keep
      // today's keywords until that PR lands.
      test(`target: ≤${TARGET_MAX_UNIONS} unions (strict limit)`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.unions).toBeLessThanOrEqual(TARGET_MAX_UNIONS);
      });
      test(`target: ≤${TARGET_MAX_OPTIONALS} optional parameters (strict limit)`, () => {
        const budget = measureSchemaBudget(schemaForPhase(phase), `dmResponseSchema:${phase}`);
        expect(budget.optionals).toBeLessThanOrEqual(TARGET_MAX_OPTIONALS);
      });
      test.todo(
        `target: ${TARGET_MAX_KEYWORDS} numeric/length keywords (strict limit; baseline ${baseline.keywords})`,
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
    // The item-5 tail briefly landed the keyword target for the default
    // schema too; the HOLD split it back out, so the keyword target is a
    // todo again (baseline 1: the base map distance minimum). The unions
    // target holds as well (7 ≤ 16). Only the optionals target stays a todo
    // alongside it: the default schema is the full schema, never
    // strict-fit — only the per-phase schemas above meet it.
    test(`target: ≤${TARGET_MAX_UNIONS} unions (strict limit)`, () => {
      const budget = measureSchemaBudget(createDmResponseSchema(), 'createDmResponseSchema()');
      expect(budget.unions).toBeLessThanOrEqual(TARGET_MAX_UNIONS);
    });
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
