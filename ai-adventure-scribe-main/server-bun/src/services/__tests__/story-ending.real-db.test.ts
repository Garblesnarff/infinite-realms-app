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
              dmReply: { messageId: crypto.randomUUID(), inCombat: false, narrationGated: false },
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
