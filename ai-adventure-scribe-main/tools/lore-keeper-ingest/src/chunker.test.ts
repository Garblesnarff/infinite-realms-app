import assert from 'node:assert/strict';

import { test } from 'bun:test';

import { chunkCampaignFiles } from './chunker.js';

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
