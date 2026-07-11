#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveEquipmentByName } from '../src/data/equipment/resolver.ts';
import { extractStarterTemplateEquipment } from '../src/data/equipment/template-audit.ts';
import {
  transformStarterEquipment,
  transformStarterInventory,
} from '../src/services/character/starter-character-seeding.ts';

function sqlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sqlFiles(path) : entry.name.endsWith('.sql') ? [path] : [];
  });
}

const migrationRoot = join(process.cwd(), 'supabase/migrations');
const templateLists = sqlFiles(migrationRoot).flatMap((path) =>
  extractStarterTemplateEquipment(readFileSync(path, 'utf8')).map((equipment) => ({
    path,
    equipment,
  })),
);
const customWithoutDescription: string[] = [];
const unresolved: string[] = [];

for (const template of templateLists) {
  const records = transformStarterEquipment(template.equipment);
  for (const item of template.equipment) {
    const name = typeof item === 'string' ? item : item.name;
    if (!resolveEquipmentByName(name)) unresolved.push(name);
  }
  for (const item of transformStarterInventory(template.equipment)) {
    if (!item.description.trim()) customWithoutDescription.push(item.name);
  }
  if (records.some((record) => record.item_type === 'custom' && !record.description?.trim())) {
    customWithoutDescription.push(
      ...records
        .filter((record) => record.item_type === 'custom')
        .map((record) => record.item_name),
    );
  }
}

const uniqueUnresolved = [...new Set(unresolved)];
const uniqueUndescribed = [...new Set(customWithoutDescription)];
if (uniqueUndescribed.length > 0) {
  console.error('Unresolved starter items without descriptions:', uniqueUndescribed);
  process.exit(1);
}

console.log(
  `Audited ${templateLists.length} starter template equipment lists; ${uniqueUnresolved.length} campaign-custom item name(s) are described and retained.`,
);
