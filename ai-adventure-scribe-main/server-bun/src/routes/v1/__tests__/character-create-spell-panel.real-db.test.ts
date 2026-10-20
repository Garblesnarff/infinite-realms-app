import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { characters, characterSpellSlots } from '../../../../../db/schema/index';
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

const clientModule = (path: string) => import(`../../../../../src/${path}`);
const { transformCharacterData } = await clientModule('utils/character/data-transformers');
const { toTabSpellSlots } = await clientModule(
  'features/character/components/sheet/tabs/spells/useSpells',
);
const { default: SpellSlotsSection } = await clientModule(
  'features/character/components/sheet/tabs/spells/SpellSlotsSection',
);
const { TooltipProvider } = await clientModule('components/ui/tooltip');

describeWithDb('#900 created caster slots reach the saved sheet', () => {
  let app: any;
  const ids: string[] = [];
  beforeAll(async () => {
    userId = testId('user-900');
    const { createRequestPipelineApp, charactersRoutes } = await importWithRealDb(async () => ({
      ...(await import('../../../http-pipeline.ts')),
      ...(await import('../characters.ts')),
    }));
    app = createRequestPipelineApp().use(charactersRoutes);
  });
  afterAll(async () => {
    for (const id of ids) await realDb().delete(characters).where(eq(characters.id, id));
    await closeRealDb();
  });
  for (const cls of ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Warlock', 'Wizard']) {
    it(`${cls}: engine rows survive POST, GET, hydration and the real slot panel`, async () => {
      const response = await app.handle(
        new Request('http://localhost/v1/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Slots ${cls}`,
            class: cls,
            level: 1,
            race: 'Human',
            stats: {
              strength: 10,
              dexterity: 12,
              constitution: 14,
              intelligence: 15,
              wisdom: 15,
              charisma: 15,
            },
          }),
        }),
      );
      expect(response.status).toBe(201);
      const { id } = await response.json();
      ids.push(id);
      const total = cls === 'Warlock' ? 1 : 2;
      for (const spent of [0, 1]) {
        if (spent)
          await realDb()
            .update(characterSpellSlots)
            .set({ usedSlots: 1 })
            .where(eq(characterSpellSlots.characterId, id));
        const read = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
        expect(read.status).toBe(200);
        const row = await read.json();
        expect(row.spell_slots['1']).toEqual({ max: total, current: total - spent });
        const sheet = transformCharacterData(row, row.stats, null);
        expect(sheet.spellSlots).toEqual({ 1: { max: total, current: total - spent } });
        const slots = toTabSpellSlots(sheet.spellSlots);
        expect(slots).toEqual({ 1: { total, used: spent } });
        const markup = renderToStaticMarkup(
          React.createElement(
            TooltipProvider,
            null,
            React.createElement(SpellSlotsSection, {
              spellSlots: slots,
              longRest: async () => {},
              resting: false,
              restError: null,
            }),
          ),
        );
        expect(markup).toContain(`Level 1`);
        expect(markup.match(/spell slot available/g)?.length ?? 0).toBe(total - spent);
      }
    });
  }
});
