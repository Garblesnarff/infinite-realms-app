/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, mock, test } from 'bun:test';

// Same module-mock cleanup as index.ingest-exit.test.ts: restore the real Supabase client.
const realSupabase = createRequire(import.meta.url)('@supabase/supabase-js');
mock.module('@supabase/supabase-js', () => realSupabase);

const { buildProgram } = await import('./index.js');

/**
 * #2419: the Eternal Feast dry run printed only counts, so 4 stale location rows were invisible.
 * These tests run the real `reingest` command (real chunker, real option routing) against a local
 * fake of the REST endpoint. The existing rows use the columns readExistingCampaignChunks selects.
 */

const CAMPAIGN = 'stale-campaign';

let server: ReturnType<typeof Bun.serve>;
let existingRows: Array<Record<string, unknown>> = [];
let chunkDeleteQueries: string[] = [];
let writes: string[] = [];

const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const createdRepos: string[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function row(
  id: string,
  entityName: string,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    campaign_id: CAMPAIGN,
    chunk_type: 'location',
    entity_name: entityName,
    metadata,
    source_file: 'campaign_bible.md',
    source_section: 'Locations',
    created_at: '2026-08-27T02:44:57.000Z',
  };
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const table = url.pathname.replace('/rest/v1/', '');

      if (request.method === 'GET') {
        return json(table === 'campaign_chunks' ? existingRows : []);
      }
      if (request.method === 'DELETE' && table === 'campaign_chunks') {
        chunkDeleteQueries.push(decodeURIComponent(url.search));
        return json([]);
      }
      if (request.method !== 'DELETE') writes.push(`${request.method} ${table}`);
      return request.method === 'DELETE' ? json([]) : new Response(null, { status: 201 });
    },
  });
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-service-role';
});

afterAll(() => {
  void server.stop(true);
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(() => {
  // The bible renamed "The Hall (Old)" to "The Hall". "Old Keep" is gone from the bible and has an image.
  existingRows = [
    row('hall-clean', 'The Hall'),
    row('hall-old', 'The Hall (Old)'),
    row('keep-with-image', 'Old Keep', { image_url: 'https://cdn.example/keep.png' }),
  ];
  chunkDeleteQueries = [];
  writes = [];
  process.exitCode = 0;
});

afterEach(() => {
  while (createdRepos.length > 0) {
    const repoPath = createdRepos.pop();
    if (repoPath) rmSync(repoPath, { recursive: true, force: true });
  }
  process.exitCode = 0;
});

function createRepo(): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'lore-keeper-stale-'));
  createdRepos.push(repoPath);
  const campaignPath = join(repoPath, 'campaign-ideas', CAMPAIGN);
  mkdirSync(campaignPath, { recursive: true });
  writeFileSync(join(campaignPath, 'overview.md'), '# Stale Campaign\n\nA test campaign.\n');
  writeFileSync(
    join(campaignPath, 'campaign-bible.md'),
    '# Bible\n\n## 4. LOCATIONS\n\n*   **The Hall:** A hall.\n',
  );
  return repoPath;
}

async function runReingest(args: string[]): Promise<string> {
  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => void output.push(parts.join(' '));
  console.error = (...parts: unknown[]) => void output.push(parts.join(' '));
  try {
    await buildProgram().parseAsync(['reingest', '--repo-path', createRepo(), ...args], {
      from: 'user',
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return output.join('\n');
}

test('dry run lists a renamed location as stale, with the stale_rows count and what apply does', async () => {
  const output = await runReingest([]);

  assert.ok(!process.exitCode, output);
  assert.match(output, /existing_rows=3, stale_rows=2/);
  assert.match(
    output,
    /stale hall-old chunk_type=location entity_name="The Hall \(Old\)" has_image_url=false -> apply: leave; apply with --remove-stale: delete/,
  );
  assert.match(
    output,
    /stale keep-with-image chunk_type=location entity_name="Old Keep" has_image_url=true -> apply: leave \(has image_url, never deleted\)/,
  );
  assert.doesNotMatch(output, /stale hall-clean/);
  assert.deepEqual(writes, []);
  assert.deepEqual(chunkDeleteQueries, []);
});

test('--remove-stale without --apply changes nothing', async () => {
  const output = await runReingest(['--remove-stale']);

  assert.ok(!process.exitCode, output);
  assert.match(output, /--remove-stale only acts together with --apply/);
  assert.deepEqual(writes, []);
  assert.deepEqual(chunkDeleteQueries, []);
});

test('--apply without --remove-stale leaves every stale row in place', async () => {
  const output = await runReingest(['--apply', '--skip-embeddings', '--verbose']);

  assert.ok(!process.exitCode, output);
  assert.match(output, /stale_rows=2/);
  assert.deepEqual(chunkDeleteQueries, []);
});

test('--apply --remove-stale deletes the stale row without image_url and never the one with it', async () => {
  const output = await runReingest(['--apply', '--skip-embeddings', '--remove-stale']);

  assert.ok(!process.exitCode, output);
  assert.match(output, new RegExp(`${CAMPAIGN}: stale_rows_removed=1`));
  assert.equal(chunkDeleteQueries.length, 1);
  assert.match(chunkDeleteQueries[0] ?? '', /hall-old/);
  assert.doesNotMatch(chunkDeleteQueries[0] ?? '', /keep-with-image|hall-clean/);
});
