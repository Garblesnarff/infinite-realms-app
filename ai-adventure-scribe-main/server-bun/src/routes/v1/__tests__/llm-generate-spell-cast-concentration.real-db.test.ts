/**
 * #709: POST /v1/llm/generate starts concentration when the player's message
 * casts a concentration spell via the sheet's `[spell_id=...]` tag.
 *
 * The DM narrates utility spells (Dancing Lights, Bless) without touching the
 * combat engine, so without this hook no `character_concentration` row exists
 * and later damage never prompts a CON save.
 *
 * Fixtures follow the real producers:
 * - The `[spell_id=dancing-lights, spell_level=cantrip]` tag follows
 *   `buildSpellCastMessage`
 *   (src/features/game-session/components/game/overhaul/spell-view-model.ts).
 * - Spell concentration flags follow the SRD catalog (`resolveCatalogSpell`):
 *   dancing-lights and bless have concentration: true, fire-bolt false.
 * - The session->character link follows `game_sessions.character_id`.
 *
 * The LLM provider is mocked (no live model calls); auth, quota, and the
 * encounter terminal check are mocked; the DB is real (concentration service
 * reads/writes `character_concentration` directly).
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';
import {
  characterConcentration,
  characters,
  gameSessions,
} from '../../../../../db/schema/index';

if (!hasRealDb) {
  console.warn('[llm-generate-spell-cast-concentration] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

const TEST_USER_ID = `conc-llm-user-${process.pid}`;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: TEST_USER_ID, email: 'player@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => ({
      text: 'Your dancing lights drift overhead.',
      provider: 'openrouter',
      model: 'test/model',
    }),
  },
}));
mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getLatestConcludedEncounter: async () => undefined,
    getActiveEncounter: async () => undefined,
  },
}));

import { llmRoutes } from '../llm.js';
import { getConcentration } from '../../../services/combat/concentration-service.js';

describeWithDb('POST /v1/llm/generate spell-cast concentration (#709)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let app: Elysia;
  let characterId: string;
  let sessionId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;
    app = new Elysia().use(llmRoutes);

    const [{ id }] = await db
      .insert(characters)
      .values({ userId: TEST_USER_ID, name: testId('caster'), level: 3 })
      .returning({ id: characters.id });
    characterId = id;

    const [session] = await db
      .insert(gameSessions)
      .values({ characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    sessionId = session.id;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    await closeRealDb();
  });

  async function postGenerate(prompt: string) {
    const res = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: JSON.stringify({
          prompt,
          sessionId,
          model: 'test/model',
          stream: false,
        }),
      }),
    );
    return res;
  }

  it('starts concentration when the prompt carries a concentration spell tag', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const res = await postGenerate(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
    );
    // The turn itself succeeds; concentration is a side effect.
    expect(res.status).toBe(200);
    const state = await getConcentration(characterId);
    expect(state?.spellName).toBe('Dancing Lights');
    expect(state?.spellId).toBe('dancing-lights');
  });

  it('does not start concentration for a non-concentration spell tag', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const res = await postGenerate('I cast Fire Bolt [spell_id=fire-bolt, spell_level=cantrip].');
    expect(res.status).toBe(200);
    expect(await getConcentration(characterId)).toBeNull();
  });

  it('does not start concentration when the prompt has no spell tag', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const res = await postGenerate('I look around the room.');
    expect(res.status).toBe(200);
    expect(await getConcentration(characterId)).toBeNull();
  });
});
