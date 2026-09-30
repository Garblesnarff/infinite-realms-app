import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'bun:test';

import { chunkCampaignFiles } from './chunker.js';
import { parseAuthoredStatBlock } from '../../../server-bun/src/services/combat/authored-stat-block-parser.js';

test('extracts a Handouts section into RAG-searchable keyed chunks', () => {
  const { chunks } = chunkCampaignFiles('campaigns/eternal-feast', {
    campaignBible: `## Handouts

### Balthazar's Recipe Card
Key: \`balthazars-recipe\`
Title: Balthazar's Recipe Card
Giver: Balthazar
Body:
Fold the saffron into the dough at dawn.\n\nKeep the oven door shut.`,
  });
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], {
    campaignId: 'eternal-feast',
    chunkType: 'handout',
    entityName: "Balthazar's Recipe Card",
    content:
      "**Balthazar's Recipe Card**\n\nGiver: Balthazar\n\nFold the saffron into the dough at dawn.\n\nKeep the oven door shut.",
    summary: "Handout from Balthazar: Balthazar's Recipe Card",
    metadata: {
      key: 'balthazars-recipe',
      title: "Balthazar's Recipe Card",
      giver: 'Balthazar',
      body: 'Fold the saffron into the dough at dawn.\n\nKeep the oven door shut.',
    },
    sourceFile: 'campaign_bible.md',
    sourceSection: 'Handouts',
  });
});

test('normalizes the entity-name formatting quoted in #1790', () => {
  const { chunks } = chunkCampaignFiles('academy-of-arcane-gastronomy', {
    campaignBible: `## 2. FACTIONS
[TAG: FACTION_DATA]

### 1. The Academy of Arcane Gastronomy
The culinary school faction.

### 10. The First Palate's Chosen
The realm's chosen faction.

## 3. NPC ROSTER
[TAG: NPC_TIER_2]

### Minor NPCs (Table of 50)
| Name | Role | Location | Quirk (Low Probability) |
| **"Alchemist"** | Alchemist | The Academy Library | Keeps forbidden notes. |`,
  });

  assert.deepEqual(
    chunks.filter((chunk) => chunk.chunkType === 'faction').map((chunk) => chunk.entityName),
    ['The Academy of Arcane Gastronomy', "The First Palate's Chosen"],
  );
  assert.deepEqual(
    chunks.filter((chunk) => chunk.chunkType === 'npc_tier2').map((chunk) => chunk.entityName),
    ['Alchemist'],
  );
});

test('keeps every Loc 5 entry quoted in #1789', () => {
  const { chunks } = chunkCampaignFiles('academy-of-arcane-gastronomy', {
    campaignBible: `## 4. LOCATIONS
[TAG: LOCATIONS_MAIN]

### Zone 1: The Academy of Arcane Gastronomy
*   **Loc 4: The Academy Gardens:** A magical garden.
*   **Loc 5: The Academy Dining Hall:** A grand hall where students gather.

### Zone 2: The Spice Market
*   **Loc 4: The Bitter End Brigade's Barracks:** A grim building.
*   **Loc 5: The Umami Collective's Meditation Hall:** A serene space.

### Zone 3: The Monotony's Domain
*   **Loc 5: The Monotony's Altar:** A grim altar.

### Zone 4: The First Palate's Realm
*   **Loc 5: The Umami Ocean:** An ocean of pure savory taste.

## 5. QUEST ARCHITECTURE`,
  });

  assert.deepEqual(
    chunks
      .filter((chunk) => chunk.chunkType === 'location' && chunk.entityName?.includes('Loc 5'))
      .map((chunk) => chunk.entityName),
    [],
  );
  assert.deepEqual(
    chunks
      .filter((chunk) => chunk.chunkType === 'location')
      .map((chunk) => chunk.entityName)
      .filter((name) =>
        [
          'The Academy Dining Hall',
          "The Umami Collective's Meditation Hall",
          "The Monotony's Altar",
          'The Umami Ocean',
        ].includes(name || ''),
      ),
    [
      'The Academy Dining Hall',
      "The Umami Collective's Meditation Hall",
      "The Monotony's Altar",
      'The Umami Ocean',
    ],
  );
});

test('does not ingest bible section markers as entities', () => {
  const { chunks } = chunkCampaignFiles('academy-of-arcane-gastronomy', {
    campaignBible: `## 2. FACTIONS
[TAG: FACTION_DATA]

### 1. The Academy of Arcane Gastronomy
The culinary school faction.

## 4. LOCATIONS
[TAG: LOCATIONS_MAIN]

### Zone 1: The Academy of Arcane Gastronomy
*   **Concept:** A sprawling, magical culinary school.
*   **Loc 1: The Grand Kitchen:** A magical kitchen.

## 5. QUEST ARCHITECTURE`,
    worldBuildingSpec: `## History
${'The history section remains available in the full world-building chunk, but is not an entity row. '.repeat(3)}`,
  });

  const entityNames = chunks
    .map((chunk) => chunk.entityName)
    .filter((name): name is string => Boolean(name));

  assert.ok(!entityNames.includes('TAG: FACTION_DATA'));
  assert.ok(!entityNames.includes('Concept'));
  assert.ok(!entityNames.includes('History'));
});

test('does not double the colon in a session outline title', () => {
  const { chunks } = chunkCampaignFiles('abyssal-descent', {
    campaignBible: `## Campaign Roadmap

**Session 1: :**
The first session begins at the edge of the descent.
`,
  });

  const session = chunks.find((chunk) => chunk.chunkType === 'session_outline');
  assert.equal(session?.entityName, 'Session 1:');
  assert.notEqual(session?.entityName, 'Session 1: :');
});

function worldSpecWithRules(count: number): string {
  const rules = Array.from(
    { length: count },
    (_, i) => `* IF the party does thing ${i + 1} THEN consequence ${i + 1} follows.`,
  );
  return `## 6. Causality Chains & Dynamic World States\n\n${rules.join('\n')}\n\n## 7. Mechanics Reference\n\n* **Note:** unrelated.`;
}

test('a bible with 8 rules yields 8 causality rules with priorities inside 1-10 (#2360)', () => {
  const { rules } = chunkCampaignFiles('journey-to-the-inner-world', {
    worldBuildingSpec: worldSpecWithRules(8),
  });

  assert.equal(rules.length, 8);
  const priorities = rules.map((rule) => rule.priority);
  for (const priority of priorities) {
    assert.ok(
      Number.isInteger(priority) && priority >= 1 && priority <= 10,
      `priority ${priority}`,
    );
  }
  // Readers sort by priority descending, so document order must survive: first rule wins.
  assert.deepEqual(priorities, [10, 9, 8, 7, 6, 5, 4, 3]);
});

test('rules past the tenth tie at priority 1 instead of leaving the 1-10 range (#2360)', () => {
  const { rules } = chunkCampaignFiles('long-bible', { worldBuildingSpec: worldSpecWithRules(12) });

  assert.deepEqual(
    rules.map((rule) => rule.priority),
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1],
  );
});

// Fixtures are the "Minor NPCs" tables copied verbatim from Garblesnarff/infinite-realms-clean:
// the-eternal-feast (5 columns, stat tails from PR #19) and academy-of-arcane-gastronomy (4 columns).
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const npcTableChunks = (campaignId: string, table: string) =>
  chunkCampaignFiles(campaignId, { campaignBible: `## 3. NPC Roster\n\n${table}` }).chunks.filter(
    (chunk) => chunk.chunkType === 'npc_tier2',
  );

test('5-column Eternal Feast table keeps Race, Location and Quirk in their own fields', () => {
  const chunks = npcTableChunks('the-eternal-feast', fixture('eternal-feast-minor-npcs.md'));
  assert.equal(chunks.length, 50);

  const brie = chunks.find((chunk) => chunk.entityName === 'Brie');
  assert.equal(
    brie?.content,
    '**Brie** - Cheesemonger\n\nRace: Awakened Mouse\n\nLocation: Pantry\n\nQuirk: Fears cats, wields a needle sword. *HP:* 12, *AC:* 13, *Attack:* +3 to hit, 1d6 piercing (needle sword)',
  );
  assert.equal(brie?.summary, 'Brie: Cheesemonger');
  assert.deepEqual(brie?.metadata, { tier: 'tier2', fromTable: true });

  const pinch = chunks.find((chunk) => chunk.entityName === 'Pinch');
  assert.equal(
    pinch?.content,
    '**Pinch** - Line Cook\n\nRace: Crab-Person\n\nLocation: Kitchen\n\nQuirk: Only walks sideways, spills soup.',
  );
});

test('the stat tail in the last cell of every 14 authored Eternal Feast rows parses', () => {
  const chunks = npcTableChunks('the-eternal-feast', fixture('eternal-feast-minor-npcs.md'));
  const authored = [
    'Brie',
    'Thud',
    'Scratch',
    'Hiss',
    'Snort',
    'Frost',
    'Singe',
    'Zip',
    'Maw',
    'Brine',
    'Rot',
    'Shade',
    'Puff',
    'Mort',
  ];
  for (const name of authored) {
    const chunk = chunks.find((c) => c.entityName === name);
    assert.ok(chunk, `${name} chunk exists`);
    const parsed = parseAuthoredStatBlock(chunk.content);
    assert.deepEqual(parsed.unparsedLabels, [], name);
    assert.ok(parsed.parsedFields.includes('maxHp'), `${name} maxHp`);
    assert.ok(parsed.parsedFields.includes('armorClass'), `${name} armorClass`);
    assert.ok(parsed.parsedFields.includes('attackBonus'), `${name} attackBonus`);
  }
  const brie = parseAuthoredStatBlock(chunks.find((c) => c.entityName === 'Brie')!.content);
  assert.equal(brie.maxHp, 12);
  assert.equal(brie.armorClass, 13);
  assert.equal(brie.attackBonus, 3);
  assert.equal(brie.damageDice, '1d6');
  assert.equal(brie.damageType, 'piercing');
});

test('4-column Academy table rows keep the legacy content shape', () => {
  const chunks = npcTableChunks('academy-of-arcane-gastronomy', fixture('academy-minor-npcs.md'));
  assert.equal(chunks.length, 50);
  assert.equal(
    chunks.find((chunk) => chunk.entityName === 'Salty')?.content,
    '**Salty** - Student\n\nLocation: Academy Kitchen\n\nQuirk: Cries salt tears when he cuts onions.',
  );
  assert.ok(chunks.every((chunk) => !chunk.content.includes('Race:')));
});

// The reader used before #2402: four positional cells, nothing else.
const legacyRowContent = (row: string): string | undefined => {
  const match = row.match(/\|\s*\*\*(.+?)\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|/);
  if (!match) return undefined;
  const [, name, role, location, quirk] = match;
  return `**${name.replace(/^"|"$/g, '')}** - ${role.trim()}\n\nLocation: ${location.trim()}\n\nQuirk: ${quirk.trim()}`;
};

test('every 4-column Academy row reads exactly as the old four-cell reader did', () => {
  const table = fixture('academy-minor-npcs.md');
  const chunks = npcTableChunks('academy-of-arcane-gastronomy', table);
  const rows = table.split('\n').filter((line) => line.startsWith('| **'));
  assert.equal(rows.length, 50);
  rows.forEach((row, index) => {
    assert.equal(chunks[index].content, legacyRowContent(row), row);
  });
});

test('header cells decide the mapping: bold header, Race after Location, and a table without a header', () => {
  const chunks = npcTableChunks(
    'edge',
    [
      '| **Name** | **Role** | **Location** | **Race** | **Quirk** |',
      '| :--- | :--- | :--- | :--- | :--- |',
      '| **Old Tom** | Fisherman | Port Royal | Human | Dreams he is a fish. |',
      '',
      '| **Mina** | Baker | Oven Row | Hums off-key. |',
    ].join('\n'),
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.content),
    [
      '**Old Tom** - Fisherman\n\nRace: Human\n\nLocation: Port Royal\n\nQuirk: Dreams he is a fish.',
      '**Mina** - Baker\n\nLocation: Oven Row\n\nQuirk: Hums off-key.',
    ],
  );
});
