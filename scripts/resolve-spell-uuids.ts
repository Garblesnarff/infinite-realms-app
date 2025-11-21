#!/usr/bin/env tsx

/**
 * Spell UUID Resolution Script
 *
 * Resolves missing spell mappings by querying the Supabase database.
 * Part of the spell mapping audit workplan (WU-3, WU-4).
 *
 * Usage: tsx scripts/resolve-spell-uuids.ts
 *
 * Prerequisites:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_ROLE_KEY environment variable
 *
 * Outputs:
 * - artifacts/spell-db-resolution.json: Resolution results for each spell ID
 */

import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

interface ResolutionResult {
  kebabId: string;
  baseName: string;
  dbUuid: string | null;
  status: 'found' | 'not_found' | 'ambiguous' | 'error';
  error?: string;
  queryMethod: 'exact_index' | 'base_name_fallback' | 'error';
}

interface DatabaseSpell {
  id: string;
  index: string;
  name: string;
}

// Class suffixes that need to be stripped for base spell lookup
const CLASS_SUFFIXES = [
  '-bard', '-cleric', '-druid', '-paladin', '-ranger',
  '-sorcerer', '-warlock', '-wizard'
];

/**
 * Strip class suffix from spell ID to get base name
 */
function getBaseSpellName(kebabId: string): string {
  for (const suffix of CLASS_SUFFIXES) {
    if (kebabId.endsWith(suffix)) {
      return kebabId.slice(0, -suffix.length);
    }
  }
  return kebabId;
}

/**
 * Initialize Supabase client
 */
function createSupabaseClient(): any {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Query spells table for a specific index
 */
async function querySpellByIndex(supabase: any, index: string): Promise<DatabaseSpell | null> {
  try {
    const { data, error } = await supabase
      .from('spells')
      .select('id, index, name')
      .eq('index', index)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    return data;
  } catch (error) {
    console.error(`Error querying spell by index '${index}':`, error);
    return null;
  }
}

/**
 * Query spells table for a specific name (for fallback)
 */
async function querySpellByName(supabase: any, name: string): Promise<DatabaseSpell[]> {
  try {
    const { data, error } = await supabase
      .from('spells')
      .select('id, index, name')
      .ilike('name', `%${name}%`)
      .limit(5); // Limit to avoid too many results

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error(`Error querying spell by name '${name}':`, error);
    return [];
  }
}

/**
 * Resolve a single spell ID to its database UUID
 */
async function resolveSpellId(supabase: any, kebabId: string): Promise<ResolutionResult> {
  const baseName = getBaseSpellName(kebabId);

  // Try exact index match first
  const exactMatch = await querySpellByIndex(supabase, kebabId);
  if (exactMatch) {
    return {
      kebabId,
      baseName,
      dbUuid: exactMatch.id,
      status: 'found',
      queryMethod: 'exact_index'
    };
  }

  // If no exact match and this is a class-qualified ID, try base name
  if (baseName !== kebabId) {
    const baseMatch = await querySpellByIndex(supabase, baseName);
    if (baseMatch) {
      return {
        kebabId,
        baseName,
        dbUuid: baseMatch.id,
        status: 'found',
        queryMethod: 'base_name_fallback'
      };
    }
  }

  // Final fallback: search by name similarity
  const nameMatches = await querySpellByName(supabase, baseName);
  if (nameMatches.length === 1) {
    return {
      kebabId,
      baseName,
      dbUuid: nameMatches[0].id,
      status: 'found',
      queryMethod: 'base_name_fallback'
    };
  } else if (nameMatches.length > 1) {
    return {
      kebabId,
      baseName,
      dbUuid: null,
      status: 'ambiguous',
      error: `Multiple matches found: ${nameMatches.map(s => s.name).join(', ')}`,
      queryMethod: 'base_name_fallback'
    };
  }

  return {
    kebabId,
    baseName,
    dbUuid: null,
    status: 'not_found',
    error: `No spell found for '${kebabId}' (base: '${baseName}')`,
    queryMethod: 'base_name_fallback'
  };
}

/**
 * Load missing spell IDs from audit report
 */
function loadMissingSpellIds(): string[] {
  const auditPath = path.join(__dirname, '..', 'artifacts', 'spell-mapping-audit.json');

  if (!fs.existsSync(auditPath)) {
    throw new Error('Audit report not found. Please run audit script first.');
  }

  const auditReport = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  return auditReport.missing || [];
}

/**
 * Resolve all missing spell IDs
 */
async function resolveAllSpellIds(): Promise<ResolutionResult[]> {
  console.log('🔍 Resolving spell UUIDs from database...');

  const supabase = createSupabaseClient();
  const missingIds = loadMissingSpellIds();

  console.log(`📊 Resolving ${missingIds.length} missing spell IDs...`);

  const results: ResolutionResult[] = [];

  for (let i = 0; i < missingIds.length; i++) {
    const kebabId = missingIds[i];
    process.stdout.write(`  [${i + 1}/${missingIds.length}] Resolving '${kebabId}'...`);

    try {
      const result = await resolveSpellId(supabase, kebabId);
      results.push(result);

      if (result.status === 'found') {
        console.log(` ✅ ${result.dbUuid}`);
      } else if (result.status === 'ambiguous') {
        console.log(` ⚠️  Ambiguous`);
      } else {
        console.log(` ❌ Not found`);
      }
    } catch (error) {
      console.log(` ❌ Error: ${error}`);
      results.push({
        kebabId,
        baseName: getBaseSpellName(kebabId),
        dbUuid: null,
        status: 'error',
        error: String(error),
        queryMethod: 'error'
      });
    }
  }

  return results;
}

/**
 * Analyze resolution results
 */
function analyzeResults(results: ResolutionResult[]): void {
  const found = results.filter(r => r.status === 'found');
  const notFound = results.filter(r => r.status === 'not_found');
  const ambiguous = results.filter(r => r.status === 'ambiguous');
  const errors = results.filter(r => r.status === 'error');

  console.log('\n📊 RESOLUTION SUMMARY');
  console.log('===================');
  console.log(`✅ Successfully resolved: ${found.length}`);
  console.log(`❌ Not found: ${notFound.length}`);
  console.log(`⚠️  Ambiguous: ${ambiguous.length}`);
  console.log(`💥 Errors: ${errors.length}`);

  if (found.length > 0) {
    console.log('\n✅ FOUND SPELLS:');
    found.slice(0, 10).forEach(r => {
      console.log(`  ${r.kebabId} → ${r.dbUuid}`);
    });
    if (found.length > 10) {
      console.log(`  ... and ${found.length - 10} more`);
    }
  }

  if (notFound.length > 0) {
    console.log('\n❌ NOT FOUND:');
    notFound.slice(0, 10).forEach(r => {
      console.log(`  ${r.kebabId} (base: ${r.baseName})`);
    });
    if (notFound.length > 10) {
      console.log(`  ... and ${notFound.length - 10} more`);
    }
  }

  if (ambiguous.length > 0) {
    console.log('\n⚠️  AMBIGUOUS:');
    ambiguous.forEach(r => {
      console.log(`  ${r.kebabId}: ${r.error}`);
    });
  }
}

/**
 * Write resolution results to artifacts
 */
function writeResolutionResults(results: ResolutionResult[]): void {
  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const reportPath = path.join(artifactsDir, 'spell-db-resolution.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Resolution results written to: ${reportPath}`);
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    const results = await resolveAllSpellIds();
    analyzeResults(results);
    writeResolutionResults(results);

    const foundCount = results.filter(r => r.status === 'found').length;
    const totalCount = results.length;

    console.log(`\n🎯 Resolution complete: ${foundCount}/${totalCount} spells resolved`);

    if (foundCount === totalCount) {
      console.log('🎉 All missing spells have been resolved!');
      process.exit(0);
    } else {
      console.log(`⚠️  ${totalCount - foundCount} spells still need manual resolution`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Resolution failed:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  resolveSpellId,
  resolveAllSpellIds,
  getBaseSpellName,
  createSupabaseClient
};