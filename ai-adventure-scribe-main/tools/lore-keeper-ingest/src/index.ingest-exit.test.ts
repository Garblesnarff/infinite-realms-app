/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, mock, test } from 'bun:test';

// database.test.ts replaces createClient with a stub, and Bun keeps that module mock for the rest
// of the run. require() reaches the CJS build, which the mock does not cover, so restore the real
// client before importing the CLI. Without this the connection probe fails and main() calls
// process.exit(1) mid-run.
const realSupabase = createRequire(import.meta.url)('@supabase/supabase-js');
mock.module('@supabase/supabase-js', () => realSupabase);

const { buildProgram } = await import('./index.js');

/**
 * #2360: the ingest reported success while campaign_rules rejected every row. These tests run the
 * real CLI against a local fake of the REST endpoint that enforces the same CHECK as the table
 * (priority between 1 and 10), so the chunker's output and the CLI's exit code are both real.
 */

let server: ReturnType<typeof Bun.serve>;
let rejectAllRuleInserts = false;
let ruleInserts: Array<Record<string, unknown>> = [];

const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const createdRepos: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const table = pathname.replace('/rest/v1/', '');

      if (request.method === 'POST' && table === 'campaign_rules') {
        const rows = (await request.json()) as Array<Record<string, unknown>>;
        const outOfRange = rows.some(
          (row) => typeof row.priority !== 'number' || row.priority < 1 || row.priority > 10,
        );
        if (rejectAllRuleInserts || outOfRange) {
          return json(
            {
              code: '23514',
              message:
                'new row for relation "campaign_rules" violates check constraint "campaign_rules_priority_check"',
            },
            400,
          );
        }
        ruleInserts.push(...rows);
        return new Response(null, { status: 201 });
      }

      // Connection probe, deletes and every other write succeed.
      if (request.method === 'GET' || request.method === 'DELETE') return json([]);
      return new Response(null, { status: 201 });
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
  rejectAllRuleInserts = false;
  ruleInserts = [];
  process.exitCode = 0;
});

afterEach(() => {
  while (createdRepos.length > 0) {
    const repoPath = createdRepos.pop();
    if (repoPath) rmSync(repoPath, { recursive: true, force: true });
  }
  process.exitCode = 0;
});

function createRepoWithRules(ruleCount: number): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'lore-keeper-exit-'));
  createdRepos.push(repoPath);
  const campaignPath = join(repoPath, 'campaign-ideas', 'ruleful-campaign');
  mkdirSync(campaignPath, { recursive: true });

  const rules = Array.from(
    { length: ruleCount },
    (_, i) => `* IF the party does thing ${i + 1} THEN consequence ${i + 1} follows.`,
  );
  writeFileSync(join(campaignPath, 'overview.md'), '# Ruleful Campaign\n\nA test campaign.\n');
  writeFileSync(join(campaignPath, 'creative-brief.md'), '# Creative brief\n\nDark and cozy.\n');
  writeFileSync(
    join(campaignPath, 'world-building-spec.md'),
    `# World\n\n## 6. Causality Chains & Dynamic World States\n\n${rules.join('\n')}\n\n## 7. Mechanics Reference\n\n* **Note:** unrelated.\n`,
  );
  writeFileSync(
    join(campaignPath, 'campaign-bible.md'),
    '# Bible\n\n## 1. Locations\n\n### Loc 1: The Hall\nA hall.\n',
  );
  return repoPath;
}

async function runIngest(args: string[]): Promise<string> {
  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => void output.push(parts.join(' '));
  console.error = (...parts: unknown[]) => void output.push(parts.join(' '));
  try {
    await buildProgram().parseAsync(args, { from: 'user' });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return output.join('\n');
}

test('an 8-rule bible ingests all 8 rules within 1-10 and exits 0', async () => {
  const repoPath = createRepoWithRules(8);

  const output = await runIngest(['ingest', '--skip-embeddings', '--repo-path', repoPath]);

  assert.ok(!process.exitCode, output);
  assert.equal(ruleInserts.length, 8);
  assert.match(output, /campaign_rules: attempted 8, written 8/);
});

test('a rejected rules insert exits non-zero and prints attempted vs written per table', async () => {
  const repoPath = createRepoWithRules(8);
  rejectAllRuleInserts = true;

  const output = await runIngest(['ingest', '--skip-embeddings', '--repo-path', repoPath]);

  assert.equal(process.exitCode, 1);
  assert.match(output, /Failed to insert rules/);
  assert.match(
    output,
    /campaign_chunks: attempted \d+, written \d+; campaign_rules: attempted 8, written 0/,
  );
  // The chunks were written before the rules failed; the summary must not claim otherwise.
  assert.doesNotMatch(output, /campaign_chunks: attempted \d+, written 0;/);
});

test('reingest --apply exits non-zero and prints attempted vs written when rules are rejected', async () => {
  const repoPath = createRepoWithRules(8);
  rejectAllRuleInserts = true;

  const output = await runIngest([
    'reingest',
    '--apply',
    '--skip-embeddings',
    '--repo-path',
    repoPath,
  ]);

  assert.equal(process.exitCode, 1);
  assert.match(output, /Failed to insert rules for ruleful-campaign/);
  assert.match(output, /campaign_rules: attempted 8, written 0/);
});
