/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { describe, it, expect } from 'vitest';

import { LODManager, LODLevel, DEFAULT_LOD_CONFIG } from '../lod';

describe('LODManager', () => {
  const lodManager = new LODManager();

  describe('calculateDistance', () => {
    it('should correctly calculate distance between two THREE.Vector3 positions', () => {
      const posA = new THREE.Vector3(0, 0, 0);
      const posB = new THREE.Vector3(3, 4, 0);
      expect(lodManager.calculateDistance(posA, posB)).toBe(5);
    });

    it('should correctly calculate distance between two plain object positions', () => {
      const posA = { x: 0, y: 0, z: 0 };
      const posB = { x: 3, y: 4, z: 0 };
      expect(lodManager.calculateDistance(posA, posB)).toBe(5);
    });

    it('should handle missing z coordinate as 0', () => {
      const posA = { x: 0, y: 0 };
      const posB = { x: 0, y: 0, z: 10 };
      expect(lodManager.calculateDistance(posA, posB)).toBe(10);
    });

    it('should calculate 3D distance correctly', () => {
      const posA = { x: 0, y: 0, z: 0 };
      const posB = { x: 1, y: 1, z: 1 };
      expect(lodManager.calculateDistance(posA, posB)).toBeCloseTo(Math.sqrt(3));
    });
  });

  describe('calculateLODLevel', () => {
    it('should return HIGH level for distances below highThreshold', () => {
      expect(lodManager.calculateLODLevel(DEFAULT_LOD_CONFIG.highThreshold - 1)).toBe(LODLevel.HIGH);
    });

    it('should return MEDIUM level for distances between high and medium thresholds', () => {
      expect(lodManager.calculateLODLevel(DEFAULT_LOD_CONFIG.highThreshold + 1)).toBe(LODLevel.MEDIUM);
    });

    it('should return LOW level for distances between medium and low thresholds', () => {
      expect(lodManager.calculateLODLevel(DEFAULT_LOD_CONFIG.mediumThreshold + 1)).toBe(LODLevel.LOW);
    });

    it('should return HIDDEN level for distances between low and hidden thresholds', () => {
      expect(lodManager.calculateLODLevel(DEFAULT_LOD_CONFIG.lowThreshold + 1)).toBe(LODLevel.HIDDEN);
    });

    it('should return HIDDEN level for distances beyond hiddenThreshold', () => {
      expect(lodManager.calculateLODLevel(DEFAULT_LOD_CONFIG.hiddenThreshold + 1)).toBe(LODLevel.HIDDEN);
    });
  });

  describe('getSettingsForLevel', () => {
    it('should return correct settings for HIGH level', () => {
      const settings = lodManager.getSettingsForLevel(LODLevel.HIGH);
      expect(settings).toMatchObject({
        level: LODLevel.HIGH,
        showLabels: true,
        textureResolution: 1.0,
        geometryDetail: 1.0,
      });
    });

    it('should return correct settings for MEDIUM level', () => {
      const settings = lodManager.getSettingsForLevel(LODLevel.MEDIUM);
      expect(settings).toMatchObject({
        level: LODLevel.MEDIUM,
        showParticles: false,
        textureResolution: 0.5,
      });
    });

    it('should return correct settings for LOW level', () => {
      const settings = lodManager.getSettingsForLevel(LODLevel.LOW);
      expect(settings).toMatchObject({
        level: LODLevel.LOW,
        showLabels: false,
        showShadows: false,
      });
    });

    it('should return correct settings for HIDDEN level', () => {
      const settings = lodManager.getSettingsForLevel(LODLevel.HIDDEN);
      expect(settings).toMatchObject({
        level: LODLevel.HIDDEN,
        textureResolution: 0,
        geometryDetail: 0,
      });
    });
  });

  describe('updateConfig', () => {
    it('should update thresholds correctly', () => {
      const customManager = new LODManager();
      customManager.updateConfig({
        highThreshold: 10,
        mediumThreshold: 20,
        lowThreshold: 30,
        hiddenThreshold: 40
      });

      expect(customManager.calculateLODLevel(5)).toBe(LODLevel.HIGH);
      expect(customManager.calculateLODLevel(15)).toBe(LODLevel.MEDIUM);
      expect(customManager.calculateLODLevel(25)).toBe(LODLevel.LOW);
      expect(customManager.calculateLODLevel(35)).toBe(LODLevel.HIDDEN);
    });
  });

  describe('shouldRender', () => {
    it('should return true for distances below hiddenThreshold', () => {
      const posA = { x: 0, y: 0 };
      const posB = { x: DEFAULT_LOD_CONFIG.hiddenThreshold - 1, y: 0 };
      expect(lodManager.shouldRender(posA, posB)).toBe(true);
    });

    it('should return false for distances above hiddenThreshold', () => {
      const posA = { x: 0, y: 0 };
      const posB = { x: DEFAULT_LOD_CONFIG.hiddenThreshold + 1, y: 0 };
      expect(lodManager.shouldRender(posA, posB)).toBe(false);
    });
  });

  describe('getTextureSize', () => {
    it('should scale texture size based on LOD level', () => {
      expect(lodManager.getTextureSize(LODLevel.HIGH, 512)).toBe(512);
      expect(lodManager.getTextureSize(LODLevel.MEDIUM, 512)).toBe(256);
      expect(lodManager.getTextureSize(LODLevel.LOW, 512)).toBe(128);
    });

    it('should respect minimum size', () => {
      expect(lodManager.getTextureSize(LODLevel.LOW, 64)).toBe(64);
    });
  });

  describe('batchCalculateLOD', () => {
    it('should calculate levels for multiple objects', () => {
      const cameraPos = { x: 0, y: 0 };
      const objects = [
        { x: 5, y: 0 },
        { x: 30, y: 0 },
        { x: 150, y: 0 }
      ];

      const results = lodManager.batchCalculateLOD(objects, cameraPos);
      expect(results.get(0)).toBe(LODLevel.HIGH);
      expect(results.get(1)).toBe(LODLevel.MEDIUM);
      expect(results.get(2)).toBe(LODLevel.HIDDEN);
    });
  });

  describe('getStatistics', () => {
    it('should correctly count distribution of levels', () => {
      const levels = new Map<number, LODLevel>([
        [0, LODLevel.HIGH],
        [1, LODLevel.HIGH],
        [2, LODLevel.MEDIUM],
        [3, LODLevel.HIDDEN]
      ]);

      const stats = lodManager.getStatistics(levels);
      expect(stats).toEqual({
        total: 4,
        high: 2,
        medium: 1,
        low: 0,
        hidden: 1
      });
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the current config', () => {
      const config = lodManager.getConfig();
      expect(config).toEqual(DEFAULT_LOD_CONFIG);

      // Should be a copy
      (config as any).highThreshold = 999;
      expect(lodManager.getConfig().highThreshold).toBe(DEFAULT_LOD_CONFIG.highThreshold);
    });
  });

  describe('getGeometrySegments', () => {
    it('should scale geometry segments based on LOD level', () => {
      expect(lodManager.getGeometrySegments(LODLevel.HIGH, 32)).toBe(32);
      expect(lodManager.getGeometrySegments(LODLevel.MEDIUM, 32)).toBe(24);
      expect(lodManager.getGeometrySegments(LODLevel.LOW, 32)).toBe(16);
    });

    it('should respect minimum segments', () => {
      expect(lodManager.getGeometrySegments(LODLevel.LOW, 4)).toBe(8);
    });
  });

  describe('getSettingsForLevel default case', () => {
    it('should return MEDIUM settings for an unknown level', () => {
      const settings = lodManager.getSettingsForLevel('unknown' as any);
      expect(settings.level).toBe(LODLevel.MEDIUM);
    });
  });
});
