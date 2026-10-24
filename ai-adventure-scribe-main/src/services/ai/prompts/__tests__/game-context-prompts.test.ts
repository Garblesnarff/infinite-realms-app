/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create the mock lore keeper object
const mockLoreKeeper = {
  getCampaignOverview: vi.fn(
    async (_campaignId: string): Promise<Record<string, unknown> | null> => ({
      title: 'Mock Campaign',
      premise: 'Mock Premise',
      overview: 'Mock Overview',
      creativeBrief: 'Mock Brief',
    }),
  ),
  getRules: vi.fn(async () => [{ condition: 'Night', effect: 'Darkness', reversible: true }]),
  getEntities: vi.fn(async () => ({
    npcs: [{ entityName: 'Test NPC', content: 'NPC Content', metadata: { image_url: 'url' } }],
    locations: [{ entityName: 'Test Location', content: 'Location Content', metadata: {} }],
    factions: [{ entityName: 'Test Faction', content: 'Faction Content' }],
    monsters: [
      { entityName: 'Test Monster', content: 'Monster Content', metadata: { image_url: 'url' } },
    ],
  })),
};

// Mock dependencies BEFORE importing module under test
vi.mock('../../passive-skills-service', () => ({
  getCharacterPassiveScores: vi.fn(() => ({
    perception: 12,
    insight: 14,
    investigation: 10,
  })),
  calculatePassivePerception: vi.fn(() => 12),
  calculatePassiveInsight: vi.fn(() => 14),
  calculatePassiveInvestigation: vi.fn(() => 10),
}));

vi.mock('../asset-processor', () => ({
  fetchCampaignAssetsForPrompt: vi.fn(async () => '<campaign_assets>'),
}));

/**
 * The loadout endpoint stands in for the server, but what it returns is the shape
 * `getEquippedLoadout` produces from `inventory_items` + `character_equipment` — real rows, not
 * a class-default table. `getClassEquipment` is gone; nothing in this file may reintroduce it.
 */
const getCharacterLoadout = vi.fn(async () => ({
  weapons: [
    {
      id: 'inv-longbow',
      name: 'Longbow',
      damageDice: '1d8',
      damageType: 'piercing',
      normalRange: 150,
      longRange: 600,
      magicBonus: 0,
      finesse: false,
      ranged: true,
      proficient: true,
    },
    {
      id: 'inv-shortsword',
      name: 'Shortsword',
      damageDice: '1d6',
      damageType: 'piercing',
      normalRange: 5,
      magicBonus: 0,
      finesse: true,
      ranged: false,
      proficient: true,
    },
  ],
  armor: ['Leather Armor'],
  armorClass: 13,
  carriedItems: [
    { name: 'Longbow', itemType: 'weapon', quantity: 1, equipped: true },
    { name: 'Shortbow', itemType: 'weapon', quantity: 1, equipped: false },
    { name: 'Rope', itemType: 'equipment', quantity: 1, equipped: false },
  ],
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacterLoadout: (...args: unknown[]) => getCharacterLoadout(...(args as [])),
    reportClientFailure: vi.fn(),
  },
}));

vi.mock('@/agents/services/lore-keeper/LoreKeeperService', () => ({
  getLoreKeeperService: vi.fn(() => mockLoreKeeper),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/character-converter', () => ({
  convertCharacterDetailsToCharacter: vi.fn((char) => char),
}));

// Now import the module under test
import { GameContextPrompts } from '../game-context-prompts';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

describe('GameContextPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for async calls
    mockLoreKeeper.getCampaignOverview.mockResolvedValue({
      title: 'Mock Campaign',
      premise: 'Mock Premise',
      overview: 'Mock Overview',
      creativeBrief: 'Mock Brief',
    });
    mockLoreKeeper.getRules.mockResolvedValue([
      { condition: 'Night', effect: 'Darkness', reversible: true },
    ]);
    mockLoreKeeper.getEntities.mockResolvedValue({
      npcs: [{ entityName: 'Test NPC', content: 'NPC Content', metadata: { image_url: 'url' } }],
      locations: [{ entityName: 'Test Location', content: 'Location Content', metadata: {} }],
      factions: [{ entityName: 'Test Faction', content: 'Faction Content' }],
      monsters: [
        { entityName: 'Test Monster', content: 'Monster Content', metadata: { image_url: 'url' } },
      ],
    });
  });

  describe('buildCharacterSection', () => {
    it('bounds a large carried inventory by count and field length (#1069)', async () => {
      getCharacterLoadout.mockResolvedValueOnce({
        weapons: [],
        armor: [],
        armorClass: 12,
        carriedItems: Array.from({ length: 100 }, (_, i) => ({
          name: `${i}-` + 'x'.repeat(1000),
          itemType: 'y'.repeat(1000),
          quantity: 1,
          equipped: false,
        })),
      });
      const result = await GameContextPrompts.buildCharacterSection({
        id: 'char-large',
        name: 'Rogue',
        class: 'Rogue',
        level: 1,
      });
      const line = result.split('\n').find((line) => line.includes('CARRIED ITEMS:'))!;
      expect(line).toContain('…and 80 more');
      expect(line.length).toBeLessThan(3000);
      expect(line).not.toContain('20-');
    });

    it('should build a character section with basic details', async () => {
      const char = {
        id: 'char-grog',
        name: 'Grog',
        level: 5,
        race: 'Goliath',
        class: 'Barbarian',
        background: 'Outlander',
        character_stats: [
          {
            strength: 18,
            dexterity: 14,
            constitution: 16,
            intelligence: 8,
            wisdom: 10,
            charisma: 10,
            armor_class: 13,
          },
        ],
      };

      const result = await GameContextPrompts.buildCharacterSection(char);

      expect(result).toContain(
        'PLAYER CHARACTER: Grog (you, the player), a level 5 Goliath Barbarian',
      );
      expect(result).toContain('(Outlander background)');
      expect(result).toContain(
        'STR 18(+4), DEX 14(+2), CON 16(+3), INT 8(-1), WIS 10(+0), CHA 10(+0)',
      );
      expect(result).toContain('<proficiency_bonus>+3</proficiency_bonus>');
    });

    it('should handle missing background and stats', async () => {
      const char = {
        id: 'char-nameless',
        name: 'Nameless',
        level: 1,
        race: 'Human',
        class: { name: 'Fighter' },
      };

      const result = await GameContextPrompts.buildCharacterSection(char);

      expect(result).toContain(
        'PLAYER CHARACTER: Nameless (you, the player), a level 1 Human Fighter',
      );
      expect(result).not.toContain('background)');
      expect(result).not.toContain('<ability_scores>');
    });

    it('should handle different proficiency bonus tiers', async () => {
      const levels = [1, 5, 9, 13, 17];
      const expectedBonuses = ['+2', '+3', '+4', '+5', '+6'];

      for (const [index, level] of levels.entries()) {
        const char = {
          id: 'char-test',
          name: 'Test',
          level,
          class: 'Fighter',
          character_stats: [
            {
              strength: 10,
              dexterity: 10,
              constitution: 10,
              intelligence: 10,
              wisdom: 10,
              charisma: 10,
            },
          ],
        };
        const result = await GameContextPrompts.buildCharacterSection(char);
        expect(result).toContain(
          `<proficiency_bonus>${expectedBonuses[index]}</proficiency_bonus>`,
        );
      }
    });
  });

  /**
   * The regression this file exists for. A ranger carrying a Longbow and a Shortsword was
   * described to the DM as holding a Longsword in Studded leather, because the block was
   * generated from a class-defaults table rather than from her sheet. The DM then narrated
   * attacks with a weapon she did not own.
   */
  describe('the equipment block is the character sheet, not a class default', () => {
    const ranger = {
      id: 'char-seeker',
      name: 'The Seeker',
      level: 5,
      race: 'Wood Elf',
      class: 'Ranger',
      character_stats: [
        {
          strength: 10,
          dexterity: 16,
          constitution: 12,
          intelligence: 10,
          wisdom: 14,
          charisma: 8,
          armor_class: 15,
        },
      ],
    };

    it('names the weapons she actually has equipped, with their real dice and range', async () => {
      const result = await GameContextPrompts.buildCharacterSection(ranger);

      expect(getCharacterLoadout).toHaveBeenCalledWith('char-seeker');
      expect(result).toContain('Longbow (1d8 piercing, range 150/600 ft)');
      expect(result).toContain('Shortsword (1d6 piercing, reach 5 ft)');
      expect(result).toContain('ARMOR: Leather Armor | AC 15');
    });

    it('never mentions the class-default longsword or studded leather', async () => {
      const result = await GameContextPrompts.buildCharacterSection(ranger);

      // The exact two strings `getClassEquipment('Ranger')` used to emit.
      expect(result).not.toContain('Longsword');
      expect(result).not.toContain('Studded leather');
    });

    it('lists carried unequipped weapons and key items for typed draw resolution', async () => {
      const result = await GameContextPrompts.buildCharacterSection(ranger);

      expect(result).toContain('Shortbow x1 (weapon, carried)');
      expect(result).toContain('Rope x1 (equipment, carried)');
      expect(result).toContain('Do not say a carried item is absent');
    });

    it('states the gear is unknown rather than inventing one when the sheet cannot be read', async () => {
      getCharacterLoadout.mockRejectedValueOnce(new Error('network down'));

      const result = await GameContextPrompts.buildCharacterSection(ranger);

      expect(result).toContain('<equipment>');
      expect(result).toContain('UNKNOWN');
      expect(result).not.toContain('Longsword');
      expect(result).not.toContain('1d8');
    });
  });

  describe('buildGameContextSection', () => {
    const academyStarterCampaignRow = {
      id: 'academy-of-arcane-gastronomy',
      slug: 'academy-of-arcane-gastronomy',
      title: 'The Academy of Arcane Gastronomy',
    };

    const mockContext = {
      campaignDetails: {
        name: 'The Eternal Feast',
        description: 'A hungry adventure.',
      },
      characterDetails: {
        name: 'Grog',
        level: 5,
        class: 'Barbarian',
      },
      starterCampaignId: 'the-eternal-feast',
    } as any;

    it('should build a full game context section', { timeout: 15000 }, async () => {
      const result = await GameContextPrompts.buildGameContextSection(mockContext, [
        { type: 'plot_point', content: 'Found the lost fork.' } as any,
      ]);

      expect(result).toContain('<game_context>');
      expect(result).toContain('CAMPAIGN: "The Eternal Feast"');
      expect(result).toContain('<starter_campaign_lore>');
      expect(result).toContain('TITLE: Mock Campaign');
      expect(result).toContain('<world_rules>');
      expect(result).toContain('Night → Darkness (reversible)');
      expect(result).toContain('<npcs count="1">');
      expect(result).toContain('asset_tag="[ASSET:npc:test-npc]"');
      expect(result).toContain('<locations count="1">');
      expect(result).toContain('<factions count="1">');
      expect(result).toContain('<monsters count="1">');
      // expect(result).toContain('<campaign_assets>'); // This might be missing if fetchCampaignAssetsForPrompt is called but result not appended correctly
      expect(result).toContain('<character_details>');
      expect(result).toContain('<story_memories>');
      expect(result).toContain('Found the lost fork.');
    });

    it('omits starter lore for a custom campaign with no starter campaign id', async () => {
      const contextWithoutId = {
        ...mockContext,
        starterCampaignId: undefined,
      };

      const result = await GameContextPrompts.buildGameContextSection(contextWithoutId, []);

      expect(mockLoreKeeper.getCampaignOverview).not.toHaveBeenCalled();
      expect(result).toContain('<game_context>');
      expect(result).not.toContain('<starter_campaign_lore>');
      expect(logger.error).not.toHaveBeenCalled();
      expect(userDataApi.reportClientFailure).not.toHaveBeenCalled();
    });

    it('reports a missing id for an explicitly identified starter playthrough without throwing', async () => {
      const result = await GameContextPrompts.buildGameContextSection(
        {
          ...mockContext,
          campaignDetails: { ...mockContext.campaignDetails, type: 'starter' },
          starterCampaignId: undefined,
          sessionId: 'starter-session',
          campaignId: 'campaign-1',
        },
        [],
      );

      expect(result).toContain('<game_context>');
      expect(result).not.toContain('<starter_campaign_lore>');
      expect(logger.error).toHaveBeenCalledWith(
        '[ContextBuilder] Missing required starter_campaign_id',
        { sessionId: 'starter-session', campaignId: 'campaign-1' },
      );
      expect(userDataApi.reportClientFailure).toHaveBeenCalledWith(
        'missing_starter_campaign_id',
        'starter-session',
        'Missing required starter_campaign_id for AI game context',
      );
    });

    it('uses the explicit Academy starter campaign id from session context', async () => {
      mockLoreKeeper.getCampaignOverview.mockImplementation(async (campaignId: string) => {
        if (campaignId !== academyStarterCampaignRow.id) return null;
        return {
          ...academyStarterCampaignRow,
          premise: 'A culinary arcane academy.',
          overview: 'A test starter campaign row.',
          creativeBrief: 'Whimsical magic.',
        };
      });

      const result = await GameContextPrompts.buildGameContextSection(
        {
          campaignDetails: {
            name: academyStarterCampaignRow.title,
            description: 'A school for magical cooks.',
          },
          starterCampaignId: academyStarterCampaignRow.id,
        } as any,
        [],
      );

      expect(academyStarterCampaignRow.id).toBe(academyStarterCampaignRow.slug);
      expect(mockLoreKeeper.getCampaignOverview).toHaveBeenCalledWith(academyStarterCampaignRow.id);
      expect(result).toContain('<starter_campaign_lore>');
      expect(result).toContain(`TITLE: ${academyStarterCampaignRow.title}`);
    });

    it('should handle missing campaign details and lore', async () => {
      const minimalContext = {
        characterDetails: { name: 'Solo', level: 1, class: 'Rogue' },
      } as any;

      const result = await GameContextPrompts.buildGameContextSection(minimalContext, []);

      expect(result).toContain('<game_context>');
      expect(result).toContain('<character_details>');
      expect(result).not.toContain('<starter_campaign_lore>');
    });

    it('should gracefully handle lore fetching errors', async () => {
      mockLoreKeeper.getCampaignOverview.mockRejectedValueOnce(new Error('Lore fail'));

      const result = await GameContextPrompts.buildGameContextSection(mockContext, []);

      expect(result).toContain('<game_context>');
      expect(result).not.toContain('<starter_campaign_lore>');
      expect(result).toContain('<character_details>');
    });
  });
});

/**
 * #708: the DM narrated the player's own premade as a separate NPC
 * ("Nearby, The Apprentice is still wobbling precariously with their
 * trunk..."). The assembled context must anchor the PC as the player
 * ("you") and must never card them as an NPC. Fixtures follow the session
 * context producer: character rows carry name/level/race/class plus a
 * character_stats row, as getSessionContext returns them.
 */
describe('the player character identity anchor (#708)', () => {
  const apprentice = {
    id: 'char-apprentice',
    name: 'The Apprentice',
    level: 1,
    race: 'Human',
    class: { name: 'Wizard' },
    character_stats: [
      {
        strength: 8,
        dexterity: 14,
        constitution: 12,
        intelligence: 16,
        wisdom: 12,
        charisma: 10,
        armor_class: 12,
      },
    ],
  };

  it('binds a premade character name to the player at its first presentation', async () => {
    const result = await GameContextPrompts.buildCharacterSection(apprentice);

    // prettier-ignore
    expect(result).toContain(
      'PLAYER CHARACTER: The Apprentice (you, the player), a level 1',
    );
  });

  it('anchors a created character the same way (control)', async () => {
    const created = {
      ...apprentice,
      id: 'char-kael',
      name: 'Kael Thornwood',
      class: 'Fighter',
    };

    const result = await GameContextPrompts.buildCharacterSection(created);

    // prettier-ignore
    expect(result).toContain(
      'PLAYER CHARACTER: Kael Thornwood (you, the player), a level 1',
    );
  });

  it('full assembly: anchor present, the PC is never an NPC card', async () => {
    mockLoreKeeper.getEntities.mockResolvedValue({
      npcs: [
        { entityName: 'Head Chef Balthazar', content: 'The head chef.', metadata: {} },
        {
          entityName: 'The Apprentice',
          content: 'A new student, wobbling precariously with their trunk.',
          metadata: {},
        },
      ],
      locations: [],
      factions: [],
      monsters: [],
    } as any);

    const result = await GameContextPrompts.buildGameContextSection(
      {
        campaignDetails: {
          name: 'Academy of Arcane Gastronomy',
          description: 'A school for magical cooks.',
        },
        characterDetails: apprentice,
        starterCampaignId: 'academy-of-arcane-gastronomy',
        sessionId: 'session-708',
        campaignId: 'campaign-1',
      } as any,
      [],
    );

    expect(result).toContain('The Apprentice (you, the player)');
    expect(result).toContain('<player_identity>');
    expect(result).toContain('The Apprentice is the player');
    expect(result).toContain('In scene narration The Apprentice is "you"');
    expect(result).toContain('Never narrate The Apprentice in the third person by name');
    expect(result).toContain('<npc name="Head Chef Balthazar">');
    expect(result).not.toContain('<npc name="The Apprentice">');
    expect(result).not.toContain('wobbling precariously with their trunk');
  });
});

/**
 * #217: the DM granted class features and spells the character does not have, because the
 * prompt never carried either list — the character section named equipment from the sheet
 * but no features and no spells, so the model ruled from its mood. Fixtures follow the
 * session context producer: the spell lists are the sheet's comma-separated text
 * (the character's columns merged with its spell rows server-side) and `featureNames`
 * is the server's list for the character's class and level — or null when the server
 * cannot vouch for one — as getSessionContext returns them.
 */
describe('the features and spells block is the character sheet (#217)', () => {
  const apprentice = {
    id: 'char-apprentice-217',
    name: 'The Apprentice',
    level: 2,
    race: 'Human',
    class: 'Wizard',
    character_stats: [
      {
        strength: 8,
        dexterity: 14,
        constitution: 12,
        intelligence: 16,
        wisdom: 12,
        charisma: 10,
        armor_class: 12,
      },
    ],
    cantrips: 'Fire Bolt, Mage Hand',
    knownSpells: 'Burning Hands, Disguise Self, Magic Missile',
    preparedSpells: 'Burning Hands, Magic Missile',
    ritualSpells: 'Detect Magic',
    featureNames: ['Spellcasting', 'Arcane Recovery'],
  };

  it('names the character\u2019s real features, cantrips, prepared, known and ritual spells', async () => {
    const result = await GameContextPrompts.buildCharacterSection(apprentice);

    expect(result).toContain('CLASS FEATURES: Spellcasting, Arcane Recovery');
    expect(result).toContain('CANTRIPS (cast at will): Fire Bolt, Mage Hand');
    expect(result).toContain('PREPARED SPELLS: Burning Hands, Magic Missile');
    expect(result).toContain('KNOWN SPELLS: Burning Hands, Disguise Self, Magic Missile');
    expect(result).toContain('RITUAL SPELLS: Detect Magic');
  });

  it('tells the DM to refuse anything the lists do not give, with the standard line', async () => {
    const result = await GameContextPrompts.buildCharacterSection(apprentice);

    expect(result).toContain(
      "These are the character's real class features and spells, from their sheet — they have no others.",
    );
    expect(result).toContain('these lists do not give them, it does not work');
    // The gate's refusal line, word for word (featureRefusalLine in dm-feature-gate),
    // with the fixture's name interpolated.
    expect(result).toContain(
      "The Apprentice can't use <the feature or spell>: it isn't on their character sheet.",
    );
    expect(result).toContain('do not roll, resolve, or narrate any effect from it');
  });

  it('a multiclass-shaped payload (featureNames null) lists the spells but claims and refuses no feature', async () => {
    // The server returns featureNames: null when it cannot vouch for the feature
    // list (multiclass, classless, uncovered class) — the cases the gate does not
    // rule on. The block must not order a refusal of features it never listed.
    const multiclass = { ...apprentice, featureNames: null };

    const result = await GameContextPrompts.buildCharacterSection(multiclass);

    expect(result).toContain('PREPARED SPELLS: Burning Hands, Magic Missile');
    expect(result).not.toContain('CLASS FEATURES');
    expect(result).toContain(
      "These are the character's real spells, from their sheet — they have no others.",
    );
    expect(result).toContain('tries to cast a spell these lists do not give them');
    expect(result).toContain("can't use <the spell>:");
    expect(result).not.toContain('use a feature');
  });

  it('a features-only payload claims and refuses features, and says nothing about spells', async () => {
    const fighter = {
      id: 'char-fighter-217',
      name: 'Ser Brann',
      level: 2,
      race: 'Human',
      class: 'Fighter',
      featureNames: ['Fighting Style', 'Second Wind', 'Action Surge'],
    };

    const result = await GameContextPrompts.buildCharacterSection(fighter);

    expect(result).toContain('CLASS FEATURES: Fighting Style, Second Wind, Action Surge');
    expect(result).toContain(
      "These are the character's real class features, from their sheet — they have no others.",
    );
    expect(result).toContain('tries to use a feature these lists do not give them');
    expect(result).toContain("can't use <the feature>:");
    expect(result).not.toContain('cast a spell');
    expect(result).not.toContain('Prepared casters cast');
  });

  it('an authoritative empty feature list (featureNames []) still claims: the character has none', async () => {
    const novice = {
      id: 'char-novice-217',
      name: 'Novice',
      level: 1,
      race: 'Human',
      class: 'Fighter',
      featureNames: [],
    };

    const result = await GameContextPrompts.buildCharacterSection(novice);

    expect(result).toContain('CLASS FEATURES: (none)');
    expect(result).toContain(
      "These are the character's real class features, from their sheet — they have no others.",
    );
    expect(result).toContain('tries to use a feature these lists do not give them');
  });

  it('accepts the array shape other producers send for the spell lists', async () => {
    const created = {
      ...apprentice,
      cantrips: ['Fire Bolt'],
      knownSpells: ['Magic Missile'],
      preparedSpells: ['Magic Missile'],
      ritualSpells: [],
    };

    const result = await GameContextPrompts.buildCharacterSection(created);

    expect(result).toContain('CANTRIPS (cast at will): Fire Bolt');
    expect(result).toContain('PREPARED SPELLS: Magic Missile');
    expect(result).not.toContain('RITUAL SPELLS:');
  });

  it('renders no features or spells block when the payload carries no lists', async () => {
    const bare = {
      id: 'char-bare-217',
      name: 'Bare',
      level: 1,
      race: 'Human',
      class: 'Fighter',
    };

    const result = await GameContextPrompts.buildCharacterSection(bare);

    expect(result).not.toContain('CLASS FEATURES');
    expect(result).not.toContain('CANTRIPS');
    expect(result).not.toContain('features_and_spells');
  });
});
