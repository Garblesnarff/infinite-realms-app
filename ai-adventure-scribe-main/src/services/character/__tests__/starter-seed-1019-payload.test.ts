/**
 * #1019: pins the real premade (starter template) create payloads for the two
 * level-3 heroes Hark's G22-002/010 found feature-less on The Gardener's Heir.
 *
 * Runs the exact producer chain a template pick runs in production:
 * starter_character_templates row -> mapTemplateRow (the selection page's
 * mapper) -> buildStarterCharacterSeed -> prepareCharacterPayload (applied by
 * userDataApi.createCharacter) — and asserts the result equals the committed
 * fixture in shared/test-fixtures/, which the server real-DB suite
 * (character-create-every-class.real-db.test.ts, #1019 block) reads with
 * readFileSync and POSTs through the real POST /v1/characters route. The
 * fixture is a contract, not an output: if the producer chain legitimately
 * changes, regenerate the fixture deliberately in the same commit — this
 * test must never rewrite it.
 *
 * The template rows follow the shipped seed shape (the seed migrations'
 * column set, with the subclass column migration 0028 adds). Ability scores
 * reproduce the issue's arithmetic: Tavo's CON 14 yields the observed 28 HP
 * for a level-3 Ranger; Clarice's CON 14 yields the observed 20 HP and her
 * DEX 12 the observed AC 11 for a level-3 Sorcerer — before Draconic
 * Resilience, which the issue expects to make them 23 and 13 + DEX.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildStarterCharacterSeed } from '../starter-character-seeding';

import { mapTemplateRow } from '@/hooks/use-starter-character-templates';
import { prepareCharacterPayload } from '@/services/user-data-payload-helpers';

const CAMPAIGN_ID = '10191019-0000-4000-8000-000000000000';

/** A starter_character_templates row as SELECT * returns it (snake_case). */
const tavoRow: Record<string, unknown> = {
  id: '1019-tavo-brejo',
  starter_campaign_id: 'the-gardeners-heir',
  template_key: 'tavo-brejo',
  name: 'Tavo Brejo',
  tagline: 'Monster hunter of the garden marches',
  race: 'Human',
  subrace: null,
  class: 'Ranger',
  subclass: 'Hunter',
  background: 'Outlander',
  level: 3,
  ability_scores: {
    strength: 13,
    dexterity: 16,
    constitution: 14,
    intelligence: 10,
    wisdom: 15,
    charisma: 11,
  },
  personality: { traits: [], ideals: [], bonds: [], flaws: [] },
  skills: ['Athletics', 'Perception', 'Stealth', 'Survival'],
  languages: ['Common'],
  equipment: ['longbow', 'quiver with 20 arrows', 'shortsword', 'leather armor', "explorer's pack"],
  adapted_backstory: null,
  campaign_hook: null,
  portrait_url: null,
  card_image_url: null,
  portrait_prompt: null,
  display_order: 1,
};

const clariceRow: Record<string, unknown> = {
  id: '1019-clarice-faro',
  starter_campaign_id: 'the-gardeners-heir',
  template_key: 'clarice-faro',
  name: 'Clarice Faro',
  tagline: 'Draconic blood, garden fire',
  race: 'Human',
  subrace: null,
  class: 'Sorcerer',
  subclass: 'Draconic Bloodline',
  background: 'Sage',
  level: 3,
  ability_scores: {
    strength: 8,
    dexterity: 12,
    constitution: 14,
    intelligence: 11,
    wisdom: 10,
    charisma: 17,
  },
  personality: { traits: [], ideals: [], bonds: [], flaws: [] },
  skills: ['Arcana', 'Insight'],
  languages: ['Common', 'Draconic'],
  equipment: ['dagger', 'dagger', 'light crossbow', 'case with 20 crossbow bolts', "explorer's pack"],
  adapted_backstory: null,
  campaign_hook: null,
  portrait_url: null,
  card_image_url: null,
  portrait_prompt: null,
  display_order: 2,
};

function readCommittedFixture(name: string): Record<string, unknown> {
  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../shared/test-fixtures',
    name,
  );
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
}

describe('premade seed payloads (#1019)', () => {
  it('pins the Tavo Brejo (Ranger/Hunter L3) template payload', () => {
    const template = mapTemplateRow(tavoRow);
    expect(template.subclass).toBe('Hunter');
    const payload = prepareCharacterPayload(buildStarterCharacterSeed(template, CAMPAIGN_ID));
    expect(payload.name).toBe('Tavo Brejo');
    expect(payload.class).toBe('Ranger');
    expect(payload.subclass).toBe('Hunter');
    expect(payload.level).toBe(3);
    expect(payload.stats).toMatchObject({ constitution: 14, dexterity: 16 });
    expect(payload).toEqual(readCommittedFixture('premade-ranger-l3-create-payload.json'));
  });

  it('pins the Clarice Faro (Sorcerer/Draconic Bloodline L3) template payload', () => {
    const template = mapTemplateRow(clariceRow);
    expect(template.subclass).toBe('Draconic Bloodline');
    const payload = prepareCharacterPayload(buildStarterCharacterSeed(template, CAMPAIGN_ID));
    expect(payload.name).toBe('Clarice Faro');
    expect(payload.class).toBe('Sorcerer');
    expect(payload.subclass).toBe('Draconic Bloodline');
    expect(payload.level).toBe(3);
    expect(payload.stats).toMatchObject({ constitution: 14, dexterity: 12 });
    // The seed sends inputs only (#620): no class_features choice JSON, which
    // is what the wizard's Draconic detection reads today. The server suite
    // proves what that omission costs and the fix removes the cost.
    expect(payload.class_features).toBeUndefined();
    expect(payload).toEqual(readCommittedFixture('premade-sorcerer-l3-create-payload.json'));
  });
});
