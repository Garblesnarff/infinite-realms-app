import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { characters, characterEquipment, inventoryItems } from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
  default: stub(),
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

let app: any;
mock.module('../../../../../src/services/user-data-api', () => ({
  userDataApi: {
    getCharacterLoadout: async (id: string) => {
      const response = await app.handle(
        new Request(`http://localhost/v1/characters/${id}/loadout`),
      );
      expect(response.status).toBe(200);
      return response.json();
    },
  },
}));
const clientModule = (path: string) => import(`../../../../../src/${path}`);
const { CharacterContextPrompts } = await clientModule(
  'services/ai/prompts/character-context-prompts',
);

describeWithDb('carried loadout reaches the real character prompt (#1069)', () => {
  let characterId = '';
  beforeAll(async () => {
    userId = testId('user-carried');
    const { createRequestPipelineApp, loadoutRoutes } = await importWithRealDb(async () => ({
      ...(await import('../../../http-pipeline.ts')),
      ...(await import('../loadout.ts')),
    }));
    app = createRequestPipelineApp().use(loadoutRoutes);
    const [character] = await realDb()
      .insert(characters)
      .values({
        userId,
        name: 'Synthetic Rogue',
        class: 'Rogue',
        race: 'Human',
        level: 1,
      })
      .returning();
    characterId = character!.id;
    await realDb()
      .insert(inventoryItems)
      .values([
        { characterId, name: 'Shortbow', itemType: 'weapon', isEquipped: false },
        { characterId, name: ' Rope ', itemType: 'equipment', quantity: 99 },
      ]);
    await realDb().insert(characterEquipment).values({
      characterId,
      itemName: 'Rope',
      itemType: 'equipment',
      quantity: 1,
      equipped: false,
    });
  });
  afterAll(async () => {
    if (characterId) await realDb().delete(characters).where(eq(characters.id, characterId));
    await closeRealDb();
  });
  it('projects an unequipped inventory Shortbow through the real route into buildCharacterSection', async () => {
    const prompt = await CharacterContextPrompts.buildCharacterSection({
      id: characterId,
      name: 'Synthetic Rogue',
      class: 'Rogue',
      race: 'Human',
      level: 1,
    });
    expect(prompt).toContain('Shortbow x1 (weapon, carried)');
    expect(prompt.match(/Rope/gi)).toHaveLength(1);
    expect(prompt).toContain('Rope x1');
    expect(prompt).not.toContain('x99');
  });
  it('does not expose another owner’s carried items', async () => {
    const owner = userId;
    userId = testId('other-carried');
    try {
      const response = await app.handle(
        new Request(`http://localhost/v1/characters/${characterId}/loadout`),
      );
      expect(response.status).toBe(404);
    } finally {
      userId = owner;
    }
  });
});
