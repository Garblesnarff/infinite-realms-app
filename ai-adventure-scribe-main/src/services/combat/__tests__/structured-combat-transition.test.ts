/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion, max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildStructuredCombatStartPayload,
  startStructuredCombatTransition,
} from '../structured-combat-transition';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    startStructuredCombat: vi.fn(),
  },
}));

describe('structured-combat-transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildStructuredCombatStartPayload', () => {
    const defaultCharacter = {
      id: 'char-123',
      name: 'Gimli',
      currentHitPoints: 35,
      maxHitPoints: 40,
      abilityScores: {
        dexterity: {
          score: 14,
          modifier: 2,
        },
      },
    };

    const defaultResponse = {
      combat_transition: 'start' as const,
      scene_spec: { map_id: 'dungeon-1' },
      combatants: [
        {
          name: 'Orc',
          count: 2,
          monster_id: 'srd:orc',
        },
      ],
    };

    it('should return null if combat_transition is not "start"', () => {
      const response = {
        ...defaultResponse,
        combat_transition: 'end' as any,
      };
      const result = buildStructuredCombatStartPayload(defaultCharacter, response);
      expect(result).toBeNull();
    });

    it('should return null if scene_spec is missing', () => {
      const response = {
        ...defaultResponse,
        scene_spec: undefined,
      };
      const result = buildStructuredCombatStartPayload(defaultCharacter, response);
      expect(result).toBeNull();
    });

    it('should build payload with player and expanded combatants correctly', () => {
      const result = buildStructuredCombatStartPayload(defaultCharacter, defaultResponse);

      expect(result).not.toBeNull();
      expect(result!.sceneSpec).toEqual({ map_id: 'dungeon-1' });
      expect(result!.participants).toHaveLength(3); // Gymli + Orc 1 + Orc 2

      // Gimli verification
      expect(result!.participants[0]).toEqual({
        encounterId: '',
        characterId: 'char-123',
        name: 'Gimli',
        initiativeModifier: 2,
        hpCurrent: 35,
        hpMax: 40,
      });

      // Orc 1 & 2 verification
      expect(result!.participants[1]).toEqual({
        encounterId: '',
        name: 'Orc 1',
        initiativeModifier: 0,
        monsterId: 'srd:orc',
      });
      expect(result!.participants[2]).toEqual({
        encounterId: '',
        name: 'Orc 2',
        initiativeModifier: 0,
        monsterId: 'srd:orc',
      });
    });

    it('should fallback to player name "Player" and default HP to empty when negative or zero', () => {
      const charWithoutNameOrHP = {
        id: 'char-123',
        currentHitPoints: 0,
        maxHitPoints: -5,
      };
      const response = {
        ...defaultResponse,
        combatants: [],
      };

      const result = buildStructuredCombatStartPayload(charWithoutNameOrHP, response);
      expect(result).not.toBeNull();
      expect(result!.participants[0]).toEqual({
        encounterId: '',
        characterId: 'char-123',
        name: 'Player',
        initiativeModifier: 0,
      });
    });

    it('should support snake_case fields for character health and ability scores', () => {
      const snakeChar = {
        id: 'char-456',
        name: 'Legolas',
        current_hit_points: 25,
        max_hit_points: 30,
        ability_scores: {
          dexterity: {
            modifier: 3,
          },
        },
      };

      const result = buildStructuredCombatStartPayload(snakeChar, defaultResponse);
      expect(result!.participants[0]).toEqual({
        encounterId: '',
        characterId: 'char-456',
        name: 'Legolas',
        initiativeModifier: 3,
        hpCurrent: 25,
        hpMax: 30,
      });
    });

    it('should return initiativeModifier 0 if dexterity modifier is missing or not a finite number', () => {
      const badChar1 = {
        ...defaultCharacter,
        abilityScores: { dexterity: { modifier: 'foo' as any } },
      };
      const badChar2 = {
        ...defaultCharacter,
        abilityScores: { dexterity: {} },
      };
      const badChar3 = {
        ...defaultCharacter,
        abilityScores: {},
      };

      expect(buildStructuredCombatStartPayload(badChar1, defaultResponse)!.participants[0].initiativeModifier).toBe(0);
      expect(buildStructuredCombatStartPayload(badChar2, defaultResponse)!.participants[0].initiativeModifier).toBe(0);
      expect(buildStructuredCombatStartPayload(badChar3, defaultResponse)!.participants[0].initiativeModifier).toBe(0);
    });

    it('should clamp combatant count to at least 1 and handle non-integer/fractional counts', () => {
      const response = {
        ...defaultResponse,
        combatants: [
          { name: 'Goblin', count: 0, monster_id: 'srd:goblin' },
          { name: 'Skeleton', count: -3, monster_id: 'srd:skeleton' },
          { name: 'Zombie', count: 2.7, monster_id: 'srd:zombie' },
        ],
      };

      const result = buildStructuredCombatStartPayload(defaultCharacter, response);
      const participantNames = result!.participants.map((p) => p.name);

      // Gimli + Goblin 1 + Skeleton 1 + Zombie 1 + Zombie 2 (2.7 floored is 2)
      expect(participantNames).toEqual([
        'Gimli',
        'Goblin',
        'Skeleton',
        'Zombie 1',
        'Zombie 2',
      ]);
    });

    it('should omit monsterId if empty or whitespace-only', () => {
      const response = {
        ...defaultResponse,
        combatants: [
          { name: 'Slime', count: 1, monster_id: '' },
          { name: 'Ghost', count: 1, monster_id: '   ' },
        ],
      };

      const result = buildStructuredCombatStartPayload(defaultCharacter, response);
      expect(result!.participants[1].monsterId).toBeUndefined();
      expect(result!.participants[2].monsterId).toBeUndefined();
    });
  });

  describe('startStructuredCombatTransition', () => {
    const character = { id: 'char-123', name: 'Gimli' };
    const response = {
      combat_transition: 'start' as const,
      scene_spec: { map_id: 'dungeon-1' },
      combatants: [],
    };

    it('should format payload and call userDataApi.startStructuredCombat on start transition', async () => {
      const mockApiResponse = { status: 200 } as Response;
      vi.mocked(userDataApi.startStructuredCombat).mockResolvedValue(mockApiResponse);

      const result = await startStructuredCombatTransition('session-456', character, response);

      expect(userDataApi.startStructuredCombat).toHaveBeenCalledTimes(1);
      expect(userDataApi.startStructuredCombat).toHaveBeenCalledWith(
        'session-456',
        expect.objectContaining({
          participants: [
            {
              encounterId: '',
              characterId: 'char-123',
              name: 'Gimli',
              initiativeModifier: 0,
            },
          ],
          sceneSpec: { map_id: 'dungeon-1' },
        })
      );
      expect(result).toBe(mockApiResponse);
    });

    it('should return null and not call API if payload cannot be built', async () => {
      const badResponse = {
        combat_transition: 'end' as any,
        scene_spec: null,
      };

      const result = await startStructuredCombatTransition('session-456', character, badResponse);

      expect(userDataApi.startStructuredCombat).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
