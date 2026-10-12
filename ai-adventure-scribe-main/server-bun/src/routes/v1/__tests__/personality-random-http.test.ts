/**
 * Regression tests for #465: Step 8 "Randomize Ideal" and "Randomize All
 * Personality Fields" 500'd in prod while Trait 1 / Trait 2 randomize worked.
 *
 * Root cause: the random endpoints selected the `alignment` column for ideals.
 * The personality_* tables are managed outside both migration trees, so schema
 * drift is unguarded: prod's personality_ideals lacks `alignment`. The count
 * query (selects only `id`) succeeded, then the row query failed -> 500, and
 * the batch endpoint threw on the ideals leg -> 500. The fix narrows
 * COLUMN_MAP to the columns the API serves (id, content, source); the sole
 * consumer only reads the text content columns.
 *
 * Tests hit the REAL Elysia route with Hark's exact repro input
 * (GET /v1/personality/random/ideals?background=acolyte&alignment=...), with
 * supabase stubbed to reproduce prod: personality_ideals missing `alignment`
 * (PostgREST 42703 on any select naming it). Fixture rows follow the real
 * table shapes from COLUMN_MAP / PersonalityRow.
 */

import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

// The route's middleware chain is not under test here: auth and rate limiting
// are replaced with no-op plugins so the tests exercise the handler logic.
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia(),
}));
mock.module('../../../middleware/require-user-auth.js', () => ({
  resolveUser: new Elysia(),
  requireUserAuth: new Elysia(),
}));

// ---------------------------------------------------------------------------
// Fake PostgREST layer
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

// personality_ideals in prod is missing the `alignment` column (see header).
const MISSING_COLUMNS: Record<string, string[]> = {
  personality_ideals: ['alignment'],
};

const TABLES: Record<string, FakeRow[]> = {
  personality_traits: [
    { id: 'trait-1', text: 'I idolize a particular hero of my faith.', background: 'acolyte', source: 'PHB' },
    { id: 'trait-2', text: 'I always have a plan for when things go wrong.', background: null, source: 'PHB' },
  ],
  personality_ideals: [
    // NOTE: no `alignment` key: prod's table lacks the column.
    { id: 'ideal-1', ideal: 'Tradition. The ancient traditions of worship must be preserved.', background: 'acolyte', source: 'PHB' },
    { id: 'ideal-2', ideal: 'Freedom. Chains are meant to be broken.', background: null, source: 'PHB' },
  ],
  personality_bonds: [
    { id: 'bond-1', bond: 'I would die to recover an ancient relic of my faith.', background: 'acolyte', source: 'PHB' },
  ],
  personality_flaws: [
    { id: 'flaw-1', flaw: 'I am suspicious of strangers.', background: null, source: 'PHB' },
  ],
};

function projectColumns(row: FakeRow, columns: string): FakeRow {
  const out: FakeRow = { id: row.id };
  for (const col of columns.split(',').map((c) => c.trim())) {
    if (col === 'id') continue;
    out[col] = col in row ? row[col] : null;
  }
  return out;
}

class FakeQuery implements PromiseLike<unknown> {
  private orFilter: string | null = null;
  private rangeFrom = 0;
  private rangeTo = 0;
  private hasRange = false;
  private singleMode = false;

  constructor(
    private table: string,
    private columns: string,
    private countOnly: boolean,
  ) {}

  or(filter: string): this {
    this.orFilter = filter;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    this.hasRange = true;
    return this;
  }

  single(): this {
    this.singleMode = true;
    return this;
  }

  private missingColumn(): string | null {
    const missing = MISSING_COLUMNS[this.table] ?? [];
    const selected = this.columns.split(',').map((c) => c.trim());
    return selected.find((c) => missing.includes(c)) ?? null;
  }

  private filteredRows(): FakeRow[] {
    let rows = TABLES[this.table] ?? [];
    // Supports the background filter shape the route builds:
    // "background.eq.<bg>,background.is.null"
    if (this.orFilter) {
      const m = this.orFilter.match(/^background\.eq\.([^,]+),background\.is\.null$/);
      if (m) {
        const bg = m[1];
        rows = rows.filter((r) => r.background === bg || r.background == null);
      } else {
        rows = [];
      }
    }
    return rows;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const missing = this.missingColumn();
    let result: unknown;
    if (missing) {
      // Faithful PostgREST 42703: the column does not exist on the table.
      result = {
        data: null,
        count: null,
        error: {
          code: '42703',
          message: `column "${missing}" of relation "${this.table}" does not exist`,
        },
      };
    } else if (this.countOnly) {
      result = { data: [], count: this.filteredRows().length, error: null };
    } else {
      const rows = this.filteredRows();
      const slice = this.hasRange ? rows.slice(this.rangeFrom, this.rangeTo + 1) : rows;
      if (this.singleMode && slice.length === 0) {
        result = { data: null, error: { code: 'PGRST116', message: 'The result contains 0 rows' } };
      } else {
        const projected = slice.map((r) => projectColumns(r, this.columns));
        result = { data: this.singleMode ? (projected[0] ?? null) : projected, error: null };
      }
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

mock.module('../../../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string, opts?: { count: string; head: boolean }) =>
        new FakeQuery(table, columns, opts?.head === true),
    }),
  },
  supabaseService: {},
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { personalityRoutes } = await import('../personality.js');

function get(path: string): Promise<Response> {
  const app = createRequestPipelineApp().use(personalityRoutes);
  return app.handle(new Request(`http://localhost${path}`, { method: 'GET' }));
}

describe('GET /v1/personality/random/:type (#465)', () => {
  it('returns a random ideal for the exact Hark repro input (background=acolyte)', async () => {
    const res = await get('/v1/personality/random/ideals?background=acolyte&alignment=Lawful%20Good');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; ideal: string; source: string };
    };
    expect(body.success).toBe(true);
    expect(typeof body.data.ideal).toBe('string');
    expect(body.data.ideal.length).toBeGreaterThan(0);
  });

  it('still randomizes traits with a background filter (control: worked in prod)', async () => {
    const res = await get('/v1/personality/random/traits?background=acolyte');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { text: string } };
    expect(body.success).toBe(true);
    expect(body.data.text.length).toBeGreaterThan(0);
  });

  it('rejects an unknown type with 400', async () => {
    const res = await get('/v1/personality/random/moods');
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/personality/batch/random (#465)', () => {
  it('returns all four personality types without throwing on the ideals leg', async () => {
    const res = await get('/v1/personality/batch/random?background=acolyte&alignment=Lawful%20Good');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, { id: string } | undefined>;
    };
    expect(body.success).toBe(true);
    expect(body.data.traits).toBeDefined();
    expect(body.data.traits2).toBeDefined();
    expect(body.data.ideals).toBeDefined();
    expect(body.data.bonds).toBeDefined();
    expect(body.data.flaws).toBeDefined();
  });
});
