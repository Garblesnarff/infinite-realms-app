import { describe, expect, it } from 'vitest';

import {
  PREMADE_TEMPLATE_ID,
  PREMADE_TEMPLATE_ROW,
  PREMADE_TYPED_HERO_NAME,
  premadeCreateBody,
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

describe('premade hero name on the wire (#1741)', () => {
  // Same copy the campaign page makes when the player typed a name.
  const typedCopy = { ...template, name: PREMADE_TYPED_HERO_NAME };

  it('sends the typed name in the body the shared fixture describes', () => {
    const payload = buildStarterCharacterSeed(typedCopy, 'campaign-1');
    const { campaign_id: _campaignId, ...wire } = premadeCreateBody(
      PREMADE_TEMPLATE_ID,
      PREMADE_TYPED_HERO_NAME,
    );
    expect(payload).toMatchObject(wire);
    expect(payload.name).toBe(PREMADE_TYPED_HERO_NAME);
  });

  it('leaves the shared template row unchanged when a name is typed', () => {
    buildStarterCharacterSeed(typedCopy, 'campaign-1');
    expect(template.name).toBe('Gate Champion');
    expect(PREMADE_TEMPLATE_ROW.name).toBe('Gate Champion');
  });

  it('keeps the premade title when no name is typed', () => {
    const payload = buildStarterCharacterSeed(template, 'campaign-1');
    expect(payload.name).toBe('Gate Champion');
  });
});
