/* eslint-disable max-lines -- one file holds the script, the provider stub, the turn driver and the scoring; splitting it would scatter the replay across the suite boundary */
/* eslint-disable no-console -- the probe measurement table printed at the end is this suite's reported output, not debug logging */
/**
 * #353: planted-fact recall over a 30-turn session, measured end to end.
 *
 * Hark's GP-079..093 run (build 0.35.1) scored 4/15: facts planted in turns
 * 1-8 (a cook's name, an item, a promise with a deadline, a place detail, an
 * open quest) were forgotten or swapped at the ~10-14, ~30-34 and ~60-64 turn
 * checkpoints. This suite replays the same shape at 30 turns through the REAL
 * server machinery and measures where each fact dies:
 *
 *   real routes: POST /v1/sessions/:id/messages, POST /v1/llm/generate,
 *   POST /v1/memory-extraction/jobs (the server job extracts, quote-guards,
 *   inserts and embeds), and POST /v1/memories/recall (the exact call the
 *   client makes every turn, limit 8).
 *
 *   Prompt inclusion is measured at the recall boundary: the client renders
 *   every recalled row's content verbatim into the prompt's <story_memories>
 *   section (GameContextPrompts.buildGameContextSection — no truncation, no
 *   further filtering; the renderer's own behavior is covered client-side by
 *   src/services/__tests__/ai-service*.test.ts), so a fact reaches the prompt
 *   iff its row is in the recall result. This suite deliberately does not
 *   import the client renderer: its @/-aliased import chain sits outside the
 *   server typecheck program (scripts/server-typecheck-gate.sh).
 *
 * What is stubbed, and why: there is no live LLM provider in CI, so the two
 * provider calls are answered at the fetch seam (the same seam
 * full-session.real-db.test.ts uses). The DM replies are scripted (they plant
 * the facts on turns 1-8 and stay neutral on probe turns), and the extractor
 * replies are scripted as a COMPETENT extractor: verbatim quotes, grounded
 * names, plausible importance. The embedding model is a deterministic
 * lexical (bag-of-words hashing) embedder computed at the fetch seam, so the
 * real embedding service, the real match_memories SQL and the real recall
 * merge all execute — but its cosine scores are lexical, not Gemini's: it
 * understates paraphrase similarity, so absolute similarity margins are
 * stub-measured and reported as such. The structural findings (candidate
 * caps, the importance merge, prompt inclusion) are embedder-independent.
 *
 * Scoring per fact per probe set: PASS = every required substring of the
 * fact appears in the recalled rows (the <story_memories> content); PARTIAL = a
 * same-topic row is present but a required substring is missing (or a wrong
 * same-topic row, e.g. the decoy cook, is present without the true row);
 * FAIL = no same-topic row reaches the prompt. Diagnostics per fact/probe
 * (extracted? embedded? similarity, importance rank, carrier row) are
 * logged as a table so a failure says WHERE the fact died.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 * Without one the suite skips, per the harness contract.
 */
process.env.PORT ??= '8894';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';
// The embedding service refuses to run without a key; the fetch stub answers
// the actual Google calls, so a dummy key is all it needs.
process.env.GOOGLE_API_KEY ??= 'test-google-key';
process.env.RATE_LIMIT_LLM_IP_FREE = '10000';
process.env.RATE_LIMIT_LLM_IP_PRO = '10000';
process.env.RATE_LIMIT_LLM_IP_ENTERPRISE = '10000';
process.env.RATE_LIMIT_LLM_USER_FREE = '10000';
process.env.RATE_LIMIT_LLM_USER_PRO = '10000';
process.env.RATE_LIMIT_LLM_USER_ENTERPRISE = '10000';

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, importWithRealDb, realDb, testId } from './fixtures/real-db.js';

const USER_ID = testId('m353-user');
const USER = { userId: USER_ID, email: 'memory-353@example.test', plan: 'tester' };

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    return token === USER_ID ? { user: USER, error: null } : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { llmRoutes } = await importWithRealDb(() => import('../../routes/v1/llm.js'));
const { sessionMessageRoutes } = await importWithRealDb(() => import('../../routes/v1/session-messages.js'));
const { memoryRoutes } = await importWithRealDb(() => import('../../routes/v1/memories.js'));
const { memoryExtractionRoutes } = await importWithRealDb(() => import('../../routes/v1/memory-extraction.js'));
const schema = await importWithRealDb(() => import('../../../../db/schema/index.js'));
const { campaigns, characters, characterStats, gameSessions, memories, memoryExtractionJobs } = schema;

// ---------------------------------------------------------------------------
// Deterministic lexical embedder (the disclosed stub for gemini-embedding-001)
// ---------------------------------------------------------------------------

const EMBED_DIM = 768;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Bag-of-words hashing embedder: shared tokens -> positive cosine, nothing else. */
export function lexicalEmbed(text: string): number[] {
  const vector = new Array<number>(EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const hash = fnv1a(token);
    vector[hash % EMBED_DIM] += (hash & 0x10000) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// The script: 5 planted facts (turns 1-6), a decoy name (turn 2, matching
// Hark's note that a second cook was named at turn 1 and may have seeded the
// swap), filler turns between, in-character probes at turns 10-14 and 25-29.
// ---------------------------------------------------------------------------

type FactId = 'name' | 'item' | 'promise' | 'place' | 'quest';

const FACTS: Record<FactId, { label: string; required: string[]; plantTurn: number }> = {
  name: { label: "cook's name", required: ['Quillon Varr-Hesk'], plantTurn: 1 },
  item: { label: 'item (brass thimble)', required: ['brass thimble', 'heron'], plantTurn: 3 },
  promise: { label: 'promise + deadline', required: ['sealed letter', 'cellar steward', 'dawn'], plantTurn: 4 },
  place: { label: 'place detail (tile)', required: ['cracked blue tile', 'east door'], plantTurn: 5 },
  quest: { label: 'open quest (saffron)', required: ['poisoned', 'saffron'], plantTurn: 6 },
};

interface ExtractSpec {
  type: string;
  content: string;
  importance: number;
  quote: string;
}

interface TurnSpec {
  player: string;
  dm: string;
  extract: ExtractSpec[];
  probe?: FactId;
}

const PLANTS: TurnSpec[] = [
  {
    player: 'I step into the east kitchen and greet the cook.',
    dm: "The cook wipes his hands and bows. 'Quillon Varr-Hesk, keeper of the east kitchen — mind the steam, apprentice.'",
    extract: [
      {
        type: 'npc',
        content: 'The cook of the east kitchen is Quillon Varr-Hesk.',
        importance: 8,
        quote: 'Quillon Varr-Hesk, keeper of the east kitchen',
      },
    ],
  },
  {
    player: 'I ask what news came from the rival house.',
    dm: "A scullion shrugs. 'Word is the rival house sends its chef Ambrosius to judge the Founding Feast.'",
    extract: [
      {
        type: 'npc',
        content: 'A rival house chef named Ambrosius will judge the Founding Feast.',
        importance: 5,
        quote: 'chef Ambrosius to judge the Founding Feast',
      },
    ],
  },
  {
    player: 'Does Quillon have anything for me before I start?',
    dm: "Quillon presses a brass thimble etched with a heron into your palm. 'For luck in the kitchens, apprentice.'",
    extract: [
      {
        type: 'item',
        content: 'Quillon gave the apprentice a brass thimble etched with a heron.',
        importance: 7,
        quote: 'brass thimble etched with a heron',
      },
    ],
  },
  {
    player: 'Quillon, is there anything you need done tonight?',
    dm: "Quillon lowers his voice: 'Take this sealed letter to the cellar steward, and see it done by tomorrow dawn.'",
    extract: [
      {
        type: 'quest',
        content: 'The apprentice promised to deliver a sealed letter to the cellar steward by tomorrow dawn.',
        importance: 9,
        quote: 'sealed letter to the cellar steward',
      },
    ],
  },
  {
    player: 'I look at the floor by the east door — one tile stands out.',
    dm: "A scullion nods. 'Aye — a cracked blue tile by the east door; mind your step on it.'",
    extract: [
      {
        type: 'location',
        content: 'There is a cracked blue tile by the east door of the kitchen.',
        importance: 5,
        quote: 'cracked blue tile by the east door',
      },
    ],
  },
  {
    player: 'I ask Quillon why the spice stores are locked.',
    dm: "Quillon shows you the stores, grim-faced. 'Someone has poisoned the saffron. Find who did it, apprentice, before the Feast.'",
    extract: [
      {
        type: 'quest',
        content: 'Someone poisoned the saffron stores; Quillon asked the apprentice to find who did it.',
        importance: 8,
        quote: 'Someone has poisoned the saffron',
      },
    ],
  },
];

const CHORES = [
  'peel the turnips',
  'scrub the copper pots',
  'stoke the hearth fire',
  'chop the leeks',
  'plump the flour sacks',
  'polish the serving spoons',
  'sweep the pantry floor',
  'turn the roasting joints',
  'wash the herb bundles',
  'stack the firewood',
  'rinse the milk pans',
  'sort the dried beans',
  'wipe the long tables',
  'carry water from the well',
];
const FILLER_IMPORTANCE = [4, 5, 6, 5, 4, 6, 3, 5, 6, 4, 5, 3, 6, 5];

function fillerTurn(index: number): TurnSpec {
  const chore = CHORES[index % CHORES.length];
  const spec: TurnSpec = {
    player: `I help in the kitchen: time to ${chore}.`,
    dm: `The kitchen hands nod while you ${chore}. Lantern light gleams on the shelves as the work goes on.`,
    extract: [
      {
        type: 'event',
        content: `The apprentice helped in the kitchen: ${chore}.`,
        importance: FILLER_IMPORTANCE[index % FILLER_IMPORTANCE.length],
        quote: `you ${chore}`,
      },
      {
        type: 'atmosphere',
        content: `During chore duty (${chore}), the kitchen stayed busy and warm.`,
        importance: 3,
        quote: 'Lantern light gleams on the shelves',
      },
    ],
  };
  // Turn 8 (filler index 2): one more mid-importance named fact, for realistic
  // competition in the store — a second named staffer who is NOT a fact probe.
  if (index === 2) {
    spec.dm += ' Sous-chef Petra calls out the sauce orders from her station.';
    spec.extract.push({
      type: 'npc',
      content: 'The sous-chef Petra runs the sauce station in the east kitchen.',
      importance: 7,
      quote: 'Sous-chef Petra calls out the sauce orders',
    });
  }
  return spec;
}

const PROBE_DM: Record<FactId, { dm: string; quote: string }> = {
  name: { dm: 'The kitchen hands glance up from their benches, steam curling between you, but the bustle swallows the moment.', quote: 'steam curling between you' },
  item: { dm: 'You pat the pocket of your apron; the kitchen noise rolls on around you.', quote: 'the kitchen noise rolls on' },
  promise: { dm: 'A bell clangs for the dinner service and the staff scatter to their stations.', quote: 'scatter to their stations' },
  place: { dm: 'You glance toward the doorway as a draft pushes through the kitchen.', quote: 'a draft pushes through the kitchen' },
  quest: { dm: "The storekeeper's ledger lies open on the counter, its pages fluttering.", quote: "the storekeeper's ledger lies open" },
};

const PROBES: Array<{ fact: FactId; player: string }> = [
  { fact: 'name', player: "Before we go on — remind me, what is the cook's name?" },
  { fact: 'item', player: 'That thimble the cook gave me — what was etched on it, exactly?' },
  { fact: 'promise', player: 'What errand did I swear to finish, and by when?' },
  { fact: 'place', player: 'What was strange about the floor by the east door?' },
  { fact: 'quest', player: 'Why are we watching the saffron stores — what are we trying to find out?' },
];

function probeTurn(probe: (typeof PROBES)[number]): TurnSpec {
  const { dm, quote } = PROBE_DM[probe.fact];
  return {
    player: probe.player,
    dm,
    probe: probe.fact,
    extract: [
      {
        type: 'event',
        content: 'The apprentice paused to ask the kitchen staff a question.',
        importance: 2,
        quote,
      },
    ],
  };
}

/** Turns 1-30 in order. Probes: set A at 10-14, set B at 25-29. */
function buildScript(): TurnSpec[] {
  const turns: TurnSpec[] = [...PLANTS];
  let filler = 0;
  const pushFiller = () => turns.push(fillerTurn(filler++));
  pushFiller(); // 7
  pushFiller(); // 8 (Petra)
  pushFiller(); // 9
  for (const probe of PROBES) turns.push(probeTurn(probe)); // 10-14, set A
  for (let i = 0; i < 5; i += 1) pushFiller(); // 15-19
  pushFiller(); // 20 (summary job fires after this turn)
  for (let i = 0; i < 4; i += 1) pushFiller(); // 21-24
  for (const probe of PROBES) turns.push(probeTurn(probe)); // 25-29, set B
  pushFiller(); // 30
  return turns;
}

const TURNS = buildScript();

const SUMMARY_TEXT =
  'The apprentice joined the east kitchen under its cook, Quillon Varr-Hesk, and was given a keepsake and an errand: a sealed letter to be delivered to the cellar steward by dawn. The apprentice also began looking into the spoiled saffron stores and settled into the daily chores of the kitchen as the Founding Feast approaches.';

// ---------------------------------------------------------------------------
// The extraction prompt, built with the client's exact template (fixture
// follows the real producer: src/agents/services/memory/MemoryService.ts
// extractMemories; the same fixture approach as memory-353-guardrails).
// ---------------------------------------------------------------------------

function extractionPrompt(sessionId: string, player: string, dm: string): string {
  return `You are a memory extraction system for a D&D campaign. Extract important memories from this conversation exchange.

CONTEXT:
- Session: ${sessionId}
- Location: East Kitchen
- Active NPCs: Quillon Varr-Hesk
- Active Quests: None

CONVERSATION:
Player: ${player}
DM: ${dm}

Extract 1-4 key memories in this JSON format:
{
  "memories": [
    {
      "session_id": "${sessionId}",
      "type": "npc|location|quest|item|event|story_beat|character_moment|world_detail|dialogue_gem|atmosphere|plot_point|foreshadowing",
      "category": "brief category",
      "content": "concise memory description",
      "importance": 1-10,
      "emotional_tone": "peaceful|mysterious|foreboding|intense|triumphant|humorous|melancholy|neutral",
      "quote": "exact phrase from the CONVERSATION above that contains the names/dates in this memory",
      "metadata": {}
    }
  ]
}

GROUNDING RULE (#353): Every proper name (NPC, place, item), date, and deadline in a memory's
"content" MUST be copied verbatim from the CONVERSATION above. Put the exact supporting phrase
in the "quote" field. NEVER invent, shorten, or "correct" a name — a wrong name is worse than no
memory. If you are unsure of the exact wording, do not create the memory.`;
}

function dmEnvelope(narration: string): string {
  return JSON.stringify({
    narration_segments: [],
    roll_requests: [],
    options: [],
    combat_actions: [],
    combatants: [],
    map_actions: [],
    handout_actions: [],
    scene_spec: null,
    text: narration,
    combat_transition: 'none',
  });
}

function openRouterBody(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// The provider fetch stub. OpenRouter chat calls are classified by content:
// the extraction template -> the scripted extraction for that exchange; the
// summary template -> the scripted summary; anything else is the DM turn,
// answered with the scripted reply for the turn whose player text the
// assembled prompt carries. Google calls are embeddings, answered with the
// lexical vector of the request text. Anything else throws.
// ---------------------------------------------------------------------------

let dmAnsweredFor = -1;

function installFetchStub(): void {
  const original = globalThis.fetch;
  void original;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    if (url.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(rawBody) as { content?: { parts?: Array<{ text?: string }> } };
      const text = body.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
      return new Response(JSON.stringify({ embedding: { values: lexicalEmbed(text) } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('openrouter.ai')) {
      const body = JSON.parse(rawBody) as { messages?: Array<{ content?: string }> };
      const content = body.messages?.map((m) => m.content ?? '').join('\n') ?? '';
      if (content.includes('Summarize this D&D campaign chronologically.')) {
        return openRouterBody(SUMMARY_TEXT);
      }
      if (content.includes('You are a memory extraction system')) {
        const turn = TURNS.find((t) => content.includes(`Player: ${t.player}`));
        if (!turn) throw new Error('[m353] extraction prompt matched no scripted turn');
        return openRouterBody(
          JSON.stringify({
            memories: turn.extract.map((spec) => ({
              type: spec.type,
              category: 'replay',
              content: spec.content,
              importance: spec.importance,
              emotional_tone: 'neutral',
              quote: spec.quote,
              metadata: {},
            })),
          }),
        );
      }
      // DM generate: the assembled prompt carries the player input verbatim.
      const turnIndex = TURNS.findIndex((t, i) => i > dmAnsweredFor && content.includes(t.player));
      if (turnIndex === -1) throw new Error('[m353] DM generate matched no scripted turn');
      dmAnsweredFor = turnIndex;
      return openRouterBody(dmEnvelope(TURNS[turnIndex].dm));
    }
    throw new Error(`[m353] unexpected network URL: ${url}`);
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// App + turn driver
// ---------------------------------------------------------------------------

interface ProbeMeasurement {
  set: 'A' | 'B';
  turn: number;
  fact: FactId;
  score: 'PASS' | 'PARTIAL' | 'FAIL';
  carrier: string;
  extracted: boolean;
  embedded: boolean;
  similarity: number | null;
  importanceRank: number | null;
  inRecallSet: boolean;
  storeSize: number;
}

describeWithDb('memory replay: planted-fact recall over 30 turns (#353)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  let campaignId = '';
  let characterId = '';
  let sessionId = '';
  let originalFetch: typeof fetch | undefined;
  const measurements: ProbeMeasurement[] = [];

  const app = hasRealDb
    ? createRequestPipelineApp().use(llmRoutes).use(sessionMessageRoutes).use(memoryRoutes).use(memoryExtractionRoutes)
    : null;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> | unknown[] }> => {
    if (!app) throw new Error('no app');
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${USER_ID}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    let json: Record<string, unknown> | unknown[];
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, json };
  };

  async function waitForJob(jobId: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const [job] = await database
        .select({ status: memoryExtractionJobs.status, error: memoryExtractionJobs.error })
        .from(memoryExtractionJobs)
        .where(eq(memoryExtractionJobs.id, jobId));
      if (job?.status === 'completed') return;
      if (job?.status === 'failed') throw new Error(`[m353] extraction job ${jobId} failed: ${job.error ?? ''}`);
      if (Date.now() > deadline) throw new Error(`[m353] extraction job ${jobId} never completed (status ${job?.status})`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function waitForEmbeddings(): Promise<void> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const rows = await database
        .select({ id: memories.id })
        .from(memories)
        .where(sql`${memories.sessionId} = ${sessionId} AND ${memories.embedding} IS NULL`);
      if (rows.length === 0) return;
      if (Date.now() > deadline) throw new Error(`[m353] ${rows.length} memories never got embeddings`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function submitExtraction(kind: 'memories' | 'summary', prompt: string, turn: number): Promise<void> {
    const res = await call('POST', '/v1/memory-extraction/jobs', {
      session_id: sessionId,
      character_id: characterId,
      kind,
      prompt,
      max_tokens: kind === 'summary' ? 1200 : 1000,
      turn,
    });
    expect(res.status).toBe(202);
    const jobId = (res.json as Record<string, unknown>).jobId as string;
    expect(typeof jobId).toBe('string');
    await waitForJob(jobId);
    await waitForEmbeddings();
  }

  /** The client's per-turn recall, through the real route (limit 8, as chatWithDM sends). */
  async function recallRows(query: string): Promise<Array<Record<string, unknown>>> {
    const res = await call('POST', '/v1/memories/recall', { session_id: sessionId, query, limit: 8 });
    expect(res.status).toBe(200);
    return res.json as Array<Record<string, unknown>>;
  }

  async function diagnose(fact: FactId, query: string): Promise<Omit<ProbeMeasurement, 'set' | 'turn' | 'fact' | 'score' | 'carrier' | 'inRecallSet' | 'storeSize'>> {
    const required = FACTS[fact].required;
    const sessionRows = await database
      .select({
        id: memories.id,
        content: memories.content,
        importance: memories.importance,
        memoryType: memories.memoryType,
        hasEmbedding: sql<boolean>`${memories.embedding} IS NOT NULL`,
      })
      .from(memories)
      .where(eq(memories.sessionId, sessionId));
    const factRow = sessionRows.find((row) => required.every((s) => row.content.includes(s)));
    const queryVector = lexicalEmbed(query);
    let similarity: number | null = null;
    if (factRow) {
      const simRows = await database.execute(
        sql`SELECT 1 - (embedding <=> ${JSON.stringify(queryVector)}::vector) AS sim FROM memories WHERE id = ${factRow.id}`,
      );
      const first = (simRows as unknown as Array<{ sim: number }>)[0];
      similarity = first ? Number(first.sim) : null;
    }
    const importanceRank = factRow
      ? sessionRows.filter(
          (row) =>
            (row.importance ?? 0) > (factRow.importance ?? 0) ||
            ((row.importance ?? 0) === (factRow.importance ?? 0) && row.id !== factRow.id && String(row.id) > String(factRow.id)),
        ).length + 1
      : null;
    return {
      extracted: Boolean(factRow),
      embedded: Boolean(factRow?.hasEmbedding),
      similarity,
      importanceRank,
    };
  }

  async function playTurn(turnIndex: number): Promise<void> {
    const turn = TURNS[turnIndex];
    const turnNo = turnIndex + 1;

    const playerRes = await call('POST', `/v1/sessions/${sessionId}/messages`, {
      speaker_type: 'player',
      message: turn.player,
    });
    expect(playerRes.status).toBe(200);

    // Recall happens before the DM reply, as in chatWithDM. On probe turns
    // this recall is the measurement.
    const rows = await recallRows(turn.player);
    const memoriesSection = rows.map((row) => (typeof row.content === 'string' ? row.content : '')).join('\n');

    const dmRes = await call('POST', '/v1/llm/generate', {
      prompt: `${memoriesSection}\n\n${turn.player}`,
      sessionId,
      player_input: turn.player,
      dmReply: { messageId: crypto.randomUUID(), inCombat: false, narrationGated: false },
      combatEntry: {
        sessionId,
        player: { characterId, name: 'Replay Apprentice', initiativeModifier: 2 },
      },
    });
    expect(dmRes.status).toBe(200);
    const dmText = (dmRes.json as Record<string, unknown>).text as string;
    const envelope = JSON.parse(dmText) as { text: string };
    expect(envelope.text).toBe(turn.dm);

    const dmMsgRes = await call('POST', `/v1/sessions/${sessionId}/messages`, {
      speaker_type: 'dm',
      message: turn.dm,
    });
    expect(dmMsgRes.status).toBe(200);

    if (turn.probe) {
      const fact = FACTS[turn.probe];
      // The <story_memories> section is exactly the recalled rows' contents,
      // verbatim (see the header note on the recall-boundary measurement).
      const section = memoriesSection;
      const present = fact.required.filter((s) => section.includes(s));
      const sessionRows = await database
        .select({ id: memories.id, content: memories.content, memoryType: memories.memoryType })
        .from(memories)
        .where(eq(memories.sessionId, sessionId));
      const factRow = sessionRows.find((row) => fact.required.every((s) => row.content.includes(s)));
      const inSet = rows.some((row) => row.id === factRow?.id);
      const carriers: string[] = [];
      if (inSet) carriers.push('fact-row');
      if (rows.some((row) => typeof row.content === 'string' && row.content.includes(fact.required[0]) && row.id !== factRow?.id))
        carriers.push('other-row');
      if (
        !inSet &&
        rows.some((row) => {
          const full = sessionRows.find((r) => r.id === row.id);
          return full?.memoryType === 'campaign_summary' && fact.required.some((s) => full.content.includes(s));
        })
      ) {
        carriers.push('summary');
      }
      const diag = await diagnose(turn.probe, turn.player);
      let score: ProbeMeasurement['score'];
      if (present.length === fact.required.length) score = 'PASS';
      else if (present.length > 0 || rows.some((row) => typeof row.content === 'string' && fact.required.some((s) => (row.content as string).includes(s))))
        score = 'PARTIAL';
      else score = 'FAIL';
      measurements.push({
        set: turnNo <= 14 ? 'A' : 'B',
        turn: turnNo,
        fact: turn.probe,
        score,
        carrier: carriers.join('+') || 'none',
        inRecallSet: inSet,
        storeSize: sessionRows.length,
        ...diag,
      });
    }

    await submitExtraction('memories', extractionPrompt(sessionId, turn.player, turn.dm), turnNo);

    if (turnNo === 20) {
      const transcript = TURNS.slice(0, 20)
        .map((t) => `user: ${t.player}\nassistant: ${t.dm}`)
        .join('\n');
      await submitExtraction(
        'summary',
        `Summarize this D&D campaign chronologically. Preserve resolved quests, named NPC relationships, locations, important items, promises, deaths, and unresolved threats. Return only the concise summary.\n\n${transcript}`,
        turnNo,
      );
    }
  }

  beforeAll(async () => {
    if (!hasRealDb) return;
    originalFetch = globalThis.fetch;
    installFetchStub();
    const [campaign] = await database
      .insert(campaigns)
      .values({ userId: USER_ID, name: testId('m353-campaign') })
      .returning({ id: campaigns.id });
    campaignId = campaign.id;
    const [character] = await database
      .insert(characters)
      .values({ userId: USER_ID, campaignId, name: 'Replay Apprentice', class: 'Fighter', level: 1 })
      .returning({ id: characters.id });
    characterId = character.id;
    await database.insert(characterStats).values({
      characterId,
      armorClass: 16,
      maxHitPoints: 20,
      currentHitPoints: 20,
      strength: 16,
    });
    const [session] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active', turnCount: 0 })
      .returning({ id: gameSessions.id });
    sessionId = session.id;
  });

  afterAll(async () => {
    try {
      if (hasRealDb && sessionId) {
        await database.delete(memoryExtractionJobs).where(eq(memoryExtractionJobs.sessionId, sessionId)).catch(() => {});
        await database.delete(memories).where(eq(memories.sessionId, sessionId)).catch(() => {});
        await database.delete(gameSessions).where(eq(gameSessions.id, sessionId)).catch(() => {});
        if (characterId) {
          await database.delete(characterStats).where(eq(characterStats.characterId, characterId)).catch(() => {});
          await database.delete(characters).where(eq(characters.id, characterId)).catch(() => {});
        }
        if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId)).catch(() => {});
      }
    } finally {
      if (originalFetch) globalThis.fetch = originalFetch;
      await closeRealDb();
    }
  });

  test('turns 1-14: plants land, probe set A', async () => {
    if (!hasRealDb) return;
    for (let i = 0; i < 14; i += 1) await playTurn(i);
    // Every planted fact must have been extracted and embedded by its probe.
    const probeText = Object.fromEntries(PROBES.map((p) => [p.fact, p.player])) as Record<FactId, string>;
    for (const fact of Object.keys(FACTS) as FactId[]) {
      const diag = await diagnose(fact, probeText[fact]);
      expect(diag.extracted, `${fact} was never extracted`).toBe(true);
      expect(diag.embedded, `${fact} never got an embedding`).toBe(true);
    }
  }, 300_000);

  test('turns 15-30: summary lands, probe set B, scores reported', async () => {
    if (!hasRealDb) return;
    for (let i = 14; i < 30; i += 1) await playTurn(i);

    console.log('\n#353 replay — probe measurements (similarity is stub-lexical; see file header)');
    for (const m of measurements) {
      console.log(
        `  set ${m.set} T${m.turn} ${m.fact.padEnd(8)} ${m.score.padEnd(7)} carrier=${m.carrier} inSet=${m.inRecallSet} sim=${m.similarity === null ? 'n/a' : m.similarity.toFixed(3)} importanceRank=${m.importanceRank ?? 'n/a'} store=${m.storeSize}`,
      );
    }
    const bySet = (set: 'A' | 'B'): number => measurements.filter((m) => m.set === set && m.score === 'PASS').length;
    console.log(`  probe set A: ${bySet('A')}/5 PASS · probe set B: ${bySet('B')}/5 PASS`);

    for (const m of measurements) {
      expect(m.score, `set ${m.set} T${m.turn} ${m.fact}: ${m.score} (carrier=${m.carrier}, inSet=${m.inRecallSet}, sim=${m.similarity}, importanceRank=${m.importanceRank})`).toBe('PASS');
    }
  }, 300_000);
});
