/**
 * #1020: a one-shot campaign never ends. Hark's Gardener's Heir runs (G22-008/016,
 * build 977ab366) reached Clock 6/6 and nothing fired: no ending row, no completion
 * state, XP frozen at 1,050, and the landing choice the game itself listed was
 * answered "(Nothing comes of that — the moment passes without effect.)".
 *
 * Root cause: nobody owned the ending in code. The campaign's rules (the nine
 * `campaign_rules` rows below, in the shape the lore-keeper ingest writes) reach
 * the DM only as prompt prose; the DM reply schema carried no ending signal, and
 * `SessionService.completeSession` was only ever called by the client's manual
 * end-session flow. The fix is the #218 story-applier shape: the DM declares
 * `campaign_ending` in its reply when the campaign's authored ending condition
 * is met (final beat played, or its clock filled), and the server applies it —
 * ending engine row claimed first (the story-damage pattern), session completed,
 * completion XP through the same reply's `xp_award`. The applier is scoped to
 * one-shot campaigns (`campaign_length = 'one-shot'`): completing a session is
 * irreversible, so a multi-session campaign's declaration is refused, and a
 * session completed any other way (manual end) is terminal for story effects
 * in /generate — both pinned below, alongside the divergent-summary retry.
 *
 * This suite drives the real route (POST /v1/llm/generate through the request
 * pipeline) against real Postgres. Only the sign-in and the model are replaced,
 * by spies restored after each test — the same pattern as
 * dm-reply-reconcile.real-db.test.ts. The DM replies are hand-made envelopes in
 * the real producer's shape (parseDmResponse's base fields plus the story
 * fields), following the Gardener's Heir premade setup: Tavo Brejo, Ranger 3,
 * on 1,050 XP — the exact sheet state Hark's run froze at.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts. This
 * lane's scratch instance is 127.0.0.1:55444; CI's server-real-db job supplies
 * its own (55432) via the glob runner.
 */
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { and, asc, eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';

if (hasRealDb) {
  const target = new URL(realDbUrl);
  if (
    target.hostname !== '127.0.0.1' ||
    !['55432', '55444'].includes(target.port)
  ) {
    throw new Error(
      `[story-ending] refusing real-DB fixtures against ${target.hostname}:${target.port}; use a dedicated local Postgres (CI 55432 / lane 55444)`,
    );
  }
}

process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';
process.env.RATE_LIMIT_LLM_IP_FREE = '10000';
process.env.RATE_LIMIT_LLM_IP_PRO = '10000';
process.env.RATE_LIMIT_LLM_IP_ENTERPRISE = '10000';
process.env.RATE_LIMIT_LLM_USER_FREE = '10000';
process.env.RATE_LIMIT_LLM_USER_PRO = '10000';
process.env.RATE_LIMIT_LLM_USER_ENTERPRISE = '10000';

const authModule = await importWithRealDb(() => import('../../lib/auth.js'));
const { LLMProviderService } = await importWithRealDb(
  () => import('../llm-provider-service.js'),
);
const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../http-pipeline.js'),
);
const { llmRoutes } = await importWithRealDb(() => import('../../routes/v1/llm.js'));
const { SessionMessageService } = await importWithRealDb(
  () => import('../session/session-message-service.js'),
);
const dmReplyPersistence = await importWithRealDb(() => import('../dm/dm-reply-persistence.js'));
const {
  campaigns,
  campaignRules,
  characters,
  characterStats,
  dialogueHistory,
  experienceEvents,
  gameSessions,
  sessionTrackers,
  starterCampaigns,
} = await importWithRealDb(() => import('../../../../db/schema/index.js'));

if (!hasRealDb) {
  console.warn(
    '[story-ending] SKIPPED: set TEST_DATABASE_URL to a dedicated local Postgres to run this suite.',
  );
}

/**
 * The Gardener's Heir rules fixture: the campaign's nine rules as `campaign_rules`
 * rows — the real producer shape (condition → effect, typed, prioritised) the
 * lore-keeper ingest writes from the bible. Rule 1 is the one Hark's runs broke
 * against: when the story Clock fills, the ending fires. The tracker counters in
 * the issue (Favor 1/5, Glass 0, Clock 6/6, Prophet tricks 3/3) are rules 1–4.
 */
const GARDENERS_HEIR_RULES: Array<{
  ruleType: 'causality' | 'mechanic' | 'world_law';
  condition: string;
  effect: string;
  priority: number;
}> = [
  {
    ruleType: 'mechanic',
    condition: 'The story Clock reaches 6 of 6 segments',
    effect:
      'The Hollow closes over the Heartwood and the one-shot ends: the ending plays, ' +
      'completion XP is awarded and the session is complete. No further beats are offered.',
    priority: 10,
  },
  {
    ruleType: 'mechanic',
    condition: 'The party reaches the four-landing choice at the Root Stair',
    effect:
      'The landing the player chooses is the final beat: it resolves the ending the ' +
      'bible defines for that landing. A listed landing is never a dead end.',
    priority: 10,
  },
  {
    ruleType: 'mechanic',
    condition: 'Ombu, the hollow\'s heart, dies',
    effect:
      'The Glass decays and the Heartwood wakes; the story moves to its final choice ' +
      'with the Clock at its last segment.',
    priority: 9,
  },
  {
    ruleType: 'mechanic',
    condition: 'The party spends a Glass Prophet trick (3 per story)',
    effect: 'A vision of one landing\'s ending is shown; Prophet tricks left decreases by one.',
    priority: 6,
  },
  {
    ruleType: 'mechanic',
    condition: 'The party earns the grove\'s trust (Favor reaches 5 of 5)',
    effect: 'The Heartwood speaks plainly and the final choice is offered at once.',
    priority: 7,
  },
  {
    ruleType: 'causality',
    condition: 'The party takes from the grove without asking (Glass rises)',
    effect: 'The Hollow stirs: the Clock advances by one segment.',
    priority: 7,
  },
  {
    ruleType: 'causality',
    condition: 'A landing is refused or left behind',
    effect: 'Its ending is lost; the Clock advances by one segment and the choice narrows.',
    priority: 6,
  },
  {
    ruleType: 'world_law',
    condition: 'The Heartwood is awake',
    effect: 'Nothing in the Hollow can be hidden from it; lies and stealth inside the grove fail.',
    priority: 5,
  },
  {
    ruleType: 'world_law',
    condition: 'The story ends at any landing',
    effect:
      'The Gardener\'s Heir is a one-shot: the campaign is complete, the characters\' ' +
      'story is told, and there is no next session.',
    priority: 10,
  },
];

const ENDING_SUMMARY =
  'The party chose the Sunken Temple landing as the Clock filled; the Hollow closed ' +
  'over the Heartwood and the Gardener\'s Heir ended.';

const endingReply = {
  text:
    'The last segment of the Clock fills as your boots find the Sunken Temple landing. ' +
    'Roots sigh shut over the Heartwood behind you, and the Hollow — patient all along — ' +
    'closes like a held breath let go. Ombu is gone, the Glass is dark, and the grove ' +
    'will keep what was planted here. The story of the Gardener\'s Heir is told.',
  options: [],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  combatants: [],
  combat_actions: [],
  map_actions: [],
  handout_actions: [],
  scene_spec: null,
  xp_award: { amount: 300, reason: 'Completed the Gardener\'s Heir one-shot' },
  campaign_ending: { summary: ENDING_SUMMARY },
};

const ordinaryReply = {
  text:
    'The Root Stair winds down through hanging moss. Somewhere below, water moves ' +
    'over stone, and the grove holds its breath around you.',
  options: [
    'A. **Descend the Root Stair**, toward the sound of water.',
    'B. **Call out**, greet the grove before going deeper.',
  ],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  combatants: [],
  combat_actions: [],
  map_actions: [],
  handout_actions: [],
  scene_spec: null,
  xp_award: { amount: 50, reason: 'Reached the Root Stair' },
};

describeWithDb('#1020 one-shot ending: the engine fires the ending at Clock 6/6', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  const userId = `story-ending-user-${process.pid}`;
  const createdSessionIds: string[] = [];
  let clientAddress = 0;

  beforeAll(async () => {
    if (!hasRealDb) return;
    const starterId = testId('the-gardeners-heir');
    await database.insert(starterCampaigns).values({
      id: starterId,
      slug: testId('the-gardeners-heir'),
      title: "The Gardener's Heir",
      genre: ['fae', 'mystery'],
      tone: ['verdant', 'melancholy'],
      difficulty: 'medium',
      levelRange: '3',
      estimatedSessions: 'One-shot — 1 session',
      premise:
        'A dying grove, a hollow that keeps what is planted, and one night to choose its heir.',
      isPublished: true,
      isComplete: true,
    });
    await database.insert(campaignRules).values(
      GARDENERS_HEIR_RULES.map((rule) => ({ campaignId: starterId, ...rule })),
    );
  });

  afterAll(async () => {
    try {
      if (!hasRealDb) return;
      for (const id of createdSessionIds) {
        await database
          .delete(dialogueHistory)
          .where(eq(dialogueHistory.sessionId, id))
          .catch(() => {});
        await database
          .delete(experienceEvents)
          .where(eq(experienceEvents.sessionId, id))
          .catch(() => {});
        await database.delete(gameSessions).where(eq(gameSessions.id, id)).catch(() => {});
      }
      await database.delete(characters).where(eq(characters.userId, userId)).catch(() => {});
      await database.delete(campaigns).where(eq(campaigns.userId, userId)).catch(() => {});
      const starterId = testId('the-gardeners-heir');
      await database
        .delete(campaignRules)
        .where(eq(campaignRules.campaignId, starterId))
        .catch(() => {});
      await database
        .delete(starterCampaigns)
        .where(eq(starterCampaigns.id, starterId))
        .catch(() => {});
      const { sql } = await import('../../lib/db.js');
      await sql`DELETE FROM ai_usage WHERE user_id = ${userId}`.catch(() => {});
    } finally {
      await closeRealDb();
    }
  });

  /**
   * Seeds one Gardener's Heir playthrough the way production links it: the
   * one-shot campaign row, the premade-shaped character (Tavo Brejo, Ranger 3,
   * 1,050 XP — Hark's frozen sheet), and its active session tied to the starter
   * campaign whose rules are seeded above.
   */
  async function seedWorld(
    label: string,
    campaignLength = 'one-shot',
  ): Promise<{
    campaignId: string;
    characterId: string;
    sessionId: string;
  }> {
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({
        userId,
        name: testId(`gardeners-heir-${label}`),
        campaignLength,
      })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: 'Tavo Brejo',
        class: 'Ranger',
        level: 3,
        experiencePoints: 1050,
      })
      .returning({ id: characters.id });
    await database.insert(characterStats).values({
      characterId,
      armorClass: 14,
      maxHitPoints: 24,
      currentHitPoints: 24,
      strength: 12,
      dexterity: 16,
      constitution: 14,
      intelligence: 10,
      wisdom: 15,
      charisma: 8,
    });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 1,
        status: 'active',
        turnCount: 0,
        starterCampaignId: testId('the-gardeners-heir'),
      })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);
    return { campaignId, characterId, sessionId };
  }

  /** Drives one DM turn through the real generate route with the model replaced. */
  async function dmTurn(opts: {
    sessionId: string;
    characterId: string;
    playerInput: string;
    reply: Record<string, unknown>;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    await SessionMessageService.addMessages(
      [
        {
          id: crypto.randomUUID(),
          sessionId: opts.sessionId,
          speakerType: 'player',
          message: opts.playerInput,
        },
      ],
      userId,
    );
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: 'story-ending@example.test', plan: 'tester' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify(opts.reply),
      provider: 'openrouter',
      model: 't/m',
      usage: { inputTokens: 4200, outputTokens: 310 },
    } as never);
    const watchdog = spyOn(
      dmReplyPersistence,
      'scheduleDmReplyWatchdog',
    ).mockResolvedValue(undefined as never);
    const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';
    try {
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${userId}`,
              'content-type': 'application/json',
              'x-forwarded-for': `198.51.100.${(clientAddress = (clientAddress % 254) + 1)}`,
            },
            body: JSON.stringify({
              prompt: `<campaign>The Gardener's Heir</campaign>\n<player_input>\n${opts.playerInput}\n</player_input>`,
              sessionId: opts.sessionId,
              player_input: opts.playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: {
                messageId: crypto.randomUUID(),
                inCombat: false,
                narrationGated: false,
              },
              combatEntry: {
                sessionId: opts.sessionId,
                player: {
                  characterId: opts.characterId,
                  name: 'Tavo Brejo',
                  initiativeModifier: 3,
                },
              },
            }),
          }),
        );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    } finally {
      if (trustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = trustProxyHeaders;
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
    }
  }

  const sessionRow = async (sessionId: string) =>
    (
      await database
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId))
        .limit(1)
    )[0];

  const endingRows = async (sessionId: string) =>
    (
      await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId))
        .orderBy(asc(dialogueHistory.createdAt))
    ).filter(
      (row) =>
        row.speakerType === 'system' &&
        (row.context as { intent?: string } | null)?.intent === 'campaign_ending',
    );

  test('the landing choice at Clock 6/6: ending row, completed session, completion XP', async () => {
    const { characterId, sessionId } = await seedWorld('ending');

    const { status, body } = await dmTurn({
      sessionId,
      characterId,
      // G22-008's exact shape: a landing the game itself listed as an option.
      playerInput: 'I take the Sunken Temple landing.',
      reply: endingReply,
    });

    expect(status).toBe(200);
    // The applied ending stays on the response envelope (the #768 damage
    // contract): the client reads it to show the completion screen and to keep
    // the narration gate from replacing the ending narration.
    const responseEnvelope = JSON.parse(String(body.text)) as Record<string, unknown>;
    expect(responseEnvelope.campaign_ending).toEqual({ summary: ENDING_SUMMARY });

    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('completed');
    expect(session?.endTime).not.toBeNull();
    expect(session?.summary).toBe(ENDING_SUMMARY);

    const rows = await endingRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain('Adventure complete');

    // Completion XP reached the sheet through the same reply's xp_award:
    // Hark's frozen 1,050 finally moves.
    const [character] = await database
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(character?.xp).toBe(1350);
    const events = await database
      .select()
      .from(experienceEvents)
      .where(
        and(
          eq(experienceEvents.sessionId, sessionId),
          eq(experienceEvents.characterId, characterId),
        ),
      );
    expect(events.some((event) => event.xpGained === 300)).toBe(true);
  });

  test('an ordinary turn declares no ending: the session stays active', async () => {
    const { characterId, sessionId } = await seedWorld('ordinary');

    const { status } = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I look down the Root Stair.',
      reply: ordinaryReply,
    });

    expect(status).toBe(200);
    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('active');
    expect(session?.endTime).toBeNull();
    expect(await endingRows(sessionId)).toHaveLength(0);
  });

  test('a second ending declaration does not post a second ending row', async () => {
    const { characterId, sessionId } = await seedWorld('repeat');
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I take the Sunken Temple landing.',
      reply: endingReply,
    });
    expect((await sessionRow(sessionId))?.status).toBe('completed');

    const second = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'Wait — what just happened?',
      reply: endingReply,
    });

    // A completed session is terminal for story effects: the repeated
    // declaration is nulled on the envelope (not kept as a second applied
    // ending), no second row is posted, and the repeated xp_award does not
    // land a second time — the sheet stays at the first award's 1,350.
    const secondEnvelope = JSON.parse(String(second.body.text)) as Record<string, unknown>;
    expect(secondEnvelope.campaign_ending).toBeNull();
    expect((await sessionRow(sessionId))?.status).toBe('completed');
    expect((await sessionRow(sessionId))?.summary).toBe(ENDING_SUMMARY);
    expect(await endingRows(sessionId)).toHaveLength(1);
    const [character] = await database
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(character?.xp).toBe(1350);
  });

  test('a retried ending with a different summary keeps the stored ending', async () => {
    const { sessionId } = await seedWorld('divergent');
    await SessionMessageService.addMessages(
      [
        {
          id: crypto.randomUUID(),
          sessionId,
          speakerType: 'player',
          message: 'I take the Sunken Temple landing.',
        },
      ],
      userId,
    );
    const { applyStoryEnding } = await importWithRealDb(
      () => import('../dm/story-ending.js'),
    );

    const first = await applyStoryEnding({
      userId,
      sessionId,
      ending: { summary: ENDING_SUMMARY },
    });
    expect(first.outcome).toBe('applied');
    expect(first.summary).toBe(ENDING_SUMMARY);

    // A retry regenerates the reply, so its summary differs. The stored
    // ending wins: session row, engine row and the returned summary (which
    // /generate puts on the envelope for the completion screen) all carry
    // the first text.
    const second = await applyStoryEnding({
      userId,
      sessionId,
      ending: { summary: 'The grove closed quietly and the tale was told another way.' },
    });
    expect(second.outcome).toBe('already_applied');
    expect(second.summary).toBe(ENDING_SUMMARY);
    expect((await sessionRow(sessionId))?.summary).toBe(ENDING_SUMMARY);
    const rows = await endingRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain(ENDING_SUMMARY);
  });

  test('an ending declared for a multi-session campaign does not complete it', async () => {
    const { characterId, sessionId } = await seedWorld('full-length', 'full');

    const { status, body } = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I take the Sunken Temple landing.',
      reply: endingReply,
    });

    expect(status).toBe(200);
    // Completing a session is irreversible; the applier is scoped to
    // one-shots, so the declaration is refused and nulled. Ordinary story
    // XP on the live session still lands.
    const responseEnvelope = JSON.parse(String(body.text)) as Record<string, unknown>;
    expect(responseEnvelope.campaign_ending).toBeNull();
    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('active');
    expect(await endingRows(sessionId)).toHaveLength(0);
    const [character] = await database
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(character?.xp).toBe(1350);
  });

  test('a declaration after a manual end does not rewrite the ended session', async () => {
    const { characterId, sessionId } = await seedWorld('manual-end');
    const { SessionService } = await importWithRealDb(
      () => import('../session-service.js'),
    );
    await SessionService.completeSession(sessionId, userId, 'Ended by hand at the Root Stair.');

    const { status, body } = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'Wait — what just happened?',
      reply: endingReply,
    });

    expect(status).toBe(200);
    // The session was completed by the player, not by an ending: no ending
    // row appears, the stored summary is untouched, and the declaration is
    // nulled rather than shown as a campaign completion.
    const responseEnvelope = JSON.parse(String(body.text)) as Record<string, unknown>;
    expect(responseEnvelope.campaign_ending).toBeNull();
    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('completed');
    expect(session?.summary).toBe('Ended by hand at the Root Stair.');
    expect(await endingRows(sessionId)).toHaveLength(0);
  });
});

/**
 * #1042: the engine-side tracker. The DM's prose Clock becomes stored
 * state: replies carry `tracker_changes`, the server applies them to
 * `session_trackers`, and the limit enforces itself — the climax phase
 * (with its directive in the next prompt) at `at_limit: climax`, the
 * forced ending at `at_limit: ending`, and the ending-required safety
 * net after 6 undeclared climax turns. The rules fixtures are the audit's
 * live shape: causality rows whose condition is exactly "the <Name> Clock
 * reaches <N>", with `limit`/`at_limit` in metadata as the revised spec
 * has Campaign Claude write them.
 */
describeWithDb('#1042 story trackers: the engine stores the clock and enforces its limit', () => {
  // Re-acquired in beforeAll: the #1020 describe above closes the shared
  // fixture pool in its afterAll, so a pool captured at definition time
  // here would already be ended.
  let database = null as unknown as ReturnType<typeof realDb>;
  const starterIds = { breath: '', score: '', plain: '', heldrest: '' };
  const userId = `story-tracker-user-${process.pid}`;
  const createdSessionIds: string[] = [];
  let clientAddress = 100;

  const clockRules = (
    name: string,
    atLimit: 'climax' | 'ending',
  ): Array<{
    ruleType: 'causality';
    condition: string;
    effect: string;
    priority: number;
    metadata: Record<string, unknown>;
  }> =>
    [2, 4, 6].map((n) => ({
      ruleType: 'causality' as const,
      condition: `the ${name} Clock reaches ${n}`,
      effect:
        n === 6
          ? `The ${name} Clock is full: the one-shot's final movement begins.`
          : `The ${name} Clock stands at ${n} of 6 segments.`,
      priority: 8,
      metadata: n === 6 ? { limit: 6, at_limit: atLimit } : {},
    }));

  /** The audit's the-held-rest, verbatim in shape: clean reaches rows
   *  only to 5, the 6 living in a tick row's effect ("jumps to 6") and a
   *  compound ending row — metadata empty on every row, exactly as the
   *  live rows stand. The fail-closed parser defines no clock from
   *  these; round 1's parser read the limit as 5. */
  const heldRestRules = (): Array<{
    ruleType: 'causality';
    condition: string;
    effect: string;
    priority: number;
    metadata: Record<string, unknown>;
  }> => [
    ...[2, 3, 4, 5].map((n) => ({
      ruleType: 'causality' as const,
      condition: `the Score Clock reaches ${n}`,
      effect: `The Score Clock stands at ${n} of 6 segments.`,
      priority: 8,
      metadata: {},
    })),
    {
      ruleType: 'causality' as const,
      condition: 'the hero pulls the Tuner’s wedge',
      effect: 'The Score Clock jumps to 6.',
      priority: 8,
      metadata: {},
    },
    {
      ruleType: 'causality' as const,
      condition:
        'the Score Clock reaches 5 for the third time or reaches 6 and the hero never offers a phrase',
      effect: 'Ending D: the Tuner takes the stage alone.',
      priority: 8,
      metadata: {},
    },
  ];

  /** The audit's actual live shape for the 12 parseable campaigns: the
   *  same clean causality rows with metadata EMPTY on every row — the
   *  limit is the highest reaches-N and `at_limit` defaults to climax. */
  const plainClockRules = (
    name: string,
  ): Array<{
    ruleType: 'causality';
    condition: string;
    effect: string;
    priority: number;
    metadata: Record<string, unknown>;
  }> =>
    [2, 4, 6].map((n) => ({
      ruleType: 'causality' as const,
      condition: `the ${name} Clock reaches ${n}`,
      effect: `The ${name} Clock stands at ${n} of 6 segments.`,
      priority: 8,
      metadata: {},
    }));

  beforeAll(async () => {
    if (!hasRealDb) return;
    database = realDb();
    for (const [key, starter, name, atLimit] of [
      ['breath', 'the-breath-clock', 'Breath', 'climax'],
      ['score', 'the-score-clock', 'Score', 'ending'],
      ['plain', 'the-plain-clock', 'Plain', 'climax'],
    ] as const) {
      const starterId = testId(starter);
      starterIds[key] = starterId;
      await database.insert(starterCampaigns).values({
        id: starterId,
        slug: testId(starter),
        title: `The ${name} Clock`,
        genre: ['fae', 'mystery'],
        tone: ['verdant'],
        difficulty: 'medium',
        levelRange: '3',
        estimatedSessions: 'One-shot — 1 session',
        premise: `A one-shot paced by the ${name} Clock.`,
        isPublished: true,
        isComplete: true,
      });
      await database.insert(campaignRules).values(
        (key === 'plain' ? plainClockRules(name) : clockRules(name, atLimit)).map((rule) => ({
          campaignId: starterId,
          ...rule,
        })),
      );
    }
    starterIds.heldrest = testId('the-held-rest');
    await database.insert(starterCampaigns).values({
      id: starterIds.heldrest,
      slug: testId('the-held-rest'),
      title: 'The Held Rest',
      genre: ['fae', 'mystery'],
      tone: ['verdant'],
      difficulty: 'medium',
      levelRange: '3',
      estimatedSessions: 'One-shot — 1 session',
      premise: 'A one-shot paced by the Score Clock.',
      isPublished: true,
      isComplete: true,
    });
    await database.insert(campaignRules).values(
      heldRestRules().map((rule) => ({ campaignId: starterIds.heldrest, ...rule })),
    );
  });

  afterAll(async () => {
    try {
      if (!hasRealDb) return;
      for (const id of createdSessionIds) {
        await database
          .delete(sessionTrackers)
          .where(eq(sessionTrackers.sessionId, id))
          .catch(() => {});
        await database
          .delete(dialogueHistory)
          .where(eq(dialogueHistory.sessionId, id))
          .catch(() => {});
        await database.delete(gameSessions).where(eq(gameSessions.id, id)).catch(() => {});
      }
      await database.delete(characters).where(eq(characters.userId, userId)).catch(() => {});
      await database.delete(campaigns).where(eq(campaigns.userId, userId)).catch(() => {});
      for (const starterId of [
        starterIds.breath,
        starterIds.score,
        starterIds.plain,
        starterIds.heldrest,
      ]) {
        await database
          .delete(campaignRules)
          .where(eq(campaignRules.campaignId, starterId))
          .catch(() => {});
        await database
          .delete(starterCampaigns)
          .where(eq(starterCampaigns.id, starterId))
          .catch(() => {});
      }
      const { sql } = await import('../../lib/db.js');
      await sql`DELETE FROM ai_usage WHERE user_id = ${userId}`.catch(() => {});
    } finally {
      await closeRealDb();
    }
  });

  async function seedWorld(
    label: string,
    starter: 'breath' | 'score' | 'plain' | 'heldrest',
    campaignLength: 'one-shot' | 'campaign' | 'full' = 'one-shot',
  ): Promise<{ characterId: string; sessionId: string }> {
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId(`tracker-${label}`), campaignLength })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({ userId, campaignId, name: 'Tavo Brejo', class: 'Ranger', level: 3, experiencePoints: 1050 })
      .returning({ id: characters.id });
    await database.insert(characterStats).values({
      characterId,
      armorClass: 14,
      maxHitPoints: 24,
      currentHitPoints: 24,
      strength: 12,
      dexterity: 16,
      constitution: 14,
      intelligence: 10,
      wisdom: 15,
      charisma: 8,
    });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 1,
        status: 'active',
        turnCount: 0,
        starterCampaignId: starterIds[starter],
      })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);
    return { characterId, sessionId };
  }

  /** One DM turn through the real route; every prompt the model saw is captured. */
  async function dmTurn(opts: {
    sessionId: string;
    characterId: string;
    playerInput: string;
    reply: Record<string, unknown>;
    capturedPrompts: string[];
    /** False replays the turn against the same saved player message (a Retry). */
    insertMessage?: boolean;
    /**
     * Per-call replies for a turn the server generates more than once
     * (the safety net's corrective call): call N gets replies[N], and
     * the last entry repeats. `reply` serves every unscripted call.
     */
    replies?: Array<Record<string, unknown>>;
    /** The turn is an in-combat turn (the client's dmReply flag). */
    inCombat?: boolean;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    if (opts.insertMessage !== false) {
      await SessionMessageService.addMessages(
        [
          {
            id: crypto.randomUUID(),
            sessionId: opts.sessionId,
            speakerType: 'player',
            message: opts.playerInput,
          },
        ],
        userId,
      );
    }
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: 'story-tracker@example.test', plan: 'tester' },
      error: null,
    } as never);
    let generateCalls = 0;
    const model = spyOn(LLMProviderService, 'generate').mockImplementation((async (args: {
      prompt: string;
    }) => {
      opts.capturedPrompts.push(args.prompt);
      const scripted = opts.replies;
      const reply =
        scripted && scripted.length > 0
          ? scripted[Math.min(generateCalls, scripted.length - 1)]
          : opts.reply;
      generateCalls += 1;
      return {
        text: JSON.stringify(reply),
        provider: 'openrouter',
        model: 't/m',
        usage: { inputTokens: 4200, outputTokens: 310 },
      };
    }) as never);
    const watchdog = spyOn(
      dmReplyPersistence,
      'scheduleDmReplyWatchdog',
    ).mockResolvedValue(undefined as never);
    const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';
    try {
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${userId}`,
              'content-type': 'application/json',
              'x-forwarded-for': `198.51.100.${(clientAddress = (clientAddress % 254) + 1)}`,
            },
            body: JSON.stringify({
              prompt: `<campaign>The Clock</campaign>\n<player_input>\n${opts.playerInput}\n</player_input>`,
              sessionId: opts.sessionId,
              player_input: opts.playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: {
                messageId: crypto.randomUUID(),
                inCombat: opts.inCombat ?? false,
                narrationGated: false,
              },
              combatEntry: {
                sessionId: opts.sessionId,
                player: {
                  characterId: opts.characterId,
                  name: 'Tavo Brejo',
                  initiativeModifier: 3,
                },
              },
            }),
          }),
        );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    } finally {
      if (trustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = trustProxyHeaders;
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
    }
  }

  const baseReply = {
    text: 'The grove breathes around you, and time moves in the hollow.',
    options: [],
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    combatants: [],
    combat_actions: [],
    map_actions: [],
    handout_actions: [],
    scene_spec: null,
  };
  const trackerReply = (changes: Array<Record<string, unknown>>) => ({
    ...baseReply,
    tracker_changes: changes,
  });

  const trackerRow = async (
    sessionId: string,
    name: string,
  ): Promise<{ value: number; limit: number } | undefined> =>
    (
      await database
        .select()
        .from(sessionTrackers)
        .where(and(eq(sessionTrackers.sessionId, sessionId), eq(sessionTrackers.name, name)))
        .limit(1)
    )[0];

  const sessionRow = async (
    sessionId: string,
  ): Promise<Record<string, unknown> | undefined> =>
    (await database.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1))[0] as
      | Record<string, unknown>
      | undefined;

  const trackerPhase = async (
    sessionId: string,
  ): Promise<
    | {
        tracker?: {
          phase?: string;
          climaxTurns?: number;
          endingRequired?: boolean;
          budgetForced?: boolean;
        };
      }
    | undefined
  > =>
    (await sessionRow(sessionId))?.sessionState as
      | {
          tracker?: {
            phase?: string;
            climaxTurns?: number;
            endingRequired?: boolean;
            budgetForced?: boolean;
          };
        }
      | undefined;

  test('clock 5 + delta 1 at at_limit=climax: phase flips, the next prompt announces the climax, nothing ends', async () => {
    const { characterId, sessionId } = await seedWorld('climax', 'breath');
    const prompts: string[] = [];

    // Below the limit (the original spec's negative): the value is stored
    // from server state, and nothing fires.
    const first = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the landing and move on.',
      reply: trackerReply([{ name: 'Breath', set: 5 }]),
      capturedPrompts: prompts,
    });
    expect(first.status).toBe(200);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);
    expect((await trackerRow(sessionId, 'Breath'))?.limit).toBe(6);
    expect((await sessionRow(sessionId))?.status).toBe('active');
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBeUndefined();

    // The tick that fills the clock: phase becomes climax, session lives.
    const second = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We linger until the light changes.',
      reply: trackerReply([{ name: 'Breath', delta: 1 }]),
      capturedPrompts: prompts,
    });
    expect(second.status).toBe(200);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(6);
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBe('climax');
    expect((await sessionRow(sessionId))?.status).toBe('active');
    expect((await sessionRow(sessionId))?.endTime).toBeNull();

    // The next turn's prompt carries the climax directive and the stored
    // tracker line — rendered from server state, not the DM's prose.
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'What happens now?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    const nextPrompt = prompts[prompts.length - 1];
    expect(nextPrompt).toContain('the climax is now');
    expect(nextPrompt).toContain('Breath Clock: 6/6');
  }, 30_000);

  test('#1062: the reply envelope carries the tracker line from post-apply server state', async () => {
    const { characterId, sessionId } = await seedWorld('envelope', 'breath');
    const prompts: string[] = [];
    const envelopeOf = (body: Record<string, unknown>): Record<string, unknown> =>
      JSON.parse(body.text as string) as Record<string, unknown>;

    // Clock-moving turn: the envelope carries the POST-apply values, and
    // the stored row agrees — not the directive-load values, which lag
    // one turn on exactly the turns that move the clock.
    const moved = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the landing and move on.',
      reply: trackerReply([{ name: 'Breath', set: 5 }]),
      capturedPrompts: prompts,
    });
    expect(moved.status).toBe(200);
    expect(envelopeOf(moved.body).story_trackers).toEqual([{ name: 'Breath', value: 5, limit: 6 }]);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);

    // The tick that fills the clock, then a no-change turn: the step runs
    // (climax phase) with no changes, and the envelope still carries the
    // stored values.
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We linger until the light changes.',
      reply: trackerReply([{ name: 'Breath', delta: 1 }]),
      capturedPrompts: prompts,
    });
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(6);
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBe('climax');
    const held = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'What happens now?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(held.status).toBe(200);
    expect(envelopeOf(held.body).story_trackers).toEqual([{ name: 'Breath', value: 6, limit: 6 }]);
  }, 30_000);

  test('#1062 round 2: a turn the tracker step does not run carries the directive-load tracker values', async () => {
    const { characterId, sessionId } = await seedWorld('envelope-quiet', 'breath');
    const prompts: string[] = [];
    const envelopeOf = (body: Record<string, unknown>): Record<string, unknown> =>
      JSON.parse(body.text as string) as Record<string, unknown>;

    // Fresh session, no stored rows: the directive renders the defined
    // clock at 0, and the envelope carries that same list — the line the
    // player sees does not vanish on quiet turns.
    const quiet = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We walk on down the road.',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(quiet.status).toBe(200);
    expect(envelopeOf(quiet.body).story_trackers).toEqual([{ name: 'Breath', value: 0, limit: 6 }]);

    // Move the clock, then another quiet turn (no changes, not climax, so
    // the step does not run): the envelope carries the stored 5/6, not a
    // stale or absent line.
    const moved = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the landing and move on.',
      reply: trackerReply([{ name: 'Breath', set: 5 }]),
      capturedPrompts: prompts,
    });
    expect(moved.status).toBe(200);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);
    const quietAfter = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We walk on down the road.',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(quietAfter.status).toBe(200);
    expect(envelopeOf(quietAfter.body).story_trackers).toEqual([{ name: 'Breath', value: 5, limit: 6 }]);
  }, 30_000);

  test('#1062 self-review: a model-supplied story_trackers value never renders as server truth', async () => {
    const { characterId, sessionId } = await seedWorld('envelope-forged', 'breath');
    const prompts: string[] = [];
    const forged = [{ name: 'Breath', value: 99, limit: 6 }];

    // Quiet turn (the tracker step does not run): the forged value is
    // stripped, and the envelope carries the directive-load values (0/6
    // on this fresh session) — never the forgery, and (round 2) never
    // absent either.
    const quiet = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We walk on down the road.',
      reply: { ...baseReply, story_trackers: forged },
      capturedPrompts: prompts,
    });
    expect(quiet.status).toBe(200);
    expect((JSON.parse(quiet.body.text as string) as Record<string, unknown>).story_trackers).toEqual([
      { name: 'Breath', value: 0, limit: 6 },
    ]);

    // Clock-moving turn: the stored post-apply value wins, not the forgery.
    const moved = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the landing and move on.',
      reply: { ...trackerReply([{ name: 'Breath', set: 5 }]), story_trackers: forged },
      capturedPrompts: prompts,
    });
    expect(moved.status).toBe(200);
    expect((JSON.parse(moved.body.text as string) as Record<string, unknown>).story_trackers).toEqual([
      { name: 'Breath', value: 5, limit: 6 },
    ]);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);
  }, 30_000);

  test('clock reaching its limit at at_limit=ending completes the session through the ending path', async () => {
    const { characterId, sessionId } = await seedWorld('ending', 'score');
    const prompts: string[] = [];

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'The wedge comes free in my hands.',
      reply: trackerReply([{ name: 'Score', set: 5 }]),
      capturedPrompts: prompts,
    });
    expect((await sessionRow(sessionId))?.status).toBe('active');

    const second = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I pull the last wedge.',
      reply: trackerReply([{ name: 'Score', delta: 1 }]),
      capturedPrompts: prompts,
    });
    expect(second.status).toBe(200);
    expect((await trackerRow(sessionId, 'Score'))?.value).toBe(6);
    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('completed');
    expect(session?.endTime).not.toBeNull();
    // The forced ending went through applyStoryEnding: its engine row is
    // the one stored ending for the session.
    const rows = (
      await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId))
    ).filter(
      (row) =>
        row.speakerType === 'system' &&
        (row.context as { intent?: string } | null)?.intent === 'campaign_ending',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain('Score Clock reached 6');
  }, 30_000);

  test('six climax turns with no declared ending: the next prompt requires the ending', async () => {
    const { characterId, sessionId } = await seedWorld('safety-net', 'breath');
    const prompts: string[] = [];

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the last landing.',
      reply: trackerReply([{ name: 'Breath', set: 6 }]),
      capturedPrompts: prompts,
    });
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBe('climax');

    // Six player turns in the climax, the DM narrating on without ever
    // declaring the ending.
    for (let turn = 1; turn <= 6; turn += 1) {
      const { status } = await dmTurn({
        sessionId,
        characterId,
        playerInput: `We press on through the climax (turn ${turn}).`,
        reply: { ...baseReply },
        capturedPrompts: prompts,
      });
      expect(status).toBe(200);
    }
    const phase = (await trackerPhase(sessionId))?.tracker;
    expect(phase?.climaxTurns).toBe(6);
    expect(phase?.endingRequired).toBe(true);
    expect((await sessionRow(sessionId))?.status).toBe('active');

    // The one more request the spec promises: its prompt requires the ending.
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'And then?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(prompts[prompts.length - 1]).toContain('the ending is required');
  }, 60_000);

  test('a retried turn (same saved player message) never applies its changes twice', async () => {
    const { characterId, sessionId } = await seedWorld('replay', 'breath');
    const prompts: string[] = [];
    const reply = trackerReply([{ name: 'Breath', delta: 5 }]);

    const first = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We cross the hollow quickly.',
      reply,
      capturedPrompts: prompts,
    });
    expect(first.status).toBe(200);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);

    // Retry replays the request against the same saved player message:
    // the once-per-message marker turns the second application away, and
    // the envelope keeps the changes (they did land — on the first try).
    const replay = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We cross the hollow quickly.',
      reply,
      capturedPrompts: prompts,
      insertMessage: false,
    });
    expect(replay.status).toBe(200);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);
    const replayEnvelope = JSON.parse(String(replay.body.text)) as Record<string, unknown>;
    expect(Array.isArray(replayEnvelope.tracker_changes)).toBe(true);
  }, 30_000);

  test('changes on a roll-request turn wait for the result turn', async () => {
    const { characterId, sessionId } = await seedWorld('roll-deferral', 'breath');
    const prompts: string[] = [];

    const rollTurn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I hold on to the rope as the hollow pulls at us.',
      reply: {
        ...baseReply,
        roll_requests: [
          {
            type: 'save',
            formula: '1d20+2',
            purpose: 'Wisdom save to hold the rope against the hollow',
            dc: 14,
            ac: null,
            advantage: false,
            disadvantage: false,
          },
        ],
        tracker_changes: [{ name: 'Breath', delta: 5 }],
      },
      capturedPrompts: prompts,
    });
    expect(rollTurn.status).toBe(200);
    // Nothing landed on the roll turn, and the envelope says so.
    expect(await trackerRow(sessionId, 'Breath')).toBeUndefined();
    const rollEnvelope = JSON.parse(String(rollTurn.body.text)) as Record<string, unknown>;
    expect(rollEnvelope.tracker_changes ?? null).toBeNull();

    // The result turn re-sends the movement (the schema's instruction),
    // and now it lands.
    const resultTurn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I hold fast.',
      reply: trackerReply([{ name: 'Breath', delta: 5 }]),
      capturedPrompts: prompts,
    });
    expect(resultTurn.status).toBe(200);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);
  }, 30_000);

  test('a final-beat flag on a roll-request turn is cleared and waits for the result turn', async () => {
    const { characterId, sessionId } = await seedWorld('roll-flag', 'breath');
    const prompts: string[] = [];

    const rollTurn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I hold on to the rope as the hollow pulls at us.',
      reply: {
        ...baseReply,
        roll_requests: [
          {
            type: 'save',
            formula: '1d20+2',
            purpose: 'Wisdom save to hold the rope against the hollow',
            dc: 14,
            ac: null,
            advantage: false,
            disadvantage: false,
          },
        ],
        final_beat_reached: true,
      },
      capturedPrompts: prompts,
    });
    expect(rollTurn.status).toBe(200);
    // The flag did not land on the roll turn, and the envelope says so:
    // cleared the way campaign_ending is cleared, not carried as applied.
    expect((await trackerPhase(sessionId))?.tracker?.endingRequired).toBeUndefined();
    const rollEnvelope = JSON.parse(String(rollTurn.body.text)) as Record<string, unknown>;
    expect(rollEnvelope.final_beat_reached ?? null).toBeNull();

    // The result turn re-sends the flag (the schema's instruction), and
    // now it arms — deferred, not lost.
    const resultTurn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I hold fast.',
      reply: { ...baseReply, final_beat_reached: true },
      capturedPrompts: prompts,
    });
    expect(resultTurn.status).toBe(200);
    const armed = (await trackerPhase(sessionId))?.tracker as
      | { endingRequired?: boolean; finalBeat?: boolean }
      | undefined;
    expect(armed?.endingRequired).toBe(true);
    expect(armed?.finalBeat).toBe(true);
  }, 30_000);

  test('the final-beat audit log fires once on a real arm turn and nothing new on a Retry replay (#1068 FIX round 2)', async () => {
    // The production logger is pino to process.stdout (sonic-boom
    // flushes async), so capture stdout around the turns and poll the
    // buffer for the marker instead of asserting synchronously.
    const { characterId, sessionId } = await seedWorld('audit-log', 'breath');
    const prompts: string[] = [];
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const capture = (chunk: unknown, encoding?: unknown, cb?: unknown) => {
      chunks.push(String(chunk));
      const callback = typeof encoding === 'function' ? encoding : cb;
      if (typeof callback === 'function') (callback as () => void)();
      return true;
    };
    const countFlagged = () =>
      chunks.join('').split('DM_STORY_TRACKER_FINAL_BEAT_FLAGGED').length - 1;
    const waitForFlagged = async (n: number, ms: number) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (countFlagged() >= n) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return countFlagged() >= n;
    };
    try {
      (process.stdout as unknown as { write: unknown }).write = capture;
      const armTurn = await dmTurn({
        sessionId,
        characterId,
        playerInput: 'We reach the final landing.',
        reply: { ...baseReply, final_beat_reached: true },
        capturedPrompts: prompts,
      });
      expect(armTurn.status).toBe(200);
      expect(await waitForFlagged(1, 5000)).toBe(true);
      expect(countFlagged()).toBe(1);

      // Retry replay of the same saved player message: the step returns
      // already_applied and must not log a second arm.
      const replay = await dmTurn({
        sessionId,
        characterId,
        playerInput: 'We reach the final landing.',
        reply: { ...baseReply, final_beat_reached: true },
        capturedPrompts: prompts,
        insertMessage: false,
      });
      expect(replay.status).toBe(200);
      await new Promise((r) => setTimeout(r, 1000));
      expect(countFlagged()).toBe(1);
    } finally {
      (process.stdout as unknown as { write: unknown }).write = origWrite;
    }
    // The arm really landed (phase, not just the log line).
    const armed = (await trackerPhase(sessionId))?.tracker as
      | { endingRequired?: boolean; finalBeat?: boolean }
      | undefined;
    expect(armed?.endingRequired).toBe(true);
    expect(armed?.finalBeat).toBe(true);
  }, 60_000);

  test('a session whose campaign belongs to another owner resolves no clocks', async () => {
    // The tracker state is scoped through the session's campaign owner:
    // this session's character is the caller's, but its campaign is not,
    // so no definitions resolve and no change can land.
    const otherUserId = `story-tracker-other-${process.pid}`;
    const [{ id: otherCampaignId }] = await database
      .insert(campaigns)
      .values({ userId: otherUserId, name: testId('tracker-foreign'), campaignLength: 'one-shot' })
      .returning({ id: campaigns.id });
    try {
      const [{ id: characterId }] = await database
        .insert(characters)
        .values({
          userId,
          campaignId: otherCampaignId,
          name: 'Tavo Brejo',
          class: 'Ranger',
          level: 3,
          experiencePoints: 1050,
        })
        .returning({ id: characters.id });
      await database.insert(characterStats).values({
        characterId,
        armorClass: 14,
        maxHitPoints: 24,
        currentHitPoints: 24,
        strength: 12,
        dexterity: 16,
        constitution: 14,
        intelligence: 10,
        wisdom: 15,
        charisma: 8,
      });
      const [{ id: sessionId }] = await database
        .insert(gameSessions)
        .values({
          campaignId: otherCampaignId,
          characterId,
          sessionNumber: 1,
          status: 'active',
          turnCount: 0,
          starterCampaignId: starterIds.breath,
        })
        .returning({ id: gameSessions.id });
      createdSessionIds.push(sessionId);

      await dmTurn({
        sessionId,
        characterId,
        playerInput: 'We cross the hollow quickly.',
        reply: trackerReply([{ name: 'Breath', delta: 5 }]),
        capturedPrompts: [],
      });
      expect(await trackerRow(sessionId, 'Breath')).toBeUndefined();
      expect((await sessionRow(sessionId))?.status).toBe('active');
    } finally {
      await database.delete(campaigns).where(eq(campaigns.id, otherCampaignId)).catch(() => {});
    }
  }, 30_000);

  test('client session_state writes cannot erase or forge the tracker state', async () => {
    const { characterId, sessionId } = await seedWorld('preservation', 'breath');
    const prompts: string[] = [];
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We linger until the light changes.',
      reply: trackerReply([{ name: 'Breath', set: 6 }]),
      capturedPrompts: prompts,
    });
    const before = (await trackerPhase(sessionId))?.tracker;
    expect(before?.phase).toBe('climax');

    const { SessionService } = await importWithRealDb(() => import('../session-service.js'));
    // A routine whole-blob client write (its snapshot predates the
    // climax) must not delete the phase, the count, or the marker.
    const wiped = await SessionService.updateSession(sessionId, userId, {
      sessionState: { clientKey: 'snapshot' },
    });
    expect((wiped.sessionState as { tracker?: unknown })?.tracker).toEqual(before);
    // And a forged tracker key in the client's blob never replaces the
    // engine's stored value.
    const forged = await SessionService.updateSession(sessionId, userId, {
      sessionState: {
        tracker: {
          phase: 'climax',
          clock: 'Forged',
          climaxTurns: 0,
          endingRequired: false,
          lastMessageId: 'forged-message-id',
        },
      },
    });
    expect((forged.sessionState as { tracker?: unknown })?.tracker).toEqual(before);
    expect((await trackerPhase(sessionId))?.tracker).toEqual(before);
  }, 30_000);

  test('model values are clamped to the clock’s range', async () => {
    const { characterId, sessionId } = await seedWorld('clamp', 'breath');
    const prompts: string[] = [];

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'The hollow gives back its held breath.',
      reply: trackerReply([{ name: 'Breath', set: -50 }]),
      capturedPrompts: prompts,
    });
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(0);
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBeUndefined();

    // An overshooting delta lands on the limit exactly — and the limit
    // still fires.
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'Everything happens at once.',
      reply: trackerReply([{ name: 'Breath', delta: 9999 }]),
      capturedPrompts: prompts,
    });
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(6);
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBe('climax');
  }, 30_000);

  test('an ending clock already at its limit re-asserts the ending on the next turn', async () => {
    const { characterId, sessionId } = await seedWorld('owed-ending', 'score');
    const prompts: string[] = [];
    // The state a lost forced ending leaves behind: the clock stored at
    // its limit, the session still active, no ending written.
    await database.insert(sessionTrackers).values({
      sessionId,
      name: 'Score',
      value: 6,
      limit: 6,
    });

    // A plain turn — no tracker changes at all — re-fires the ending,
    // because the fire is level-triggered, not edge-triggered.
    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'What happens now?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('completed');
    expect(session?.endTime).not.toBeNull();
  }, 30_000);

  test('the audit’s live shape (metadata empty on every row): limit from prose, climax by default', async () => {
    const { characterId, sessionId } = await seedWorld('plain', 'plain');
    const prompts: string[] = [];

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the landing and move on.',
      reply: trackerReply([{ name: 'Plain', set: 5 }]),
      capturedPrompts: prompts,
    });
    expect((await trackerRow(sessionId, 'Plain'))?.value).toBe(5);
    expect((await trackerRow(sessionId, 'Plain'))?.limit).toBe(6);

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We linger until the light changes.',
      reply: trackerReply([{ name: 'Plain', delta: 1 }]),
      capturedPrompts: prompts,
    });
    expect((await trackerRow(sessionId, 'Plain'))?.value).toBe(6);
    // No metadata anywhere: at_limit defaults to climax — the phase
    // flips and the story does NOT end. This is the behaviour production
    // sees first, until the bibles carry at_limit.
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBe('climax');
    expect((await sessionRow(sessionId))?.status).toBe('active');

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'What happens now?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(prompts[prompts.length - 1]).toContain('Plain Clock: 6/6');
    expect(prompts[prompts.length - 1]).toContain('the climax is now');
  }, 30_000);

  test('a declared ending in the same reply as a limit-crossing change wins', async () => {
    const { characterId, sessionId } = await seedWorld('declaration-wins', 'breath');
    const prompts: string[] = [];

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the landing and move on.',
      reply: trackerReply([{ name: 'Breath', set: 5 }]),
      capturedPrompts: prompts,
    });

    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'It ends here, one way or another.',
      reply: {
        ...baseReply,
        campaign_ending: { summary: 'The grove exhales, and the story closes.' },
        tracker_changes: [{ name: 'Breath', delta: 1 }],
      },
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('completed');
    // The completion is the DECLARATION's (its summary is the stored
    // ending), and the tracker change in the same reply never landed —
    // the tracker step found the session already completed.
    const rows = (
      await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId))
    ).filter(
      (row) =>
        row.speakerType === 'system' &&
        (row.context as { intent?: string } | null)?.intent === 'campaign_ending',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain('The grove exhales');
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(5);
  }, 30_000);

  test('the safety net’s required-ending turn can actually complete the session', async () => {
    const { characterId, sessionId } = await seedWorld('safety-net-completes', 'breath');
    const prompts: string[] = [];

    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the last landing.',
      reply: trackerReply([{ name: 'Breath', set: 6 }]),
      capturedPrompts: prompts,
    });
    for (let turn = 1; turn <= 6; turn += 1) {
      await dmTurn({
        sessionId,
        characterId,
        playerInput: `We press on through the climax (turn ${turn}).`,
        reply: { ...baseReply },
        capturedPrompts: prompts,
      });
    }
    expect((await trackerPhase(sessionId))?.tracker?.endingRequired).toBe(true);

    // The one more request, answered with the declaration the prompt
    // required: the session completes through the ordinary ending path.
    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'And then it ends.',
      reply: {
        ...baseReply,
        campaign_ending: { summary: 'At last, the hollow lets them go.' },
      },
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    expect(prompts[prompts.length - 1]).toContain('the ending is required');
    expect((await sessionRow(sessionId))?.status).toBe('completed');
  }, 60_000);

  test('an uncertain prose limit defines no clock: held-rest changes land nothing', async () => {
    const { characterId, sessionId } = await seedWorld('uncertain-limit', 'heldrest');
    const prompts: string[] = [];

    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We play the held rest through.',
      reply: trackerReply([{ name: 'Score', set: 5 }]),
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    // The audit's held-rest rows tie 6 to the Score Clock in a tick row
    // and a compound row, so the prose limit (highest clean reaches: 5)
    // is uncertain and NO clock is defined — the change names an unknown
    // clock, nothing is stored, no climax starts one segment early, and
    // the envelope nulls the unapplied claim. Round 1's parser defined
    // Score at 5 and stored this very change under a climax phase.
    expect(await trackerRow(sessionId, 'Score')).toBeUndefined();
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBeUndefined();
    expect((await sessionRow(sessionId))?.status).toBe('active');
    const envelope = JSON.parse(String(turn.body.text)) as Record<string, unknown>;
    expect(envelope.tracker_changes ?? null).toBeNull();
  }, 30_000);

  /** The session's stored ending rows (the applier's engine lines). */
  const endingRowsFor = async (sessionId: string) =>
    (
      await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId))
    ).filter(
      (row) =>
        row.speakerType === 'system' &&
        (row.context as { intent?: string } | null)?.intent === 'campaign_ending',
    );

  /** Drives a breath-clock session into a tripped safety net (climax + 6 turns). */
  const driveToTrippedNet = async (
    label: string,
  ): Promise<{ characterId: string; sessionId: string; prompts: string[] }> => {
    const world = await seedWorld(label, 'breath');
    const prompts: string[] = [];
    await dmTurn({
      sessionId: world.sessionId,
      characterId: world.characterId,
      playerInput: 'We finish the last landing.',
      reply: trackerReply([{ name: 'Breath', set: 6 }]),
      capturedPrompts: prompts,
    });
    for (let turn = 1; turn <= 6; turn += 1) {
      const { status } = await dmTurn({
        sessionId: world.sessionId,
        characterId: world.characterId,
        playerInput: `We press on through the climax (turn ${turn}).`,
        reply: { ...baseReply },
        capturedPrompts: prompts,
      });
      expect(status).toBe(200);
    }
    expect((await trackerPhase(world.sessionId))?.tracker?.endingRequired).toBe(true);
    expect((await sessionRow(world.sessionId))?.status).toBe('active');
    return { ...world, prompts };
  };

  test('safety net: a DM that never declares still completes — one corrective call, then the engine ending', async () => {
    const { characterId, sessionId, prompts } = await driveToTrippedNet('safety-net-enforced');
    const promptsBefore = prompts.length;

    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'And then?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    // Exactly two generate calls for the turn: the turn itself and the
    // one corrective call with the ending required. The stub declares
    // nothing on either, so the engine-written ending lands.
    const turnPrompts = prompts.slice(promptsBefore);
    expect(turnPrompts).toHaveLength(2);
    expect(turnPrompts[0]).toContain('the ending is required');
    expect(turnPrompts[1]).toContain('<corrective_instruction>');
    expect(turnPrompts[1]).toContain('campaign_ending');
    const session = await sessionRow(sessionId);
    expect(session?.status).toBe('completed');
    expect(session?.endTime).not.toBeNull();
    const rows = await endingRowsFor(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain(
      'Breath Clock reached its limit and the climax ran its course',
    );
    // The envelope carries the stored (engine-written) summary, as a
    // declared ending would leave it.
    const envelope = JSON.parse(String(turn.body.text)) as {
      campaign_ending?: { summary?: string } | null;
    };
    expect(envelope.campaign_ending?.summary).toContain('Breath Clock reached its limit');
  }, 60_000);

  test('safety net: a corrective reply that declares completes with the DM’s own summary', async () => {
    const { characterId, sessionId, prompts } = await driveToTrippedNet('safety-net-corrective');
    const promptsBefore = prompts.length;

    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'And then?',
      reply: { ...baseReply },
      replies: [
        { ...baseReply },
        {
          ...baseReply,
          campaign_ending: { summary: 'The hollow sighs, and lets them go.' },
        },
      ],
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    expect(prompts.slice(promptsBefore)).toHaveLength(2);
    expect((await sessionRow(sessionId))?.status).toBe('completed');
    const rows = await endingRowsFor(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain('The hollow sighs, and lets them go.');
    const envelope = JSON.parse(String(turn.body.text)) as {
      campaign_ending?: { summary?: string } | null;
    };
    expect(envelope.campaign_ending?.summary).toBe('The hollow sighs, and lets them go.');
  }, 60_000);

  test('final beat at Clock 1/6: the flag arms the ending, and the next turn’s net completes the session', async () => {
    const { characterId, sessionId } = await seedWorld('final-beat', 'breath');
    const prompts: string[] = [];

    // Hark N23-003's shape: the climax resolves in prose, the Clock sits
    // at 1/6, and the DM declares no ending — but it flags the final
    // beat. The flag alone arms the ending-required state; nothing ends
    // on this turn.
    const first = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We step into the sundial chamber at last.',
      reply: {
        ...baseReply,
        tracker_changes: [{ name: 'Breath', set: 1 }],
        final_beat_reached: true,
      },
      capturedPrompts: prompts,
    });
    expect(first.status).toBe(200);
    expect((await trackerRow(sessionId, 'Breath'))?.value).toBe(1);
    expect((await sessionRow(sessionId))?.status).toBe('active');
    const armed = (await trackerPhase(sessionId))?.tracker as
      | { endingRequired?: boolean; finalBeat?: boolean }
      | undefined;
    expect(armed?.endingRequired).toBe(true);
    expect(armed?.finalBeat).toBe(true);

    // The next turn runs the same net as the climax limit: its prompt
    // requires the ending, the DM still declares none, so the corrective
    // call fires and the engine-written final-beat ending completes the
    // session. A clock-only net would never have armed here.
    const promptsBefore = prompts.length;
    const second = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'What happens now?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(second.status).toBe(200);
    const turnPrompts = prompts.slice(promptsBefore);
    expect(turnPrompts[0]).toContain('final beat');
    expect(turnPrompts[0]).toContain('the ending is required');
    expect((await sessionRow(sessionId))?.status).toBe('completed');
    const rows = await endingRowsFor(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain('The story reached its final beat');
    const envelope = JSON.parse(String(second.body.text)) as {
      campaign_ending?: { summary?: string } | null;
    };
    expect(envelope.campaign_ending?.summary).toContain('final beat');
  }, 60_000);

  test('safety net: a non-one-shot climax arms the state but never buys a corrective call', async () => {
    // The climax machinery is campaign-agnostic (round 1), so a long
    // campaign's climax trips endingRequired too — but the ending
    // applier completes one-shots only. Without the one-shot gate the
    // route would pay for a corrective generate on every later turn
    // forever, both rungs refusing `not_one_shot` while the armed state
    // never clears.
    const { characterId, sessionId } = await seedWorld('net-non-one-shot', 'breath', 'campaign');
    const prompts: string[] = [];
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the last landing.',
      reply: trackerReply([{ name: 'Breath', set: 6 }]),
      capturedPrompts: prompts,
    });
    for (let turn = 1; turn <= 6; turn += 1) {
      await dmTurn({
        sessionId,
        characterId,
        playerInput: `We press on through the climax (turn ${turn}).`,
        reply: { ...baseReply },
        capturedPrompts: prompts,
      });
    }
    expect((await trackerPhase(sessionId))?.tracker?.endingRequired).toBe(true);

    const promptsBefore = prompts.length;
    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'And then?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    // Exactly one generate call: the turn itself. No corrective call,
    // no forced ending — the session runs on, still armed.
    expect(prompts.slice(promptsBefore)).toHaveLength(1);
    expect((await sessionRow(sessionId))?.status).toBe('active');
    expect(await endingRowsFor(sessionId)).toHaveLength(0);
  }, 60_000);

  test('a non-one-shot climax directive never requires the ending (#1068)', async () => {
    // Same drive as the corrective-call test above, but the assertion is
    // the directive text: a long campaign's climax trips endingRequired
    // too, yet the ending applier completes one-shots only — so the
    // prompt must not tell the DM the ending is required, nor softly
    // instruct it to declare campaign_ending (self-review R2). 'full'
    // is a real wizard-written length, not the synthetic 'campaign'.
    const { characterId, sessionId } = await seedWorld('directive-non-one-shot', 'breath', 'full');
    const prompts: string[] = [];
    await dmTurn({
      sessionId,
      characterId,
      playerInput: 'We finish the last landing.',
      reply: trackerReply([{ name: 'Breath', set: 6 }]),
      capturedPrompts: prompts,
    });
    for (let turn = 1; turn <= 6; turn += 1) {
      await dmTurn({
        sessionId,
        characterId,
        playerInput: `We press on through the climax (turn ${turn}).`,
        reply: { ...baseReply },
        capturedPrompts: prompts,
      });
    }
    expect((await trackerPhase(sessionId))?.tracker?.endingRequired).toBe(true);

    const promptsBefore = prompts.length;
    const turn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'And then?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(turn.status).toBe(200);
    const turnPrompts = prompts.slice(promptsBefore);
    expect(turnPrompts).toHaveLength(1);
    expect(turnPrompts[0]).toContain('in its climax');
    expect(turnPrompts[0]).not.toContain('the ending is required');
    expect(turnPrompts[0]).not.toContain('MUST set campaign_ending');
    expect(turnPrompts[0]).not.toContain('before the ending is required');
    // Scoped to the directive block: the full prompt names the field
    // elsewhere (schema text), but the directive itself must not
    // instruct the DM to declare an ending the engine will refuse.
    const clockBlock = turnPrompts[0].slice(
      turnPrompts[0].indexOf('<story_clock>'),
      turnPrompts[0].indexOf('</story_clock>'),
    );
    expect(clockBlock).toContain('in its climax');
    expect(clockBlock).not.toContain('campaign_ending');
    expect((await sessionRow(sessionId))?.status).toBe('active');
  }, 60_000);

  test('safety net: an in-combat turn defers enforcement; the next story turn enforces it', async () => {
    const { characterId, sessionId, prompts } = await driveToTrippedNet('safety-net-combat');
    const promptsBefore = prompts.length;

    // The required turn lands mid-fight: the net must not force an
    // ending under the combat — and deferral costs nothing, because
    // the armed state persists.
    const combatTurn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'I swing at the hollow’s heart.',
      reply: { ...baseReply },
      capturedPrompts: prompts,
      inCombat: true,
    });
    expect(combatTurn.status).toBe(200);
    expect(prompts.slice(promptsBefore)).toHaveLength(1);
    expect((await sessionRow(sessionId))?.status).toBe('active');
    expect(await endingRowsFor(sessionId)).toHaveLength(0);

    // The first story turn after the fight: the same net fires.
    const storyTurn = await dmTurn({
      sessionId,
      characterId,
      playerInput: 'It is over. What happens now?',
      reply: { ...baseReply },
      capturedPrompts: prompts,
    });
    expect(storyTurn.status).toBe(200);
    expect((await sessionRow(sessionId))?.status).toBe('completed');
    expect(await endingRowsFor(sessionId)).toHaveLength(1);
  }, 60_000);

  test('#1083: a DM that never advances the clock still completes at budget + 6', async () => {
    // The S-004 shape: a stubbed DM that sends no tracker_changes, no
    // final beat and no ending, on a one-shot with a defined clock. The
    // budget (60 player turns) must force what the clock never did.
    const { characterId, sessionId } = await seedWorld('pacing-budget', 'breath');
    const prompts: string[] = [];
    const turn = async (n: number) => {
      const res = await dmTurn({
        sessionId,
        characterId,
        playerInput: `The hollow waits; turn ${n}.`,
        reply: { ...baseReply },
        capturedPrompts: prompts,
      });
      expect(res.status).toBe(200);
    };
    for (let n = 1; n <= 44; n++) await turn(n);
    // Turn 44's prompt carries no pacing line: the directive starts at 75%.
    expect(prompts[43]).not.toContain('move toward the climax');
    expect((await sessionRow(sessionId))?.status).toBe('active');
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBeUndefined();
    await turn(45);
    // Turn 45's prompt carries the pacing directive, server-decided.
    expect(prompts[44]).toContain('move toward the climax');
    expect(prompts[44]).toContain('turn 45 of 60');
    expect(prompts[44]).toContain('the Breath Clock');
    for (let n = 46; n <= 60; n++) await turn(n);
    // Turn 60 forces the climax phase — the clock never moved (0/6).
    const phaseAt60 = (await trackerPhase(sessionId))?.tracker;
    expect(phaseAt60?.phase).toBe('climax');
    expect(phaseAt60?.climaxTurns).toBe(0);
    expect(phaseAt60?.budgetForced).toBe(true);
    expect((await sessionRow(sessionId))?.status).toBe('active');
    for (let n = 61; n <= 66; n++) await turn(n);
    // Six climax turns arm the requirement — the #1053 net, unchanged.
    expect((await trackerPhase(sessionId))?.tracker?.endingRequired).toBe(true);
    expect((await sessionRow(sessionId))?.status).toBe('active');
    // Turn 67: the prompt requires the ending; the stubbed reply declares
    // none, so the corrective call runs and the engine writes the ending.
    await turn(67);
    expect(prompts[66]).toContain('the ending is required');
    expect((await sessionRow(sessionId))?.status).toBe('completed');
    const endings = await endingRowsFor(sessionId);
    expect(endings).toHaveLength(1);
    expect(endings[0]?.message).toContain('turn budget is reached');
  }, 180_000);

  test('#1083: a multi-session campaign runs past 60 turns untouched', async () => {
    // The same clock, the same drifting DM — but the budget is
    // one-shot-only, so a campaign must never see a pacing line, a
    // forced climax, or an ending.
    const { characterId, sessionId } = await seedWorld('pacing-control', 'breath', 'campaign');
    const prompts: string[] = [];
    for (let n = 1; n <= 61; n++) {
      const res = await dmTurn({
        sessionId,
        characterId,
        playerInput: `The hollow waits; turn ${n}.`,
        reply: { ...baseReply },
        capturedPrompts: prompts,
      });
      expect(res.status).toBe(200);
    }
    expect(prompts.some((prompt) => prompt.includes('move toward the climax'))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes('turn budget is reached'))).toBe(false);
    expect((await trackerPhase(sessionId))?.tracker?.phase).toBeUndefined();
    expect((await sessionRow(sessionId))?.status).toBe('active');
    expect(await endingRowsFor(sessionId)).toHaveLength(0);
  }, 180_000);
});
