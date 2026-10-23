/**
 * #1019 Tavo: the subclass row and the granted feature rows exist, and the
 * in-session sheet and the choose-character card still omit them.
 *
 * The fixture follows the producers that already return those rows:
 * - subclass: `GET /v1/class-features/characters/:id/subclass/:className`
 *   returns `{ subclass }` where `subclass` is the `character_subclasses` row
 *   (`SubclassService.getCharacterSubclass`);
 * - features: `GET /v1/class-features/characters/:id/features` returns
 *   `{ features, usesRemaining }` from `getCharacterFeaturesWithUsage`, each
 *   feature joined to `class_features_library` (camelCase, as Drizzle returns it);
 * - the choose-character card reads `starter_character_templates` via
 *   `mapTemplateRow`. The Gardener's Heir seed sets `subclass` to Hunter.
 * The loader, the sheet view model, the right sheet, and the card are the real ones.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CharacterClassFeaturesResponse } from '@/services/class-features-api';
import type { Character } from '@/types/character';

import { StarterCharacterCard } from '@/components/campaigns/StarterCharacterCard';
import { StarterCharacterDetails } from '@/components/campaigns/StarterCharacterDetails';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RightSheet } from '@/features/game-session/components/game/overhaul/RightSheet';
import { buildCharacterSheet } from '@/features/game-session/components/game/overhaul/useOverhaulViewModel';
import { mapTemplateRow } from '@/hooks/use-starter-character-templates';
import { loadCharacterWithSpells } from '@/services/load-character-with-spells';

const { getCharacter, getCharacterEquipment, getCharacterClassFeatures, getCharacterSubclass } =
  vi.hoisted(() => ({
    getCharacter: vi.fn(),
    getCharacterEquipment: vi.fn(),
    getCharacterClassFeatures: vi.fn(),
    getCharacterSubclass: vi.fn(),
  }));

vi.mock('@/services/user-data-api', () => ({ userDataApi: { getCharacter } }));
vi.mock('@/services/issue-1784-api', () => ({ issue1784Api: { getCharacterEquipment } }));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    getCharacterSpells: vi.fn().mockResolvedValue({ cantrips: [], spells: [] }),
  },
}));
vi.mock('@/services/class-features-api', () => ({
  getCharacterClassFeatures,
  getCharacterSubclass,
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CHARACTER_ID = '9cdaf7f9-0000-4000-8000-000000000019';

const TAVO_FEATURES = [
  'Favored Enemy (1 type)',
  'Natural Explorer (1 terrain type)',
  'Fighting Style',
  'Spellcasting: Ranger',
  'Primeval Awareness',
  "Hunter's Prey",
] as const;

/** Joined `character_features` rows, in `acquired_at_level` order. */
function tavoFeatureResponse(): CharacterClassFeaturesResponse {
  return {
    usesRemaining: {},
    features: TAVO_FEATURES.map((featureName, index) => ({
      id: `feat-row-${index}`,
      characterId: CHARACTER_ID,
      featureId: `lib-${index}`,
      usesRemaining: null,
      isActive: true,
      acquiredAtLevel:
        featureName === 'Primeval Awareness' || featureName === "Hunter's Prey"
          ? 3
          : featureName === 'Fighting Style' || featureName === 'Spellcasting: Ranger'
            ? 2
            : 1,
      createdAt: '2026-10-22T02:47:19.000Z',
      feature: {
        id: `lib-${index}`,
        className: 'Ranger',
        subclassName: featureName === "Hunter's Prey" ? 'Hunter' : null,
        featureName,
        levelAcquired:
          featureName === 'Primeval Awareness' || featureName === "Hunter's Prey"
            ? 3
            : featureName === 'Fighting Style' || featureName === 'Spellcasting: Ranger'
              ? 2
              : 1,
        description: featureName,
        mechanicalEffects: null,
        usageType: 'passive',
        usesPerRest: null,
        usesCount: null,
        createdAt: '2026-10-22T02:47:19.000Z',
      },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCharacterEquipment.mockResolvedValue([]);
  getCharacterClassFeatures.mockResolvedValue(tavoFeatureResponse());
  getCharacterSubclass.mockResolvedValue('Hunter');
  getCharacter.mockResolvedValue({
    id: CHARACTER_ID,
    user_id: 'user-1019',
    name: 'Tavo Brejo',
    race: 'Half-Orc',
    class: 'Ranger',
    level: 3,
    background: 'Criminal',
    experience_points: 900,
    cantrips: '',
    known_spells: '',
    prepared_spells: '',
    ritual_spells: '',
    character_stats: [
      {
        strength: 12,
        dexterity: 17,
        constitution: 15,
        intelligence: 10,
        wisdom: 13,
        charisma: 8,
        max_hit_points: 28,
        current_hit_points: 28,
        armor_class: 15,
      },
    ],
  });
});

describe('Tavo shows his subclass and features (#1019)', () => {
  it('puts Hunter and the granted feature names on the in-session sheet', async () => {
    const character = await loadCharacterWithSpells(CHARACTER_ID);
    expect(character).not.toBeNull();
    const sheet = buildCharacterSheet(character as Character);

    expect(sheet.subtitle).toContain('Hunter');
    expect(sheet.features).toEqual([...TAVO_FEATURES]);

    render(<RightSheet c={sheet} />);

    expect(screen.getByText('Half-Orc · Ranger (Hunter)')).toBeInTheDocument();
    for (const name of TAVO_FEATURES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('names Hunter on the choose-character card', () => {
    const template = mapTemplateRow({
      id: 'tpl-tavo',
      starter_campaign_id: 'the-gardeners-heir',
      template_key: 'tavo-brejo',
      name: 'Tavo Brejo',
      tagline: 'Harvested black sap for the Bloomhouse',
      race: 'Half-Orc',
      subrace: null,
      class: 'Ranger',
      subclass: 'Hunter',
      background: 'Criminal',
      level: 3,
      ability_scores: {
        strength: 12,
        dexterity: 17,
        constitution: 15,
        intelligence: 10,
        wisdom: 13,
        charisma: 8,
      },
      personality: {},
      skills: ['deception'],
      languages: ['Common'],
      equipment: [],
      adapted_backstory: null,
      campaign_hook: null,
      portrait_url: null,
      card_image_url: null,
      portrait_prompt: null,
      display_order: 3,
    });

    render(<StarterCharacterCard template={template} isSelected={false} onSelect={vi.fn()} />);
    expect(screen.getByText(/Hunter/)).toBeInTheDocument();

    render(
      <TooltipProvider>
        <StarterCharacterDetails template={template} />
      </TooltipProvider>,
    );
    expect(screen.getAllByText(/Hunter/).length).toBeGreaterThan(0);
  });
});
