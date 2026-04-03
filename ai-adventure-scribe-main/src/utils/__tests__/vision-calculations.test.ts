/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as geometry from '../geometry';
import * as lightingUtils from '../lighting-utils';
import {
  calculateVisionRadius,
  getActiveVisionType,
  canSeeToken,
  getVisionColor,
  getVisionOpacity,
} from '../vision-calculations';

import type { Token } from '@/types/token';

import { TokenType, TokenSize, NameplatePosition, TokenDisposition } from '@/types/token';

// Mock geometry and lighting utilities
vi.mock('../geometry', () => ({
  calculateDistance: vi.fn(),
  isLineBlocked: vi.fn(),
  isPointInVisionCone: vi.fn(),
}));

vi.mock('../lighting-utils', () => ({
  getEffectiveLightLevel: vi.fn(),
}));

describe('vision-calculations', () => {
  const createMockToken = (overrides: any = {}): Token =>
    ({
      id: 'token-1',
      sceneId: 'scene-1',
      name: 'Test Token',
      tokenType: TokenType.CHARACTER,
      x: 100,
      y: 100,
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
      vision: {
        enabled: true,
        range: 60,
        angle: 360,
        visionMode: 'basic',
      },
      light: {
        emitsLight: false,
        lightRange: 0,
        lightColor: '#ffffff',
      },
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
    }) as any as Token;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lightingUtils.getEffectiveLightLevel).mockReturnValue('bright');
  });

  describe('calculateVisionRadius', () => {
    it('should return 0 if vision is disabled', () => {
      const token = createMockToken({ vision: { enabled: false, range: 60, angle: 360 } });
      expect(calculateVisionRadius(token)).toBe(0);
    });

    it('should return base range for basic vision', () => {
      const token = createMockToken({ vision: { enabled: true, range: 60, angle: 360 } });
      expect(calculateVisionRadius(token)).toBe(60);
    });

    it('should return max of all vision types', () => {
      const token = createMockToken({
        vision: {
          enabled: true,
          range: 30,
          truesight: 60,
          blindsight: 10,
          tremorsense: 40,
          darkvision: 120,
          angle: 360,
        },
      });
      expect(calculateVisionRadius(token)).toBe(120);
    });

    it('should return 0 if no range is specified', () => {
      const token = createMockToken({ vision: { enabled: true, angle: 360 } });
      expect(calculateVisionRadius(token)).toBe(0);
    });
  });

  describe('getActiveVisionType', () => {
    it('should prioritize truesight', () => {
      const token = createMockToken({
        vision: {
          enabled: true,
          truesight: 60,
          blindsight: 30,
          tremorsense: 30,
          darkvision: 30,
          visionMode: 'basic',
        },
      });
      expect(getActiveVisionType(token, 'bright')).toBe('truesight');
    });

    it('should prioritize blindsight over others except truesight', () => {
      const token = createMockToken({
        vision: {
          enabled: true,
          blindsight: 30,
          tremorsense: 30,
          darkvision: 30,
          visionMode: 'basic',
        },
      });
      expect(getActiveVisionType(token, 'bright')).toBe('blindsight');
    });

    it('should use tremorsense if others are missing', () => {
      const token = createMockToken({
        vision: { enabled: true, tremorsense: 30, darkvision: 30, visionMode: 'basic' },
      });
      expect(getActiveVisionType(token, 'bright')).toBe('tremorsense');
    });

    it('should use darkvision in dim or dark light', () => {
      const token = createMockToken({
        vision: { enabled: true, darkvision: 60, visionMode: 'basic' },
      });
      expect(getActiveVisionType(token, 'dim')).toBe('darkvision');
      expect(getActiveVisionType(token, 'dark')).toBe('darkvision');
      expect(getActiveVisionType(token, 'bright')).toBe('basic');
    });

    it('should return basic if no special vision applies', () => {
      const token = createMockToken({ vision: { enabled: true, range: 60, visionMode: 'basic' } });
      expect(getActiveVisionType(token, 'bright')).toBe('basic');
    });
  });

  describe('canSeeToken', () => {
    const viewer = createMockToken({ id: 'viewer', x: 0, y: 0 });
    const target = createMockToken({ id: 'target', x: 100, y: 100 });

    it('should return false if viewer vision is disabled', () => {
      const disabledViewer = { ...viewer, vision: { ...viewer.vision, enabled: false } };
      expect(canSeeToken(disabledViewer as any, target)).toBe(false);
    });

    it('should return false if target is out of range', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(2000); // 100ft
      const limitedViewer = { ...viewer, vision: { ...viewer.vision, range: 60 } };
      expect(canSeeToken(limitedViewer as any, target)).toBe(false);
    });

    it('should return false if target is outside vision cone', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(100); // 5ft
      const coneViewer = { ...viewer, vision: { ...viewer.vision, angle: 90 } };
      vi.mocked(geometry.isPointInVisionCone).mockReturnValue(false);
      expect(canSeeToken(coneViewer as any, target)).toBe(false);
      expect(geometry.isPointInVisionCone).toHaveBeenCalled();
    });

    it('should handle blindsight ignoring soft walls', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(100); // 5ft
      const blindsightViewer = createMockToken({
        vision: { enabled: true, blindsight: 30, visionMode: 'blindsight' },
      });
      const walls = [
        { id: 'w1', points: [], blocksLight: true, blocksMovement: false }, // Soft wall (e.g. curtain)
        { id: 'w2', points: [], blocksLight: true, blocksMovement: true }, // Hard wall
      ] as any[];

      vi.mocked(geometry.isLineBlocked).mockReturnValue(false); // Not blocked by hard wall

      expect(canSeeToken(blindsightViewer as any, target, walls)).toBe(true);
      // Should have filtered walls to only hard ones
      expect(geometry.isLineBlocked).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ id: 'w2' })]),
      );
      expect(vi.mocked(geometry.isLineBlocked).mock.calls[0][2]).toHaveLength(1);
    });

    it('should handle truesight ignoring soft walls', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(100); // 5ft
      const truesightViewer = createMockToken({
        vision: { enabled: true, truesight: 60, visionMode: 'truesight' },
      });
      const walls = [
        { id: 'w1', points: [], blocksLight: true, blocksMovement: false },
        { id: 'w2', points: [], blocksLight: true, blocksMovement: true },
      ] as any[];

      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);

      expect(canSeeToken(truesightViewer as any, target, walls)).toBe(true);
      expect(vi.mocked(geometry.isLineBlocked).mock.calls[0][2]).toHaveLength(1);
    });

    it('should handle tremorsense ignoring walls on same elevation', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(100); // 5ft
      vi.mocked(geometry.isLineBlocked).mockReturnValue(true); // Line is blocked
      const tremorsenseViewer = createMockToken({
        vision: { enabled: true, tremorsense: 30, visionMode: 'tremorsense' },
        elevation: 0,
      });
      const targetSameElevation = createMockToken({ x: 100, y: 100, elevation: 0 });
      const targetDiffElevation = createMockToken({ x: 100, y: 100, elevation: 10 });

      // Should see target on same elevation even with walls
      expect(
        canSeeToken(tremorsenseViewer as any, targetSameElevation, [{ id: 'w1' } as any]),
      ).toBe(true);

      // Should NOT see target on different elevation if walls block it (it's not tremorsense anymore)
      expect(
        canSeeToken(tremorsenseViewer as any, targetDiffElevation, [{ id: 'w1' } as any]),
      ).toBe(false);
    });

    it('should return false if line of sight is blocked by walls', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(100);
      vi.mocked(geometry.isLineBlocked).mockReturnValue(true);
      expect(canSeeToken(viewer, target, [{ id: 'w1' } as any])).toBe(false);
    });

    it('should return false if basic vision is in dark light', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(100);
      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);
      vi.mocked(lightingUtils.getEffectiveLightLevel).mockReturnValue('dark');

      expect(canSeeToken(viewer, target)).toBe(false);
    });

    it('should return false if tremorsense mode is in dark light and outside tremorsense range and has no darkvision', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(1000); // 50ft
      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);
      vi.mocked(lightingUtils.getEffectiveLightLevel).mockReturnValue('dark');

      const tremorsenseViewer = createMockToken({
        vision: {
          enabled: true,
          range: 60,
          tremorsense: 30,
          visionMode: 'tremorsense',
          darkvision: 0,
        },
      });

      expect(canSeeToken(tremorsenseViewer as any, target)).toBe(false);
    });

    it('should return true if outside special vision range but inside darkvision range in darkness', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(800); // 40ft
      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);
      vi.mocked(lightingUtils.getEffectiveLightLevel).mockReturnValue('dark');

      const multiVisionViewer = createMockToken({
        vision: {
          enabled: true,
          range: 120,
          blindsight: 30,
          darkvision: 60,
          visionMode: 'blindsight',
        },
      });

      // Outside blindsight (30ft) but inside darkvision (60ft)
      expect(canSeeToken(multiVisionViewer as any, target)).toBe(true);
    });

    it('should return false if outside both special vision range and darkvision range in darkness', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(1600); // 80ft
      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);
      vi.mocked(lightingUtils.getEffectiveLightLevel).mockReturnValue('dark');

      const multiVisionViewer = createMockToken({
        vision: {
          enabled: true,
          range: 120,
          blindsight: 30,
          darkvision: 60,
          visionMode: 'blindsight',
        },
      });

      expect(canSeeToken(multiVisionViewer as any, target)).toBe(false);
    });

    it('should return true if everything matches', () => {
      vi.mocked(geometry.calculateDistance).mockReturnValue(100);
      vi.mocked(geometry.isLineBlocked).mockReturnValue(false);
      vi.mocked(lightingUtils.getEffectiveLightLevel).mockReturnValue('bright');

      expect(canSeeToken(viewer, target)).toBe(true);
    });
  });

  describe('getVisionColor', () => {
    it('should return correct colors for vision modes', () => {
      expect(getVisionColor('basic')).toBe('#ffffff');
      expect(getVisionColor('darkvision')).toBe('#6366f1');
      expect(getVisionColor('monochrome')).toBe('#9ca3af');
      expect(getVisionColor('tremorsense')).toBe('#92400e');
      expect(getVisionColor('blindsight')).toBe('#fbbf24');
      expect(getVisionColor('truesight')).toBe('#fbbf24');
      expect(getVisionColor(undefined as any)).toBe('#ffffff');
    });
  });

  describe('getVisionOpacity', () => {
    it('should return correct opacities for vision modes', () => {
      expect(getVisionOpacity('basic')).toBe(0.15);
      expect(getVisionOpacity('darkvision')).toBe(0.2);
      expect(getVisionOpacity('monochrome')).toBe(0.2);
      expect(getVisionOpacity('tremorsense')).toBe(0.25);
      expect(getVisionOpacity('blindsight')).toBe(0.3);
      expect(getVisionOpacity('truesight')).toBe(0.35);
      expect(getVisionOpacity(undefined as any)).toBe(0.15);
    });
  });
});
