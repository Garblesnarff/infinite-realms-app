/**
 * Regression tests for #465 (REOPENED): Step 8 "Randomize Ideal" and
 * "Randomize All Personality Fields" 500'd in prod while Trait 1 / Trait 2
 * randomize worked — and kept 500ing after #496.
 *
 * Real root cause: #496 narrowed COLUMN_MAP but named columns that do not
 * exist in prod. Prod's information_schema (read-only query, 2026-10-13,
 * reported on the issue) shows the content column is `text` on ALL FOUR
 * tables, and `source` exists ONLY on personality_traits:
 *   traits: id, text, background, created_at, source
 *   ideals: id, text, alignment, background, created_at
 *   bonds:  id, text, background, created_at
 *   flaws:  id, text, background, created_at
 * The #496 selects (`id, ideal, source` / `id, bond, source` /
 * `id, flaw, source`) still 42703 in prod — the prod server log shows
 * 25 x 42703 with exactly these messages:
 *   column personality_flaws.flaw does not exist (10x)
 *   column personality_ideals.ideal does not exist (8x)
 *   column personality_bonds.bond does not exist (7x)
 * #496's own test stubbed the wrong prod shape (ideals missing `alignment`
 * but keeping `ideal`/`source`), so its green tests proved nothing about
 * prod. This file stubs the REAL prod shape instead.
 *
 * Fixture producer: prod information_schema column lists + prod PostgREST
 * 42703 log lines quoted above (issue #465, 2026-10-13). Fixture rows carry
 * exactly the columns prod has — no more, no less.
 *
 * Tests hit the REAL Elysia route with Hark's exact repro input
 * (GET /v1/personality/random/ideals?background=acolyte&alignment=...).
 * Run against the pre-fix COLUMN_MAP, ideals/bonds/flaws/batch all 500
 * (the reported symptom); against the fixed selects they all 200.
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
// Fake PostgREST layer — faithful to the real prod schema (see header)
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

// Columns the fixed code selects that prod does NOT have, per table.
// Any select naming one of these gets a faithful PostgREST 42703.
const MISSING_COLUMNS: Record<string, string[]> = {
  personality_traits: [],
  personality_ideals: ['ideal', 'source'],
  personality_bonds: ['bond', 'source'],
  personality_flaws: ['flaw', 'source'],
};

// Fixture rows carry exactly the columns prod's information_schema reports.
const TABLES: Record<string, FakeRow[]> = {
  personality_traits: [
    { id: 'trait-1', text: 'I idolize a particular hero of my faith.', background: 'acolyte', created_at: '2025-01-01T00:00:00Z', source: 'PHB' },
    { id: 'trait-2', text: 'I always have a plan for when things go wrong.', background: null, created_at: '2025-01-01T00:00:00Z', source: 'PHB' },
  ],
  personality_ideals: [
    { id: 'ideal-1', text: 'Tradition. The ancient traditions of worship must be preserved.', alignment: 'Lawful Good', background: 'acolyte', created_at: '2025-01-01T00:00:00Z' },
    { id: 'ideal-2', text: 'Freedom. Chains are meant to be broken.', alignment: 'Chaotic Good', background: null, created_at: '2025-01-01T00:00:00Z' },
  ],
  personality_bonds: [
    { id: 'bond-1', text: 'I would die to recover an ancient relic of my faith.', background: 'acolyte', created_at: '2025-01-01T00:00:00Z' },
  ],
  personality_flaws: [
    { id: 'flaw-1', text: 'I am suspicious of strangers.', background: null, created_at: '2025-01-01T00:00:00Z' },
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

interface PersonalityBody {
  success: boolean;
  data: { id: string; text?: string; source?: string };
}

describe('GET /v1/personality/random/:type (#465 reopened)', () => {
  it('returns a random ideal for the exact Hark repro input (background=acolyte)', async () => {
    const res = await get('/v1/personality/random/ideals?background=acolyte&alignment=Lawful%20Good');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PersonalityBody;
    expect(body.success).toBe(true);
    expect(typeof body.data.text).toBe('string');
    expect(body.data.text?.length).toBeGreaterThan(0);
  });

  it('returns a random bond', async () => {
    const res = await get('/v1/personality/random/bonds');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PersonalityBody;
    expect(body.success).toBe(true);
    expect(typeof body.data.text).toBe('string');
    expect(body.data.text?.length).toBeGreaterThan(0);
  });

  it('returns a random flaw', async () => {
    const res = await get('/v1/personality/random/flaws');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PersonalityBody;
    expect(body.success).toBe(true);
    expect(typeof body.data.text).toBe('string');
    expect(body.data.text?.length).toBeGreaterThan(0);
  });

  it('still randomizes traits with a background filter (control: worked in prod)', async () => {
    const res = await get('/v1/personality/random/traits?background=acolyte');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PersonalityBody;
    expect(body.success).toBe(true);
    expect(body.data.text?.length).toBeGreaterThan(0);
    // traits is the one table prod gives a source column
    expect(body.data.source).toBe('PHB');
  });

  it('rejects an unknown type with 400', async () => {
    const res = await get('/v1/personality/random/moods');
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/personality/batch/random (#465 reopened)', () => {
  it('returns all four personality types without throwing on the ideals/bonds/flaws legs', async () => {
    const res = await get('/v1/personality/batch/random?background=acolyte&alignment=Lawful%20Good');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, { id: string; text?: string } | undefined>;
    };
    expect(body.success).toBe(true);
    for (const key of ['traits', 'traits2', 'ideals', 'bonds', 'flaws']) {
      const row = body.data[key];
      expect(row).toBeDefined();
      expect(typeof row?.text).toBe('string');
      expect(row?.text?.length).toBeGreaterThan(0);
    }
  });
});
