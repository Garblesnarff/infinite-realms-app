#!/usr/bin/env bun
/**
 * Queue Commits for Blog Digest
 *
 * Queues commits between two git refs for daily digest processing.
 *
 * Usage:
 *   bun run src/scripts/queue-commits.ts <from_ref> <to_ref>
 *
 * Example:
 *   bun run src/scripts/queue-commits.ts abc123 def456
 */

import { logger } from '../lib/logger.js';
import { BlogDigestService } from '../services/blog-digest-service.js';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: queue-commits.ts <from_ref> <to_ref>');
  process.exit(1);
}

const [fromRef, toRef] = args;

async function queueCommits() {
  logger.info({
    msg: '[Queue] Queuing commits',
    from: fromRef.slice(0, 7),
    to: toRef.slice(0, 7),
  });

  // Get commit info using git
  const proc = Bun.spawn([
    'git', 'log',
    '--pretty=format:%H|%s|%an|%aI',
    `${fromRef}..${toRef}`
  ], {
    cwd: '/var/www/infiniterealms/ai-adventure-scribe-main',
  });

  const output = await new Response(proc.stdout).text();
  const lines = output.trim().split('\n').filter(Boolean);

  if (lines.length === 0) {
    logger.info('[Queue] No commits to queue');
    return;
  }

  logger.info({ msg: '[Queue] Found commits', count: lines.length });

  for (const line of lines) {
    const [hash, message, author, dateStr] = line.split('|');

    // Get PR info if available (from commit message)
    const prMatch = message.match(/\(#(\d+)\)/);
    const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

    // Get changed files
    const filesProc = Bun.spawn([
      'git', 'diff-tree', '--no-commit-id', '--name-only', '-r', hash
    ], {
      cwd: '/var/www/infiniterealms/ai-adventure-scribe-main',
    });
    const filesOutput = await new Response(filesProc.stdout).text();
    const filesChanged = filesOutput.trim().split('\n').filter(Boolean);

    try {
      await BlogDigestService.queueCommit({
        commitHash: hash,
        commitMessage: message,
        author,
        filesChanged,
        prNumber,
        prTitle: prNumber ? message : undefined,
        committedAt: new Date(dateStr),
      });
      logger.info({
        msg: '[Queue] Queued commit',
        hash: hash.slice(0, 7),
        message: message.slice(0, 50),
      });
    } catch (error) {
      logger.error({
        msg: '[Queue] Failed to queue commit',
        hash: hash.slice(0, 7),
        error,
      });
    }
  }

  logger.info('[Queue] Done.');
}

await queueCommits();
