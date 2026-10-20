import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { characters } from '../../../../../db/schema/index';
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
const { halfElf } = await clientModule('data/races/half-elf');
const { transformCharacterData } = await clientModule('utils/character/data-transformers');
const { CharacterPreviewAbilityScores } = await clientModule(
  'components/character-creation/shared/CharacterPreviewAbilityScores',
);

describeWithDb('#897 Half-Elf creation final scores', () => {
  let app: any;
  const ids: string[] = [];
  beforeAll(async () => {
    userId = testId('user-897');
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
  for (const method of ['pointBuy', 'standardArray']) {
    it(`${method}: posts the exact save-hook body and saved sheet matches final preview`, async () => {
      const fixture = JSON.parse(
        readFileSync(
          resolve(
            import.meta.dir,
            `../../../../../shared/test-fixtures/half-elf-${method}-create.json`,
          ),
          'utf8',
        ),
      );
      const character = {
        race: halfElf,
        racialAbilityChoices: { halfElf: fixture.choices },
        abilityScores: Object.fromEntries(
          Object.entries(fixture.base).map(([a, score]) => [
            a,
            { score, modifier: Math.floor((Number(score) - 10) / 2), savingThrow: false },
          ]),
        ),
      };
      const preview = renderToStaticMarkup(
        React.createElement(CharacterPreviewAbilityScores, { character }),
      );
      const response = await app.handle(
        new Request('http://localhost/v1/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fixture.body),
        }),
      );
      expect(response.status).toBe(201);
      const { id } = await response.json();
      ids.push(id);
      const read = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
      expect(read.status).toBe(200);
      const row = await read.json();
      const saved = transformCharacterData(row, row.stats, null);
      for (const [ability, value] of Object.entries(fixture.final)) {
        expect(row.stats[ability]).toBe(value);
        expect(saved.abilityScores[ability].score).toBe(value);
        expect(preview).toMatch(
          new RegExp(`${ability}</span>[\\s\\S]*?font-bold text-sm">${value}</div>`),
        );
      }
    });
  }
});
