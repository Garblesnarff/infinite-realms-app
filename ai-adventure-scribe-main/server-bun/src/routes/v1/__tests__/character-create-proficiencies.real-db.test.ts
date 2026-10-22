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

// The server typecheck uses a server-only @ alias. Load client producers at runtime
// so this integration test exercises them without compiling them as server modules.
const clientModule = (path: string) => import(`../../../../../src/${path}`);
const { fighter } = await clientModule('data/classes/fighter');
const { rogue } = await clientModule('data/classes/rogue');
const { transformCharacterForStorage } = await clientModule('types/character');
const { prepareCharacterPayload } = await clientModule('services/user-data-payload-helpers');
const { transformCharacterData } = await clientModule('utils/character/data-transformers');
const { FeaturesProficienciesCard } = await clientModule(
  'features/character/components/sheet/tabs/FeaturesProficienciesCard',
);
const { default: AbilitiesTab } = await clientModule(
  'features/character/components/sheet/tabs/AbilitiesTab',
);

mock.module('../../../../../src/components/ui/dice-roller', () => ({
  default: ({ label, modifier }: { label: string; modifier: number }) =>
    React.createElement('span', { 'data-roll': label, 'data-modifier': modifier }),
}));

const scores = {
  strength: 16,
  dexterity: 14,
  constitution: 12,
  intelligence: 10,
  wisdom: 8,
  charisma: 15,
};
const skills: Record<string, keyof typeof scores> = {
  Acrobatics: 'dexterity',
  'Animal Handling': 'wisdom',
  Arcana: 'intelligence',
  Athletics: 'strength',
  Deception: 'charisma',
  History: 'intelligence',
  Insight: 'wisdom',
  Intimidation: 'charisma',
  Investigation: 'intelligence',
  Medicine: 'wisdom',
  Nature: 'intelligence',
  Perception: 'wisdom',
  Performance: 'charisma',
  Persuasion: 'charisma',
  Religion: 'intelligence',
  'Sleight of Hand': 'dexterity',
  Stealth: 'dexterity',
  Survival: 'wisdom',
};

describeWithDb('#898 creation to saved sheet proficiency', () => {
  let app: any;
  const ids: string[] = [];
  beforeAll(async () => {
    userId = testId('user-898');
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
  for (const cls of [fighter, rogue]) {
    it(`creates ${cls.name} and checks all 18 skills and 6 saves on the actual sheet`, async () => {
      const selected =
        cls.id === 'fighter'
          ? ['Insight', 'Religion', 'Athletics', 'Perception']
          : ['Insight', 'Religion', 'Acrobatics', 'Perception', 'Stealth', 'Deception'];
      const expertise = cls.id === 'rogue' ? ['Insight', 'Stealth'] : [];
      const wizard = {
        name: `Chosen ${cls.name}`,
        class: cls,
        level: 1,
        skillProficiencies: selected,
        expertiseProficiencies: expertise,
        savingThrowProficiencies: cls.savingThrowProficiencies,
        toolProficiencies: cls.toolProficiencies,
        abilityScores: Object.fromEntries(
          Object.entries(scores).map(([key, score]) => [
            key,
            { score, modifier: Math.floor((score - 10) / 2), savingThrow: false },
          ]),
        ),
      };
      const body = prepareCharacterPayload({
        ...transformCharacterForStorage(wizard),
        stats: scores,
      });
      const created = await app.handle(
        new Request('http://localhost/v1/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      expect(created.status).toBe(201);
      const { id } = await created.json();
      ids.push(id);
      const response = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
      expect(response.status).toBe(200);
      const row = await response.json();
      expect(row.skill_proficiencies).toBe(selected.join(','));
      expect(row.expertise_proficiencies).toBe(expertise.join(','));
      expect(row.saving_throw_proficiencies).toBe(cls.savingThrowProficiencies.join(','));
      const hydrated = transformCharacterData(row, row.stats, null);
      const markup = renderToStaticMarkup(
        React.createElement(AbilitiesTab, { character: hydrated, onUpdate: () => {} }),
      );
      for (const [skill, ability] of Object.entries(skills)) {
        const bonus =
          Math.floor((scores[ability] - 10) / 2) +
          (selected.includes(skill) ? (expertise.includes(skill) ? 4 : 2) : 0);
        expect(markup).toContain(`data-roll="${skill}" data-modifier="${bonus}"`);
      }
      for (const ability of Object.keys(scores) as Array<keyof typeof scores>) {
        const bonus =
          Math.floor((scores[ability] - 10) / 2) +
          (cls.savingThrowProficiencies.includes(ability) ? 2 : 0);
        expect(markup).toContain(
          `data-roll="${ability.slice(0, 3).toUpperCase()} Save" data-modifier="${bonus}"`,
        );
      }
    });
  }
  it('#899 posts the pinned real wizard choices and renders them after DB reload', async () => {
    const body = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dir,
          '../../../../../shared/test-fixtures/half-elf-899-choices-create.json',
        ),
        'utf8',
      ),
    );
    const created = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = await created.json();
    ids.push(id);
    const response = await app.handle(new Request(`http://localhost/v1/characters/${id}`));
    expect(response.status).toBe(200);
    const row = await response.json();
    expect(row.skill_proficiencies.split(',')).toEqual(
      expect.arrayContaining([
        'Arcana',
        'Medicine',
        'Perception',
        'History',
        'Athletics',
        'Survival',
      ]),
    );
    expect(row.languages).toEqual(['Common', 'Elvish', 'Draconic', 'Dwarvish']);
    const hydrated = transformCharacterData(row, row.stats, null);
    const skillsMarkup = renderToStaticMarkup(
      React.createElement(AbilitiesTab, { character: hydrated, onUpdate: () => {} }),
    );
    expect(skillsMarkup).toContain('data-roll="Arcana" data-modifier="2"');
    expect(skillsMarkup).toContain('data-roll="Medicine" data-modifier="2"');
    const markup = renderToStaticMarkup(
      React.createElement(FeaturesProficienciesCard, { character: hydrated }),
    );
    expect(markup).toContain('Draconic');
    expect(markup).toContain('Dwarvish');
    expect(markup).not.toContain('language of your choice');
  });
});
