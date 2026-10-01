import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, test } from 'bun:test';

import { buildProgram, DEFAULT_CAMPAIGN_REPO_PATH } from './index.js';

import type { Command } from 'commander';

/**
 * These tests drive the real commander program rather than the library
 * functions, because the bug in #1805 lived entirely in option routing: every
 * library function was correct, and the subcommand simply never received what
 * the operator typed.
 */

const createdRepos: string[] = [];

function createCampaignRepo(campaignDirectories: string[]): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'lore-keeper-cli-'));
  createdRepos.push(repoPath);

  for (const directory of campaignDirectories) {
    const campaignPath = join(repoPath, 'campaign-ideas', directory);
    mkdirSync(campaignPath, { recursive: true });
    writeFileSync(join(campaignPath, 'overview.md'), `# ${directory}\n`);
  }

  return repoPath;
}

function reingestCommandOf(program: Command): Command {
  const command = program.commands.find((candidate) => candidate.name() === 'reingest');
  assert.ok(command, 'expected a reingest subcommand');
  return command;
}

/** Swap the terminal action for a capture, leaving all option routing real. */
function captureReingestOptions(program: Command): () => Record<string, unknown> | undefined {
  let captured: Record<string, unknown> | undefined;
  reingestCommandOf(program).action((options: Record<string, unknown>) => {
    captured = options;
  });
  return () => captured;
}

afterEach(() => {
  while (createdRepos.length > 0) {
    const repoPath = createdRepos.pop();
    if (repoPath) rmSync(repoPath, { recursive: true, force: true });
  }
  process.exitCode = 0;
});

test('reingest receives the --repo-path and --campaign values the operator passes', async () => {
  const program = buildProgram();
  const readCaptured = captureReingestOptions(program);

  await program.parseAsync(
    ['reingest', '--repo-path', '/tmp/campaign-repo', '--campaign', 'the-eternal-feast'],
    { from: 'user' },
  );

  const captured = readCaptured();
  assert.ok(captured, 'expected the reingest action to run');
  assert.equal(captured.repoPath, '/tmp/campaign-repo');
  assert.equal(captured.campaign, 'the-eternal-feast');
  // Dry-run stays the default: writing must always be an explicit choice.
  assert.equal(captured.apply, false);
});

test('reingest short flags and the other shadowed options route to the subcommand', async () => {
  const program = buildProgram();
  const readCaptured = captureReingestOptions(program);

  await program.parseAsync(
    ['reingest', '-p', '/tmp/other-repo', '-c', 'abyssal-descent', '-v', '-s'],
    { from: 'user' },
  );

  const captured = readCaptured();
  assert.ok(captured, 'expected the reingest action to run');
  assert.equal(captured.repoPath, '/tmp/other-repo');
  assert.equal(captured.campaign, 'abyssal-descent');
  assert.equal(captured.verbose, true);
  assert.equal(captured.skipEmbeddings, true);
});

test('reingest falls back to its own default repo path when none is passed', async () => {
  const program = buildProgram();
  const readCaptured = captureReingestOptions(program);

  await program.parseAsync(['reingest'], { from: 'user' });

  const captured = readCaptured();
  assert.ok(captured, 'expected the reingest action to run');
  assert.equal(captured.repoPath, DEFAULT_CAMPAIGN_REPO_PATH);
  assert.equal(captured.campaign, undefined);
});

test('an unknown campaign slug errors instead of falling through to every campaign', async () => {
  const repoPath = createCampaignRepo(['the-eternal-feast', 'abyssal-descent']);
  const program = buildProgram();

  const errors: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));
  console.log = () => {};

  try {
    await program.parseAsync(
      ['reingest', '--repo-path', repoPath, '--campaign', 'not-a-campaign'],
      {
        from: 'user',
      },
    );
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }

  assert.equal(process.exitCode, 1);
  const reported = errors.join('\n');
  assert.match(reported, /Campaign slug not found: not-a-campaign/);
  // The guard must stop the run, not quietly widen it to every discovered campaign.
  assert.doesNotMatch(reported, /Campaigns: 2/);
});

test('reingest exits loudly when the repo has no campaign directories', async () => {
  const repoPath = mkdtempSync(join(tmpdir(), 'lore-keeper-empty-repo-'));
  createdRepos.push(repoPath);
  mkdirSync(join(repoPath, 'campaign-ideas'), { recursive: true });

  const program = buildProgram();
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));

  try {
    await program.parseAsync(['reingest', '--repo-path', repoPath], { from: 'user' });
  } finally {
    console.error = originalError;
  }

  assert.equal(process.exitCode, 1);
  const reported = errors.join('\n');
  assert.ok(reported.includes(repoPath));
  assert.match(reported, /campaign-ideas\/ with at least one campaign directory/);
  assert.match(reported, /--repo-path/);
});

test('the legacy option-only invocation still routes to the default ingest command', async () => {
  const program = buildProgram();
  let captured: Record<string, unknown> | undefined;
  const ingest = program.commands.find((candidate) => candidate.name() === 'ingest');
  assert.ok(ingest, 'expected an ingest subcommand');
  ingest.action((options: Record<string, unknown>) => {
    captured = options;
  });

  await program.parseAsync(['--campaign', 'academy-of-arcane-gastronomy', '-p', '/tmp/legacy'], {
    from: 'user',
  });

  assert.ok(captured, 'expected the ingest action to run');
  assert.equal(captured.campaign, 'academy-of-arcane-gastronomy');
  assert.equal(captured.repoPath, '/tmp/legacy');
});
