## Spell Mapping Audit Workplan (Find ALL spells missing DB UUIDs)

Goal: produce a complete, deterministic list of frontend spell IDs that lack a valid database UUID mapping (e.g., thorn-whip) and generate a ready-to-apply patch to fix them.

Scope/Truth Sources
- Frontend canonical spell IDs: ai-adventure-scribe-main/src/data/spells/** and classSpellMappings in src/data/spells/mappings.ts
- Mapping to DB UUIDs: ai-adventure-scribe-main/src/utils/spell-id-mapping.ts
- Server canonical spell catalog (for names/index): ai-adventure-scribe-main/server/src/data/spellData.ts
- Database table: Supabase table spells (columns: id [uuid], index [kebab], name)

Acceptance Criteria
- 100% of spell IDs referenced by classSpellMappings have a valid v4 UUID in spell-id-mapping.ts
- No invalid/placeholder UUIDs (non-hex, wrong shape, or duplicates)
- Mapping contains no keys that aren’t present in the canonical spell ID set
- An artifacts/report is produced listing: missing, invalid, duplicate, and stale mappings

Deliverables
1) scripts/audit-spell-mappings.ts (read-only audit, outputs JSON/markdown report)
2) scripts/fix-spell-mappings.ts (writes new/updated entries to spell-id-mapping.ts in sorted order)
3) tests to enforce coverage and UUID validity in CI

Work Units

WU-1: Enumerate canonical frontend spell IDs
- Read classSpellMappings from src/data/spells/mappings.ts (union of cantrips + spells for every class)
- Optionally cross-check against files under src/data/spells/** (ids in cantrips/* and level1/*)
- Output: artifacts/canonical-spell-id-set.json (sorted unique list of kebab-case IDs)

WU-2: Parse current mapping and validate UUIDs
- Load src/utils/spell-id-mapping.ts and collect keys/values
- Validate each value against UUID v4 regex: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
- Classify findings:
  - missing: in canonical set but not in mapping keys
  - invalid_uuid: present in mapping but value fails UUID validation
  - duplicates: same UUID used by multiple keys
  - stale: mapping keys not present in canonical set
- Output: artifacts/spell-mapping-audit.json (with all categories)

WU-3: Verify DB presence and fetch UUIDs
- For every missing or invalid entry, query Supabase spells table to get the UUID by index or name:
  - Preferred: select id,index,name from spells where index = $kebab
  - Fallback by name (careful with class-qualified ids like “bless-paladin” → base spell “bless”):
    - If id contains a class suffix, strip suffix to find the base spell row
- Produce resolution list: { kebabId, dbUuid, resolution: found|not_found|ambiguous }
- Output: artifacts/spell-db-resolution.json

WU-4: Resolve edge cases for class-qualified IDs
- Some IDs are class-qualified (e.g., detect-magic-cleric, animal-friendship-druid) but map to a single base SRD spell row
- Define deterministic mapping rule for base name extraction (strip known class suffixes: -bard, -cleric, -druid, -paladin, -ranger, etc.)
- Confirm rule on a sample set; fall back to manual overrides list if needed

WU-5: Generate patch for spell-id-mapping.ts
- Merge WU-3 results; for any not_found, create TODO placeholders and keep them out of committed mapping
- For found entries, inject mappings in alphabetical key order; preserve file style
- Recompute REVERSE_SPELL_ID_MAPPING programmatically (or leave as runtime construct as it is now)
- Output: patches/spell-id-mapping.patch (git-style) and an updated file in working tree when applied

WU-6: Add coverage + validity tests (CI guardrails)
- Test A (coverage): every ID in canonical set must exist as a key in SPELL_ID_MAPPING
- Test B (uuid validity): every mapping value must pass UUID v4 regex; assert no duplicates across values
- Test C (stale): no mapping keys exist outside the canonical set
- Wire tests to project’s test runner (Jest/Vitest) under src/__tests__/mapping/spell-mapping-coverage.test.ts

WU-7: One-time backfill for existing characters
- Optional but recommended: scan character_spells table for any UUIDs that don’t round-trip through REVERSE_SPELL_ID_MAPPING
- Produce a correction plan if any legacy/placeholder UUIDs exist

WU-8: Documentation of operational runbook (dev-only)
- Document how to run audit/fix locally (no production secrets)
- Note: Keep secrets in env; never commit keys

Implementation Sketch (minimal)

Script: scripts/audit-spell-mappings.ts
```ts
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(__dirname, '..');
const appRoot = path.join(ROOT, 'ai-adventure-scribe-main');

function loadCanonicalIds(): string[] {
  const mappingsTs = fs.readFileSync(path.join(appRoot, 'src/data/spells/mappings.ts'), 'utf8');
  // naive parse: extract quoted ids from cantrips/spells arrays
  const ids = Array.from(mappingsTs.matchAll(/'([a-z0-9-]+)'/g)).map(m => m[1]);
  return Array.from(new Set(ids)).sort();
}

function loadCurrentMapping(): Record<string, string> {
  const file = fs.readFileSync(path.join(appRoot, 'src/utils/spell-id-mapping.ts'), 'utf8');
  const obj: Record<string,string> = {};
  for (const m of file.matchAll(/'([a-z0-9-]+)'\s*:\s*'([0-9a-f-]+)'/gi)) {
    obj[m[1]] = m[2];
  }
  return obj;
}

const UUIDv4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const canonical = loadCanonicalIds();
const mapping = loadCurrentMapping();

const missing = canonical.filter(id => !(id in mapping));
const invalid = Object.entries(mapping)
  .filter(([, uuid]) => !UUIDv4.test(uuid))
  .map(([id]) => id);
const dupCheck = new Map<string,string[]>();
for (const [id, uuid] of Object.entries(mapping)) {
  const arr = dupCheck.get(uuid) || [];
  arr.push(id);
  dupCheck.set(uuid, arr);
}
const duplicates = Array.from(dupCheck.entries()).filter(([, ids]) => ids.length > 1)
  .map(([uuid, ids]) => ({ uuid, ids }));
const stale = Object.keys(mapping).filter(id => !canonical.includes(id));

const report = { counts: { canonical: canonical.length, mapping: Object.keys(mapping).length }, missing, invalid, duplicates, stale };
fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts', 'spell-mapping-audit.json'), JSON.stringify(report, null, 2));
console.log('Wrote artifacts/spell-mapping-audit.json');
```

DB Resolution (outline)
```ts
// Place in scripts/resolve-spell-uuids.ts (runs inside server dir to reuse supabaseService)
// 1) import supabaseService from server/src/lib/supabase.js
// 2) For each kebabId in missing|invalid, try exact index match in spells
//    select id,index,name from spells where index = $kebab
// 3) If class-suffixed, strip suffix and retry by index; if still not found, try by name
// 4) Output artifacts/spell-db-resolution.json with { kebabId, uuid, status }
```

Test Guardrails
```ts
// src/__tests__/mapping/spell-mapping-coverage.test.ts
import { classSpellMappings } from '@/data/spells/mappings';
import { SPELL_ID_MAPPING } from '@/utils/spell-id-mapping';

const UUIDv4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalIds() {
  const sets = Object.values(classSpellMappings).map(c => [...c.cantrips, ...c.spells]);
  return Array.from(new Set(sets.flat()));
}

test('all canonical spell IDs have a mapping', () => {
  const ids = canonicalIds();
  const missing = ids.filter(id => !(id in SPELL_ID_MAPPING));
  expect(missing).toEqual([]);
});

test('all mappings are valid UUID v4 and unique', () => {
  const values = Object.values(SPELL_ID_MAPPING);
  values.forEach(v => expect(UUIDv4.test(v)).toBe(true));
  expect(new Set(values).size).toBe(values.length);
});

test('no stale mapping keys', () => {
  const ids = new Set(canonicalIds());
  const stale = Object.keys(SPELL_ID_MAPPING).filter(k => !ids.has(k));
  expect(stale).toEqual([]);
});
```

Runbook (local)
- Audit: node scripts/audit-spell-mappings.ts → artifacts/spell-mapping-audit.json
- DB Resolve (inside server): ts-node scripts/resolve-spell-uuids.ts → artifacts/spell-db-resolution.json
- Fix: node scripts/fix-spell-mappings.ts → updates src/utils/spell-id-mapping.ts
- Verify: pnpm test (or project test runner) to run mapping tests

Notes
- thorn-whip is present in Druid cantrips; ensure its UUID is resolved from DB and added
- Replace any placeholder mapping values (e.g., obviously non-hex strings) with real UUIDs from DB
- Keep production secrets out of scripts; read from env; never commit keys
