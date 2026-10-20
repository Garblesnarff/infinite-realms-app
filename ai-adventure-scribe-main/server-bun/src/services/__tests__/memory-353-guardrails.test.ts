/**
 * #353: planted facts forgotten/swapped by turn 10-60; items never reach Inventory.
 *
 * Stubbed fixtures encoding the failure modes from the 64-turn run (Hark GP-079..093):
 * - Cook name swapped ("Quillon Varr-Hesk" -> "Chef Ambrosius", "Bramble"): extraction
 *   hallucinated a name not in the exchange. The verbatim-quote guard drops it.
 * - Item engraving drift ("etched with a heron" -> wrong): same guard.
 * - Promise deadline drift ("by tomorrow dawn" -> "midnight bell"): same guard.
 * - Item never in Inventory: the DM is now told to populate the `items` JSON field
 *   (story_items_field in the response structure); the server write-through already exists.
 * - Place/quest detail lost over long horizon: entity-overlap re-ranking surfaces the
 *   memory that shares tokens with the question.
 *
 * No live DM/provider calls: the extraction model output and the recall rows are stubbed.
 * Fixture rows follow matchRow() in memory-service.ts (id, content, importance, createdAt).
 */
import { describe, expect, it, mock } from 'bun:test';

// parseExtractionText lives in memory-extraction-job.ts, whose module graph pulls
// in db/client (throws without DATABASE_URL). Mock the DB-touching modules the
// way memory-extraction-job.test.ts does, then import dynamically.
const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
mock.module('../../lib/logger.js', () => ({ logger: noopLogger, default: noopLogger }));
mock.module('../../lib/alerting.js', () => ({ alert: () => {} }));
mock.module('../llm-provider-service.js', () => ({
  LLMProviderService: { extract: async () => ({}) },
}));
mock.module('../ai-usage-service.js', () => ({
  AIUsageService: { recordProviderUsage: async () => {} },
}));
mock.module('../memory-service.js', () => ({
  MemoryService: { insert: async () => [] },
}));
// #846: memory-extraction-job.ts persists accepted jobs through the job store,
// whose module graph pulls in db/client (throws without DATABASE_URL). This
// test only exercises parseExtractionText, so the store is stubbed the same
// way the other service modules are.
mock.module('../memory-extraction-job-store.js', () => ({
  persistMemoryExtractionJob: async () => {
    throw new Error('not implemented in this test');
  },
  getMemoryExtractionJob: async () => null,
  claimMemoryExtractionJob: async () => null,
  listRunnableMemoryExtractionJobs: async () => [],
  completeMemoryExtractionJob: async () => false,
  markMemoryExtractionJobCharged: async () => false,
  releaseMemoryExtractionJob: async () => false,
  failMemoryExtractionJob: async () => false,
}));

const { parseExtractionText } = await import('../memory-extraction-job.js');
const { rerankByQueryOverlap } = await import('../memory-recall.js');

// The extraction prompt the client builds (MemoryService.extractMemories). The
// quote guard verifies against this text, which contains the CONVERSATION verbatim.
const EXCHANGE_PROMPT = `You are a memory extraction system for a D&D campaign.

CONTEXT:
- Session: session-1
- Location: The Academy of Arcane Gastronomy
- Active NPCs: Quillon Varr-Hesk
- Active Quests: Who poisoned the saffron

CONVERSATION:
Player: I ask the cook his name.
DM: The cook wipes his hands and says "I am Quillon Varr-Hesk, keeper of the east kitchen."
Player: I show him the brass thimble etched with a heron.
DM: He turns the brass thimble etched with a heron over in his palm and nods.
Player: I notice the cracked blue tile by the east door.
DM: The cracked blue tile by the east door catches your eye.
Player: I promise to deliver the sealed letter to the cellar steward by tomorrow dawn.
DM: "By tomorrow dawn," he repeats. "The cellar steward will have it."
`;

function jobInput() {
  return {
    sessionId: 'session-1',
    campaignId: 'campaign-1',
    kind: 'memories' as const,
    prompt: EXCHANGE_PROMPT,
    turn: 5,
  };
}

function extractionJson(memories: Array<Record<string, unknown>>): string {
  return JSON.stringify({ memories });
}

describe('#353 extraction verbatim-quote guard', () => {
  it('keeps a memory whose quote is verbatim from the exchange', () => {
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'npc',
          content: 'The cook is Quillon Varr-Hesk, keeper of the east kitchen.',
          importance: 8,
          quote: 'I am Quillon Varr-Hesk, keeper of the east kitchen',
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('Quillon Varr-Hesk');
  });

  it('drops a swapped cook name whose quote is not in the exchange', () => {
    // The 64-turn run extracted "Chef Ambrosius" / "Bramble" — names never spoken.
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'npc',
          content: 'The cook is Chef Ambrosius.',
          importance: 8,
          quote: 'I am Chef Ambrosius, keeper of the east kitchen',
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(0);
  });

  it('drops item engraving drift when the quote is hallucinated', () => {
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'item',
          content: 'A brass thimble etched with a spoon.',
          importance: 7,
          quote: 'the brass thimble etched with a spoon',
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps the true engraving with a verbatim quote', () => {
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'item',
          content: 'A brass thimble etched with a heron.',
          importance: 7,
          quote: 'the brass thimble etched with a heron',
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(1);
  });

  it('drops promise deadline drift when the quote is hallucinated', () => {
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'quest',
          content: 'Deliver the sealed letter to the cellar steward by midnight bell.',
          importance: 9,
          quote: 'by midnight bell',
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps the true deadline with a verbatim quote', () => {
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'quest',
          content: 'Deliver the sealed letter to the cellar steward by tomorrow dawn.',
          importance: 9,
          quote: 'By tomorrow dawn,',
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(1);
  });

  it('drops a memory with no quote (the guard cannot be bypassed by omitting quotes)', () => {
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'location',
          content: 'The east door has a cracked blue tile.',
          importance: 5,
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(0);
  });

  it('drops a memory whose quote is too short to ground anything', () => {
    // A 1-3 char "quote" is the same bypass as a missing quote: fail closed.
    const rows = parseExtractionText(
      extractionJson([
        {
          type: 'npc',
          content: 'The cook is Chef Ambrosius the Third.',
          importance: 8,
          quote: 'yes',
        },
      ]),
      jobInput(),
      'job-1',
    );
    expect(rows).toHaveLength(0);
  });
});

describe('#353 retrieval entity-overlap re-ranking', () => {
  const memories = [
    { id: 'm1', content: 'The tavern serves a hearty stew.' },
    { id: 'm2', content: 'The cook is Quillon Varr-Hesk, keeper of the east kitchen.' },
    { id: 'm3', content: 'A storm is coming from the north.' },
  ];

  it('surfaces the memory sharing a proper noun with the question', () => {
    const ranked = rerankByQueryOverlap(memories, 'What was the cook Quillon’s name?');
    expect(ranked[0].id).toBe('m2');
  });

  it('surfaces the memory sharing a quoted phrase with the question', () => {
    const ranked = rerankByQueryOverlap(memories, 'Who is "Quillon Varr-Hesk"?');
    expect(ranked[0].id).toBe('m2');
  });

  it('does not treat sentence-initial "What" as a token ("somewhat" must not match)', () => {
    const rows = [
      { id: 's1', content: 'The rumors are somewhat true.' },
      { id: 's2', content: 'The cook is Quillon Varr-Hesk, keeper of the east kitchen.' },
    ];
    // "What" is a stopword, so there are no tokens — order falls back to
    // importance + recency (uniform here), not a "somewhat" false positive.
    const ranked = rerankByQueryOverlap(rows, 'What did the cook say?');
    expect(ranked.map((m) => m.id)).toEqual(['s1', 's2']);
  });

  it('keeps the original order when nothing overlaps', () => {
    const ranked = rerankByQueryOverlap(memories, 'What is the weather?');
    expect(ranked.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps a high-importance recent memory ahead of stale ones when nothing overlaps', () => {
    const now = new Date('2026-10-11T12:00:00Z').getTime();
    const rows = [
      {
        id: 'stale',
        content: 'The cellar door is oak.',
        importance: 2,
        createdAt: '2026-08-01T00:00:00Z',
      },
      {
        id: 'fresh',
        content: 'The pantry was restocked at dawn.',
        importance: 9,
        createdAt: '2026-10-11T06:00:00Z',
      },
    ];
    // "provisions" overlaps neither memory, so the tie-break is importance +
    // recency: the fresh high-importance memory stays on top (within the limit)
    // instead of losing its merge-order slot to a stale row.
    const ranked = rerankByQueryOverlap(rows, 'What provisions remain?', now);
    expect(ranked[0].id).toBe('fresh');
  });

  it('applies importance + recency even when the query yields no tokens', () => {
    const now = new Date('2026-10-11T12:00:00Z').getTime();
    const rows = [
      {
        id: 'stale',
        content: 'The cellar door is oak.',
        importance: 2,
        createdAt: '2026-08-01T00:00:00Z',
      },
      {
        id: 'fresh',
        content: 'The pantry was restocked at dawn.',
        importance: 9,
        createdAt: '2026-10-11T06:00:00Z',
      },
    ];
    // No tokens ("What" is a stopword, rest too short) — the re-rank must still
    // order by importance + recency, not return merge order.
    const ranked = rerankByQueryOverlap(rows, 'What did they say?', now);
    expect(ranked[0].id).toBe('fresh');
  });

  it('keeps a sentence-initial proper noun as a token', () => {
    const ranked = rerankByQueryOverlap(memories, 'Quillon, tell me about the east kitchen');
    expect(ranked[0].id).toBe('m2');
  });
});
