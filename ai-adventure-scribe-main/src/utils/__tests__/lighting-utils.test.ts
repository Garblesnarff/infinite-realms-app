/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  getEffectiveLightLevel,
  calculateLightReach,
  stackLightLevels,
  getLightSourcesAtPosition,
} from '../lighting-utils';

import type { Point2D, VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';

import { TokenType, TokenSize, NameplatePosition, TokenDisposition } from '@/types/token';

describe('lighting utils', () => {
  const createMockToken = (overrides: Partial<Token> = {}): Token => {
    return {
      id: 'token-1',
      sceneId: 'scene-1',
      name: 'Test Token',
      tokenType: TokenType.CHARACTER,
      x: 0,
      y: 0,
      elevation: 0,
      imageUrl: '',
      width: 1,
      height: 1,
      size: TokenSize.MEDIUM,
      scale: 1,
      rotation: 0,
      alpha: 1,
      displayName: true,
      nameplate: NameplatePosition.BOTTOM,
      nameVisibility: 'all',
      displayBars: 'always',
      bar1: { attribute: 'hp', value: 10, max: 10, visible: true },
      vision: { enabled: true, range: 60, angle: 360 },
      light: { emitsLight: false, lightRange: 0, dimLightRange: 0, lightColor: '#ffffff' },
      statusEffects: [],
      conditions: [],
      disposition: TokenDisposition.FRIENDLY,
      lockRotation: false,
      hidden: false,
      locked: false,
      ownerIds: [],
      observerIds: [],
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  };

  describe('getEffectiveLightLevel', () => {
    const position: Point2D = { x: 100, y: 100 }; // ~7.07ft away from (0,0) if 20px per foot

    it('should return bright if global light is enabled', () => {
      expect(getEffectiveLightLevel(position, [], true)).toBe('bright');
    });

    it('should return dark if no light sources are present', () => {
      expect(getEffectiveLightLevel(position, [], false)).toBe('dark');
    });

    it('should skip tokens that do not emit light', () => {
      const token = createMockToken({
        x: 0,
        y: 0,
        light: { emitsLight: false, lightRange: 100, dimLightRange: 100, lightColor: '#ffffff' },
      });
      expect(getEffectiveLightLevel(position, [token], false)).toBe('dark');
    });

    it('should return bright if position is within bright light range', () => {
      const token = createMockToken({
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 10, dimLightRange: 10, lightColor: '#ffffff' },
      });
      // distance = sqrt(100^2 + 100^2) = 141.4px
      // distanceInFeet = 141.4 / 20 = 7.07ft
      // 7.07 <= 10, so bright
      expect(getEffectiveLightLevel(position, [token], false)).toBe('bright');
    });

    it('should return dim if position is within dim light range but not bright range', () => {
      const token = createMockToken({
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 5, dimLightRange: 10, lightColor: '#ffffff' },
      });
      // distanceInFeet = 7.07ft
      // 7.07 > 5 (not bright), but 7.07 <= 5 + 10 = 15 (dim)
      expect(getEffectiveLightLevel(position, [token], false)).toBe('dim');
    });

    it('should prioritize bright light over dim light from different sources', () => {
      const tokenDim = createMockToken({
        id: 'dim',
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 5, dimLightRange: 10, lightColor: '#ffffff' },
      });
      const tokenBright = createMockToken({
        id: 'bright',
        x: 80,
        y: 80,
        light: { emitsLight: true, lightRange: 10, dimLightRange: 10, lightColor: '#ffffff' },
      });
      // tokenDim gives 'dim' at (100,100)
      // tokenBright gives 'bright' at (100,100)
      expect(getEffectiveLightLevel(position, [tokenDim, tokenBright], false)).toBe('bright');
    });
  });

  describe('calculateLightReach', () => {
    const target: Point2D = { x: 100, y: 100 };

    it('should return reaches: false if token does not emit light', () => {
      const token = createMockToken({
        light: { emitsLight: false, lightRange: 10, lightColor: '#ffffff' },
      });
      const result = calculateLightReach(token, target);
      expect(result.reaches).toBe(false);
    });

    it('should return reaches: false if target is beyond total range', () => {
      const token = createMockToken({
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 2, dimLightRange: 2, lightColor: '#ffffff' },
      });
      // distanceInFeet = 7.07ft, total range = 4ft
      const result = calculateLightReach(token, target);
      expect(result.reaches).toBe(false);
    });

    it('should return reaches: false if light is blocked by a wall', () => {
      const token = createMockToken({
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 20, dimLightRange: 20, lightColor: '#ffffff' },
      });
      const walls: VisionBlocker[] = [
        {
          id: 'w1',
          points: [
            { x: 50, y: 0 },
            { x: 50, y: 200 },
          ],
          blocksLight: true,
          blocksMovement: true,
        },
      ];
      const result = calculateLightReach(token, target, walls);
      expect(result.reaches).toBe(false);
    });

    it('should return reaches: true and level: bright if within bright range', () => {
      const token = createMockToken({
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 10, lightColor: '#ffffff' },
      });
      const result = calculateLightReach(token, target);
      expect(result.reaches).toBe(true);
      expect(result.level).toBe('bright');
    });

    it('should handle missing dimLightRange in calculateLightReach', () => {
      const token = createMockToken({
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 5, lightColor: '#ffffff' },
      } as any); // Force missing dimLightRange
      const result = calculateLightReach(token, target);
      // distanceInFeet = 7.07, total range = 5 + 0 = 5
      expect(result.reaches).toBe(false);
    });
  });

  describe('stackLightLevels', () => {
    it('should return bright if any level is bright', () => {
      expect(stackLightLevels(['dark', 'dim', 'bright'])).toBe('bright');
    });

    it('should return dim if no bright but has dim', () => {
      expect(stackLightLevels(['dark', 'dim', 'dark'])).toBe('dim');
    });

    it('should return dark if all are dark', () => {
      expect(stackLightLevels(['dark', 'dark'])).toBe('dark');
    });
  });

  describe('getLightSourcesAtPosition', () => {
    it('should return all tokens whose light reaches the position', () => {
      const position: Point2D = { x: 100, y: 100 };
      const token1 = createMockToken({
        id: 't1',
        x: 0,
        y: 0,
        light: { emitsLight: true, lightRange: 10, lightColor: '#ffffff' },
      });
      const token2 = createMockToken({
        id: 't2',
        x: 200,
        y: 200,
        light: { emitsLight: true, lightRange: 10, lightColor: '#ffffff' },
      });
      const token3 = createMockToken({
        id: 't3',
        x: 0,
        y: 0,
        light: { emitsLight: false, lightRange: 10, lightColor: '#ffffff' },
      });

      const sources = getLightSourcesAtPosition(position, [token1, token2, token3]);
      expect(sources).toHaveLength(2);
      expect(sources.map((s) => s.token.id)).toContain('t1');
      expect(sources.map((s) => s.token.id)).toContain('t2');
    });
  });
});
