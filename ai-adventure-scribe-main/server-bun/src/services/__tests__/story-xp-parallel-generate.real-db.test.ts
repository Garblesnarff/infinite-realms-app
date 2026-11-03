import { afterAll, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';

process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';
const authModule = await importWithRealDb(() => import('../../lib/auth.js'));
const { LLMProviderService } = await importWithRealDb(() => import('../llm-provider-service.js'));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { llmRoutes } = await importWithRealDb(() => import('../../routes/v1/llm.js'));
const { SessionMessageService } = await importWithRealDb(
  () => import('../session/session-message-service.js'),
);
const dmReplyPersistence = await importWithRealDb(() => import('../dm/dm-reply-persistence.js'));
const { campaigns, characters, characterStats, dialogueHistory, experienceEvents, gameSessions } =
  await importWithRealDb(() => import('../../../../db/schema/index.js'));

describeWithDb('#777 parallel generates for one player message', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('parallel-xp-user');
  let campaignId = '';
  let characterId = '';
  let sessionId = '';
  afterAll(async () => {
    if (!hasRealDb) return;
    if (sessionId) {
      await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
      await db.delete(experienceEvents).where(eq(experienceEvents.sessionId, sessionId));
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    }
    if (characterId) await db.delete(characters).where(eq(characters.id, characterId));
    if (campaignId) await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });
  test('awards XP and posts the engine line once', async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('parallel-xp') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('hero'),
        class: 'Ranger',
        level: 3,
        experiencePoints: 1050,
      })
      .returning({ id: characters.id });
    await db
      .insert(characterStats)
      .values({
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
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const playerInput = 'I reach the Root Stair.';
    await SessionMessageService.addMessages(
      [{ id: crypto.randomUUID(), sessionId, speakerType: 'player', message: playerInput }],
      userId,
    );
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: '', plan: 'tester' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify({
        text: 'The Root Stair winds down.',
        options: ['A. **Descend**.', 'B. **Call out**.'],
        narration_segments: [],
        roll_requests: [],
        combat_transition: 'none',
        combatants: [],
        combat_actions: [],
        map_actions: [],
        handout_actions: [],
        scene_spec: null,
        xp_award: { amount: 50, reason: 'Reached the Root Stair' },
      }),
      provider: 'openrouter',
      model: 't/m',
      usage: { inputTokens: 10, outputTokens: 10 },
    } as never);
    const watchdog = spyOn(dmReplyPersistence, 'scheduleDmReplyWatchdog').mockResolvedValue(
      undefined as never,
    );
    try {
      const app = createRequestPipelineApp().use(llmRoutes);
      const request = () =>
        app.handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: `<player_input>\n${playerInput}\n</player_input>`,
              sessionId,
              player_input: playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: { messageId: crypto.randomUUID(), inCombat: false, narrationGated: false },
              combatEntry: {
                sessionId,
                player: { characterId, name: 'Tavo Brejo', initiativeModifier: 3 },
              },
            }),
          }),
        );
      const responses = await Promise.all([request(), request()]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const [character] = await db.select().from(characters).where(eq(characters.id, characterId));
      expect(character.experiencePoints).toBe(1100);
      expect(
        await db.select().from(experienceEvents).where(eq(experienceEvents.sessionId, sessionId)),
      ).toHaveLength(1);
      const rows = await db
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId));
      expect(
        rows.filter((row) => (row.context as { intent?: string } | null)?.intent === 'story_xp'),
      ).toHaveLength(1);
    } finally {
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
    }
  });
});
