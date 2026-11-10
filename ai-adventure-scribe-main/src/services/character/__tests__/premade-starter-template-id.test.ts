import { describe, expect, it } from 'vitest';

import {
  PREMADE_TEMPLATE_ID,
  PREMADE_TEMPLATE_ROW,
} from '../../../../shared/test-fixtures/premade-create-body';
import { buildStarterCharacterSeed } from '../starter-character-seeding';

const template = {
  id: PREMADE_TEMPLATE_ID,
  name: PREMADE_TEMPLATE_ROW.name,
  race: PREMADE_TEMPLATE_ROW.race,
  class: PREMADE_TEMPLATE_ROW.class,
  level: PREMADE_TEMPLATE_ROW.level,
  background: PREMADE_TEMPLATE_ROW.background,
  abilityScores: PREMADE_TEMPLATE_ROW.abilityScores,
  skills: PREMADE_TEMPLATE_ROW.skills,
  languages: PREMADE_TEMPLATE_ROW.languages,
  equipment: [],
};

describe('premade seed names its starter template (#1344)', () => {
  it('sends the template id with the class, race and level the server checks', () => {
    const payload = buildStarterCharacterSeed(template, 'campaign-1');
    expect(payload.starter_template_id).toBe(PREMADE_TEMPLATE_ID);
    expect(payload.class).toBe(PREMADE_TEMPLATE_ROW.class);
    expect(payload.race).toBe(PREMADE_TEMPLATE_ROW.race);
    expect(payload.level).toBe(PREMADE_TEMPLATE_ROW.level);
  });

  it('sends no template id when the template row has none', () => {
    const payload = buildStarterCharacterSeed({ ...template, id: undefined }, 'campaign-1');
    expect(payload).not.toHaveProperty('starter_template_id');
  });
});
