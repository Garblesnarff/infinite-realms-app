import type {
  StarterTemplateEquipmentInput,
  StarterTemplateEquipment,
} from '@/services/character/starter-character-seeding';

function splitSqlList(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (inString && value[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (!inString && character === '(') depth += 1;
    else if (!inString && character === ')') depth -= 1;
    else if (!inString && depth === 0 && character === ',') {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries;
}

function findStatementEnd(sql: string, start: number): number {
  let inString = false;
  let depth = 0;
  for (let index = start; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (inString && sql[index + 1] === "'") index += 1;
      else inString = !inString;
    } else if (!inString && character === '(') depth += 1;
    else if (!inString && character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findSelectListEnd(sql: string, start: number): number {
  let inString = false;
  let depth = 0;
  for (let index = start; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (inString && sql[index + 1] === "'") index += 1;
      else inString = !inString;
    } else if (!inString && character === '(') depth += 1;
    else if (!inString && character === ')') depth -= 1;
    else if (!inString && depth === 0 && /^\sFROM\s/i.test(sql.slice(index, index + 6))) {
      return index;
    }
  }
  return -1;
}

function decodeSqlString(value: string): string | undefined {
  const match = value.trim().match(/^'(.*)'$/s);
  return match ? match[1].replace(/''/g, "'") : undefined;
}

function parseEquipmentValue(value: string): StarterTemplateEquipmentInput[] {
  const decoded = decodeSqlString(value);
  if (!decoded) return [];
  const parsed = JSON.parse(decoded) as Array<string | StarterTemplateEquipment>;
  return parsed.map((item) =>
    typeof item === 'string'
      ? item
      : ({ name: item.name, description: item.description } as StarterTemplateEquipment),
  );
}

/** Extract equipment arrays from starter template INSERT and UPDATE migrations. */
export function extractStarterTemplateEquipment(sql: string): StarterTemplateEquipmentInput[][] {
  const lists: StarterTemplateEquipmentInput[][] = [];
  const insertPattern =
    /INSERT\s+INTO\s+public\.starter_character_templates\s*\(([^)]*)\)\s*(?:VALUES\s*\(|SELECT\s)/gi;
  let insertMatch: RegExpExecArray | null;
  while ((insertMatch = insertPattern.exec(sql))) {
    const isSelect = /SELECT\s$/i.test(insertMatch[0]);
    const valuesStart = insertMatch.index + insertMatch[0].length - (isSelect ? 0 : 1);
    // INSERT ... SELECT lists its values up to the FROM that follows them.
    const valuesEnd = isSelect
      ? findSelectListEnd(sql, valuesStart)
      : findStatementEnd(sql, valuesStart);
    if (valuesEnd < 0) continue;
    const columns = splitSqlList(insertMatch[1]).map((column) => column.trim().toLowerCase());
    const values = splitSqlList(sql.slice(isSelect ? valuesStart : valuesStart + 1, valuesEnd));
    const equipmentIndex = columns.indexOf('equipment');
    if (equipmentIndex >= 0 && values[equipmentIndex]) {
      lists.push(parseEquipmentValue(values[equipmentIndex]));
    }
    insertPattern.lastIndex = valuesEnd + 1;
  }

  const updatePattern = /\bequipment\s*=\s*('(.*)'\s*)(?=,|\s+WHERE)/gi;
  let updateMatch: RegExpExecArray | null;
  while ((updateMatch = updatePattern.exec(sql))) {
    lists.push(parseEquipmentValue(updateMatch[1].trim()));
  }
  return lists;
}
