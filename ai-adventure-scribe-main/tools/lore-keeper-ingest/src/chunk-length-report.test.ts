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
  assert.ok(flagged[0].lostLength > 0);
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

test('headed Subsystems mechanic keeps numbered items in its chunk (#1612)', () => {
  const bible = `## Mechanics

### **Subsystems**
Intro text before the sub-rule.

1.  **Alpha:**
Alpha body line.

2.  **Beta:**
Beta body line.
`;
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  const mechanics = chunks.filter((c) => c.chunkType === 'mechanic');
  assert.equal(mechanics.length, 1);
  assert.equal(mechanics[0].entityName, 'Subsystems');
  assert.ok(mechanics[0].content.includes('Alpha body line.'));
  assert.ok(mechanics[0].content.includes('Beta body line.'));

  const flagged = findShortMechanicChunks(bible, 'test-campaign');
  assert.equal(flagged.length, 0);
});

test('headed New Feats/Spells keeps nested-italics numbered items (#1612)', () => {
  const bible = `## Mechanics

### **New Feats/Spells**
Intro.

1.  **Spell: *Zone*** (Level 2). Makes a bubble.

2.  **Spell: *Trajectory Guide*** (Level 1). Shows the arc.
`;
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  const mechanics = chunks.filter((c) => c.chunkType === 'mechanic');
  assert.equal(mechanics.length, 1);
  assert.equal(mechanics[0].entityName, 'New Feats/Spells');
  assert.ok(mechanics[0].content.includes('Shows the arc.'));

  const flagged = findShortMechanicChunks(bible, 'test-campaign');
  assert.equal(flagged.length, 0);
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

test('duplicate mechanic names: two Tides headings -> duplicateNames entry', () => {
  const bible = `## Mechanics

### **Tides**
First body.

### **Tides**
Second body.
`;
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  const tidesChunks = chunks.filter((c) => c.chunkType === 'mechanic' && c.entityName === 'Tides');
  assert.equal(tidesChunks.length, 2);

  const result = scanBible(bible, 'test-campaign');
  assert.deepEqual(result.duplicateNames, [
    { entityName: 'Tides', count: 2, droppedChars: tidesChunks[1].content.length },
  ]);
});

test('duplicate mechanic names: distinct names -> empty', () => {
  const bible = `## Mechanics

### **Alpha**
Alpha body.

### **Beta**
Beta body.
`;
  const result = scanBible(bible, 'test-campaign');
  assert.deepEqual(result.duplicateNames, []);
});

test('lost #### text: plain heading body is lost', () => {
  const bible =
    '## Mechanics\n\n### **Alpha**\nAlpha body.\n#### Sub Rule\nSub body line.\n\n### **Beta**\nBeta body.';
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  assert.ok(!chunks.some((c) => c.content.includes('Sub body line.')));

  const result = scanBible(bible, 'test-campaign');
  assert.deepEqual(result.lostH4, [
    {
      parentName: 'Alpha',
      heading: 'Sub Rule',
      bodyChars: 'Sub body line.'.length,
      lostChars: 'Sub body line.'.length,
    },
  ]);
});

test('lost #### text: bold heading is not counted', () => {
  const bible = `## Mechanics

### **Alpha**
Intro.

#### **Sub**
Sub body.
`;
  const { chunks } = chunkCampaignFiles('test-campaign', { campaignBible: bible });
  assert.ok(chunks.some((c) => c.chunkType === 'mechanic' && c.entityName === 'Sub'));

  const result = scanBible(bible, 'test-campaign');
  assert.deepEqual(result.lostH4, []);
});
