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

import { BlogDigestService } from '../services/blog-digest-service.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

console.log(`[Digest] Starting daily digest generation${dryRun ? ' (DRY RUN)' : ''}...`);

try {
  const result = await BlogDigestService.generateDailyDigest(dryRun);

  if (result.success) {
    if (result.postId) {
      console.log(`[Digest] Success! Created post: ${result.postSlug}`);
      console.log(`[Digest] Post ID: ${result.postId}`);
      if (result.standalonePostId) {
        console.log(`[Digest] Also created standalone feature post: ${result.standalonePostId}`);
      }
    } else if (result.error === 'No commits to process') {
      console.log('[Digest] No commits found in the last 24 hours. Skipping digest.');
    } else if (dryRun) {
      console.log(`[Digest] Dry run complete. Would create post: ${result.postSlug}`);
    }
  } else {
    console.error(`[Digest] Failed: ${result.error}`);
    process.exit(1);
  }
} catch (error) {
  console.error('[Digest] Fatal error:', error);
  process.exit(1);
}

console.log('[Digest] Done.');
