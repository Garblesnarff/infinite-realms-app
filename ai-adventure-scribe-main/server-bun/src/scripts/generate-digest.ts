#!/usr/bin/env bun
/**
 * Daily Digest Generator Script
 *
 * Generates a daily blog post summarizing all commits from the past 24 hours.
 *
 * Usage:
 *   bun run src/scripts/generate-digest.ts           # Generate and publish
 *   bun run src/scripts/generate-digest.ts --dry-run # Preview without publishing
 */

import { logger } from '../lib/logger.js';
import { BlogDigestService } from '../services/blog-digest-service.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

logger.info({
  msg: '[Digest] Starting daily digest generation',
  dryRun,
});

try {
  const result = await BlogDigestService.generateDailyDigest(dryRun);

  if (result.success) {
    if (result.postId) {
      logger.info({
        msg: '[Digest] Success! Created post',
        slug: result.postSlug,
        postId: result.postId,
        standalonePostId: result.standalonePostId,
      });
    } else if (result.error === 'No commits to process') {
      logger.info('[Digest] No commits found in the last 24 hours. Skipping digest.');
    } else if (dryRun) {
      logger.info({
        msg: '[Digest] Dry run complete',
        slug: result.postSlug,
      });
    }
  } else {
    logger.error({
      msg: '[Digest] Failed',
      error: result.error,
    });
    process.exit(1);
  }
} catch (error) {
  logger.error({
    msg: '[Digest] Fatal error',
    error,
  });
  process.exit(1);
}

logger.info('[Digest] Done.');
