#!/usr/bin/env tsx

/**
 * Spell Mapping Audit Script
 *
 * Audits frontend spell ID mappings to identify missing, invalid, and stale entries.
 * Part of the spell mapping audit workplan (WU-1, WU-2).
 *
 * Usage: tsx scripts/audit-spell-mappings.ts
 *
 * Outputs:
 * - artifacts/spell-mapping-audit.json: Comprehensive audit report
 * - artifacts/canonical-spell-id-set.json: Complete list of expected spell IDs
 */

import path from 'node:path';
import fs from 'node:fs';

interface AuditReport {
  metadata: {
    timestamp: string;
    canonical_count: number;
    mapping_count: number;
  };
  canonical_ids: string[];
  missing: string[];
  invalid: string[];
  duplicates: Array<{ uuid: string; ids: string[] }>;
  stale: string[];
  summary: {
    total_issues: number;
    missing_count: number;
    invalid_count: number;
    duplicate_count: number;
    stale_count: number;
  };
}

const ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.join(ROOT, 'ai-adventure-scribe-main');

// UUID v4 validation regex
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extract all canonical spell IDs from classSpellMappings
 */
function loadCanonicalIds(): string[] {
  const mappingsPath = path.join(APP_ROOT, 'src/data/spells/mappings.ts');
  const mappingsContent = fs.readFileSync(mappingsPath, 'utf8');

  // Extract spell IDs from cantrips and spells arrays
  const idMatches = Array.from(mappingsContent.matchAll(/'([a-z0-9-]+)'/g));
  const ids = idMatches.map(match => match[1]);

  // Remove duplicates and sort
  return Array.from(new Set(ids)).sort();
}

/**
 * Load current spell ID mappings
 */
function loadCurrentMapping(): Record<string, string> {
  const mappingPath = path.join(APP_ROOT, 'src/utils/spell-id-mapping.ts');
  const mappingContent = fs.readFileSync(mappingPath, 'utf8');

  const mapping: Record<string, string> = {};

  // Extract key-value pairs from the mapping object
  const entryMatches = Array.from(mappingContent.matchAll(/'([a-z0-9-]+)'\s*:\s*'([0-9a-f-]+)'/gi));
  for (const match of entryMatches) {
    mapping[match[1]] = match[2];
  }

  return mapping;
}

/**
 * Validate if a string is a valid UUID v4
 */
function isValidUUID(uuid: string): boolean {
  return UUID_V4_REGEX.test(uuid);
}

/**
 * Find duplicate UUIDs across the mapping
 */
function findDuplicateUUIDs(mapping: Record<string, string>): Array<{ uuid: string; ids: string[] }> {
  const uuidToIds = new Map<string, string[]>();

  for (const [id, uuid] of Object.entries(mapping)) {
    const ids = uuidToIds.get(uuid) || [];
    ids.push(id);
    uuidToIds.set(uuid, ids);
  }

  return Array.from(uuidToIds.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([uuid, ids]) => ({ uuid, ids }))
    .sort((a, b) => a.uuid.localeCompare(b.uuid));
}

/**
 * Generate comprehensive audit report
 */
function generateAuditReport(): AuditReport {
  console.log('🔍 Starting spell mapping audit...');

  const canonicalIds = loadCanonicalIds();
  const currentMapping = loadCurrentMapping();

  console.log(`📊 Found ${canonicalIds.length} canonical spell IDs`);
  console.log(`📊 Found ${Object.keys(currentMapping).length} existing mappings`);

  // Analyze issues
  const missing = canonicalIds.filter(id => !(id in currentMapping));
  const invalid = Object.entries(currentMapping)
    .filter(([, uuid]) => !isValidUUID(uuid))
    .map(([id]) => id);
  const duplicates = findDuplicateUUIDs(currentMapping);
  const stale = Object.keys(currentMapping).filter(id => !canonicalIds.includes(id));

  console.log(`❌ Missing mappings: ${missing.length}`);
  console.log(`❌ Invalid UUIDs: ${invalid.length}`);
  console.log(`❌ Duplicate UUIDs: ${duplicates.length}`);
  console.log(`❌ Stale mappings: ${stale.length}`);

  const report: AuditReport = {
    metadata: {
      timestamp: new Date().toISOString(),
      canonical_count: canonicalIds.length,
      mapping_count: Object.keys(currentMapping).length,
    },
    canonical_ids: canonicalIds,
    missing,
    invalid,
    duplicates,
    stale,
    summary: {
      total_issues: missing.length + invalid.length + duplicates.length + stale.length,
      missing_count: missing.length,
      invalid_count: invalid.length,
      duplicate_count: duplicates.length,
      stale_count: stale.length,
    },
  };

  return report;
}

/**
 * Write audit report to artifacts directory
 */
function writeAuditReport(report: AuditReport): void {
  const artifactsDir = path.join(ROOT, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const reportPath = path.join(artifactsDir, 'spell-mapping-audit.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`✅ Audit report written to: ${reportPath}`);

  // Also write canonical IDs for reference
  const canonicalPath = path.join(artifactsDir, 'canonical-spell-id-set.json');
  fs.writeFileSync(canonicalPath, JSON.stringify(report.canonical_ids, null, 2));
  console.log(`✅ Canonical spell IDs written to: ${canonicalPath}`);
}

/**
 * Print human-readable summary
 */
function printSummary(report: AuditReport): void {
  console.log('\n📋 AUDIT SUMMARY');
  console.log('================');
  console.log(`Total canonical spell IDs: ${report.metadata.canonical_count}`);
  console.log(`Current mappings: ${report.metadata.mapping_count}`);
  console.log(`Total issues found: ${report.summary.total_issues}`);

  if (report.missing.length > 0) {
    console.log(`\n❌ MISSING MAPPINGS (${report.missing.length}):`);
    report.missing.slice(0, 10).forEach(id => console.log(`  - ${id}`));
    if (report.missing.length > 10) {
      console.log(`  ... and ${report.missing.length - 10} more`);
    }
  }

  if (report.invalid.length > 0) {
    console.log(`\n❌ INVALID UUIDs (${report.invalid.length}):`);
    report.invalid.slice(0, 10).forEach(id => console.log(`  - ${id}`));
    if (report.invalid.length > 10) {
      console.log(`  ... and ${report.invalid.length - 10} more`);
    }
  }

  if (report.duplicates.length > 0) {
    console.log(`\n❌ DUPLICATE UUIDs (${report.duplicates.length}):`);
    report.duplicates.forEach(({ uuid, ids }) => {
      console.log(`  - ${uuid} → ${ids.join(', ')}`);
    });
  }

  if (report.stale.length > 0) {
    console.log(`\n❌ STALE MAPPINGS (${report.stale.length}):`);
    report.stale.slice(0, 10).forEach(id => console.log(`  - ${id}`));
    if (report.stale.length > 10) {
      console.log(`  ... and ${report.stale.length - 10} more`);
    }
  }

  if (report.summary.total_issues === 0) {
    console.log('\n🎉 All spell mappings are valid!');
  } else {
    console.log(`\n⚠️  Found ${report.summary.total_issues} issues that need to be resolved.`);
  }
}

/**
 * Main execution function
 */
function main(): void {
  try {
    const report = generateAuditReport();
    writeAuditReport(report);
    printSummary(report);

    if (report.summary.total_issues > 0) {
      console.log('\n🔧 Next steps:');
      console.log('1. Run database resolution script to find missing UUIDs');
      console.log('2. Generate fix script to update spell-id-mapping.ts');
      console.log('3. Add comprehensive tests for mapping coverage');
      process.exit(1); // Exit with error code to indicate issues found
    } else {
      process.exit(0); // Exit successfully
    }
  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { generateAuditReport, loadCanonicalIds, loadCurrentMapping };