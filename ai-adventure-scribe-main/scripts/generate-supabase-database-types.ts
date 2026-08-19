/**
 * Emit src/integrations/supabase/types/database.ts from a live Postgres schema.
 *
 * Usage:
 *   DATABASE_URL=postgres://localhost:5432/<replayed-db> bun scripts/generate-supabase-database-types.ts
 *
 * The checked-in types file is a generated artifact. Hand-editing it is how
 * #1859 happened: it declared a column that did not exist.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

type Col = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
};

const query = `
SELECT json_agg(t ORDER BY t.table_name, t.ordinal_position)
FROM (
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
         is_identity, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public'
) t;
`;

const result = spawnSync('psql', ['-X', '-A', '-t', '-q', url, '-c', query], {
  encoding: 'utf8',
});
if (result.status !== 0) {
  console.error(result.stderr || 'psql failed');
  process.exit(result.status ?? 1);
}

const columns = JSON.parse(result.stdout.trim()) as Col[];

const tsType = (col: Col): string => {
  const nullable = col.is_nullable === 'YES' ? ' | null' : '';
  if (col.data_type === 'ARRAY') return `Json${nullable}`;
  switch (col.udt_name) {
    case 'bool':
      return `boolean${nullable}`;
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
      return `number${nullable}`;
    case 'json':
    case 'jsonb':
      return `Json${nullable}`;
    default:
      return `string${nullable}`;
  }
};

const optionalOnInsert = (col: Col): boolean =>
  col.column_default !== null || col.is_nullable === 'YES' || col.is_identity === 'YES';

const tables = new Map<string, Col[]>();
for (const col of columns) {
  const list = tables.get(col.table_name) ?? [];
  list.push(col);
  tables.set(col.table_name, list);
}

const tableBlock = (name: string, cols: Col[]): string => {
  const row = cols.map((c) => `      ${c.column_name}: ${tsType(c)}`).join('\n');
  const insert = cols
    .map((c) => `      ${c.column_name}${optionalOnInsert(c) ? '?' : ''}: ${tsType(c)}`)
    .join('\n');
  const update = cols.map((c) => `      ${c.column_name}?: ${tsType(c)}`).join('\n');
  return `    ${name}: {
      Row: {
${row}
      }
      Insert: {
${insert}
      }
      Update: {
${update}
      }
      Relationships: []
    }`;
};

const body = Array.from(tables.entries())
  .map(([name, cols]) => tableBlock(name, cols))
  .join('\n');

const file = `/**
 * Generated from a replayed PostgreSQL schema (scripts/generate-supabase-database-types.ts).
 * Do not hand-edit. The previous checked-in copy declared character_equipment.description
 * (which does not exist) and omitted nine live columns — that lie produced #1859.
 *
 * DDL source of truth: db/schema/*.ts + db/migrations/.
 * Regenerate: replay migrations, then
 *   DATABASE_URL=postgres://localhost:5432/<db> bun scripts/generate-supabase-database-types.ts
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
${body}
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
`;

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/integrations/supabase/types/database.ts',
);
await Bun.write(out, file);
console.log(`wrote ${tables.size} tables to ${out}`);
