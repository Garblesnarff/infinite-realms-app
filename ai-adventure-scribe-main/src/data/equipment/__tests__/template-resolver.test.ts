import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveEquipmentByName } from '@/data/equipment/resolver';
import { extractStarterTemplateEquipment } from '@/data/equipment/template-audit';
import {
  transformStarterEquipment,
  transformStarterInventory,
} from '@/services/character/starter-character-seeding';

function sqlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sqlFiles(path) : entry.name.endsWith('.sql') ? [path] : [];
  });
}

describe('starter template equipment resolver audit', () => {
  it('resolves the seven curated custom-item aliases without broad journal matching', () => {
    const aliases = {
      'fine clothes': 'Clothes, fine',
      'quiver with 20 arrows': 'Arrows (20)',
      "ranger's pack": "Explorer's Pack",
      journal: 'Book',
      'pan pipes': 'Pan flute',
      'costume collection': 'Clothes, costume',
      'wine flask': 'Flask or tankard',
    };

    for (const [alias, expectedName] of Object.entries(aliases)) {
      expect(resolveEquipmentByName(alias)?.name).toBe(expectedName);
    }
    expect(resolveEquipmentByName('journal filled with stories')).toBeUndefined();
    for (const deliberatelyCustom of [
      'hospitality vestments',
      'prayer book',
      'Feywild party favors',
      'artifacts from various cultures',
      'lucky charms',
      'serving tray',
    ]) {
      expect(resolveEquipmentByName(deliberatelyCustom)).toBeUndefined();
    }
  });

  it('retains every premade template item and describes every custom item', () => {
    const migrationRoot = join(process.cwd(), 'supabase/migrations');
    const templateLists = sqlFiles(migrationRoot).flatMap((path) =>
      extractStarterTemplateEquipment(readFileSync(path, 'utf8')),
    );

    expect(templateLists.length).toBeGreaterThan(0);
    for (const equipment of templateLists) {
      const records = transformStarterEquipment(equipment);
      const customItems = transformStarterInventory(equipment);

      expect(records).not.toContainEqual(
        expect.objectContaining({ item_type: 'gear', item_name: '' }),
      );
      expect(customItems.every((item) => item.item_type === 'trinket' && item.weight === 0)).toBe(
        true,
      );
      expect(customItems.every((item) => item.description.trim().length > 0)).toBe(true);
      expect(
        equipment.every((item) => {
          const name = typeof item === 'string' ? item : item.name;
          return (
            Boolean(resolveEquipmentByName(name)) ||
            customItems.some((custom) => custom.name === name)
          );
        }),
      ).toBe(true);
    }
  });
});
