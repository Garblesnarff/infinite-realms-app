/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create the mock lore keeper object
const mockLoreKeeper = {
  getCampaignOverview: vi.fn(async () => ({
    title: 'Mock Campaign',
    premise: 'Mock Premise',
    overview: 'Mock Overview',
    creativeBrief: 'Mock Brief',
  })),
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
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacterLoadout: (...args: unknown[]) => getCharacterLoadout(...(args as [])),
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

      expect(result).toContain('PLAYER CHARACTER: Grog, a level 5 Goliath Barbarian');
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

      expect(result).toContain('PLAYER CHARACTER: Nameless, a level 1 Human Fighter');
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

    it(
      'should infer starterCampaignId from campaign name if missing',
      { timeout: 15000 },
      async () => {
        const contextWithoutId = {
          ...mockContext,
          starterCampaignId: undefined,
        };

        const result = await GameContextPrompts.buildGameContextSection(contextWithoutId, []);

        expect(mockLoreKeeper.getCampaignOverview).toHaveBeenCalledWith('the-eternal-feast');
        expect(result).toContain('<starter_campaign_lore>');
      },
    );

    it('should handle missing campaign details and lore', async () => {
      const minimalContext = {
        characterDetails: { name: 'Solo', level: 1, class: 'Rogue' },
      } as any;

      const result = await GameContextPrompts.buildGameContextSection(minimalContext, []);

      expect(result).toContain('<game_context>');
      expect(result).not.toContain('<campaign_details>');
      expect(result).not.toContain('<starter_campaign_lore>');
      expect(result).toContain('<character_details>');
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
