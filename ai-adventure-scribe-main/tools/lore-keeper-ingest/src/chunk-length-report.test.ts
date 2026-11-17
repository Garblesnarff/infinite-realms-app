import assert from 'node:assert/strict';

import { test } from 'bun:test';

import { findShortMechanicChunks, scanBible } from './chunk-length-report.js';
import { chunkCampaignFiles } from './chunker.js';

test('two whole ### mechanics produce no flagged chunks', () => {
  const bible = `## Mechanics

### **Mechanic One**
Body text here that is kept whole.

### **Mechanic Two**
Other body text kept whole.
`;
  const flagged = findShortMechanicChunks(bible, 'test-campaign');
  assert.equal(flagged.length, 0);
});

test('a #### subsection is cut by the chunker and flagged by the report', () => {
  const bible = `## Mechanics

### **Mechanic**
Intro text before the sub-rule.

#### Sub-rule
Substantial text after the sub-rule that the chunker drops because it stops at the three-hash prefix.
`;
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  const mechanic = chunks.find((c) => c.chunkType === 'mechanic');
  assert.ok(mechanic);
  assert.ok(!mechanic.content.includes('Substantial text after'));

  const flagged = findShortMechanicChunks(bible, 'test-campaign');
  assert.equal(flagged.length, 1);
  assert.ok(flagged[0].chunkLength < flagged[0].sourceLength);
});

test('threshold boundary: exactly 70% is not flagged, below is', () => {
  const exact = `## Mechanics

### **Boundary Mechanic**
${'A'.repeat(42)}

#### Sub-rule
${'B'.repeat(2)}
`;
  const below = `## Mechanics

### **Boundary Mechanic**
${'A'.repeat(42)}

#### Sub-rule
${'B'.repeat(10)}
`;
  assert.equal(findShortMechanicChunks(exact, 'test-campaign', 0.3).length, 0);
  assert.equal(findShortMechanicChunks(below, 'test-campaign', 0.3).length, 1);
});

test('split Subsystems chunk has lostLength 0', () => {
  const bible = `## Mechanics

### **Subsystems**
Intro text before the sub-rule.

1.  **Alpha:**
Alpha body line.

2.  **Beta:**
Beta body line.
`;
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  assert.ok(chunks.some((c) => c.chunkType === 'mechanic' && c.entityName === 'Alpha:'));
  assert.ok(chunks.some((c) => c.chunkType === 'mechanic' && c.entityName === 'Beta:'));

  const flagged = findShortMechanicChunks(bible, 'test-campaign');
  const subsystems = flagged.find((c) => c.entityName === 'Subsystems');
  assert.ok(subsystems);
  assert.equal(subsystems.lostLength, 0);
});

test('nested italics numbered item leaves text in no chunk', () => {
  const bible = `## Mechanics

### **New Feats/Spells**
Intro.

1.  **Spell: *Zone*** (Level 2). Makes a bubble.

2.  **Spell: *Trajectory Guide*** (Level 1). Shows the arc.
`;
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  assert.ok(chunks.some((c) => c.chunkType === 'mechanic' && c.entityName === 'New Feats/Spells'));
  assert.ok(!chunks.some((c) => c.entityName?.includes('Trajectory')));

  const flagged = findShortMechanicChunks(bible, 'test-campaign');
  const item = flagged.find((c) => c.entityName === 'New Feats/Spells');
  assert.ok(item);
  assert.ok(item.lostLength > 0);
});

test('a `### 1. **Name**` heading is matched to its chunk, not counted unmatched', () => {
  const bible = `## Unique Mechanics

### 1. **The Daily Grind**
Every session starts with a shift.

### 2. **Redemption Tokens**
Kind acts earn a token.
`;
  const result = scanBible(bible, 'test-campaign');
  assert.equal(result.mechanicChunks, 2);
  assert.deepEqual(result.unmatchedNames, []);
  assert.equal(result.flagged.length, 0);
});
