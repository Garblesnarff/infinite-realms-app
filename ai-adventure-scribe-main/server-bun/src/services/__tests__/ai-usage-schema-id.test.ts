/**
 * #1207: ai-usage-service.ts runs `INSERT INTO ai_usage ... RETURNING id`, so the row id must exist
 * in the drizzle table as well as in the database. A drizzle-pushed test database had no id column
 * and 503'd on generate. The column is defined by db/migrations/0020_ai_usage_id_pk.sql as
 * `serial PRIMARY KEY`; this pins the drizzle definition to that.
 */
import { describe, expect, it } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';

import { aiUsage } from '../../../../db/schema/usage';

describe('ai_usage drizzle schema (#1207)', () => {
  const columns = getTableColumns(aiUsage);

  it('has an id column', () => {
    expect(columns.id).toBeDefined();
    expect(columns.id.name).toBe('id');
  });

  it('defines id as serial PRIMARY KEY NOT NULL, as migration 0020_ai_usage_id_pk.sql does', () => {
    expect(columns.id.columnType).toBe('PgSerial');
    expect(columns.id.primary).toBe(true);
    expect(columns.id.notNull).toBe(true);
  });
});
