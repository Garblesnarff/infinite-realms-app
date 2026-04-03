
import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';

import {
  FrustumCuller,
  createCullableFromToken,
  createCullableFromDrawing
} from '../culling';

describe('FrustumCuller', () => {
  describe('createCullableFromToken', () => {
    it('should create a cullable object with correct dimensions', () => {
      const token = {
        id: 'token-1',
        positionX: 100,
        positionY: 200,
        elevation: 10,
        sizeWidth: 2,
        sizeHeight: 2,
      };
      const gridSize = 50;

      const cullable = createCullableFromToken(token, gridSize);

      expect(cullable.id).toBe('token-1');
      expect(cullable.position).toEqual({ x: 100, y: 200, z: 10 });
      // width = 2 * 50 = 100, radius = 100 / 2 = 50
      expect(cullable.radius).toBe(50);
      expect(cullable.boundingBox?.min).toEqual({ x: 50, y: 150, z: 9.9 });
      expect(cullable.boundingBox?.max).toEqual({ x: 150, y: 250, z: 10.1 });
    });

    it('should use default values for missing fields', () => {
      const token = {
        id: 'token-2',
        positionX: 0,
        positionY: 0,
      };

      const cullable = createCullableFromToken(token);

      expect(cullable.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(cullable.radius).toBe(0.5); // (1 * 1) / 2
    });
  });

  describe('createCullableFromDrawing', () => {
    it('should create a cullable object from drawing points', () => {
      const drawing = {
        id: 'drawing-1',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        strokeWidth: 10,
      };

      const cullable = createCullableFromDrawing(drawing);

      expect(cullable.id).toBe('drawing-1');
      expect(cullable.position).toEqual({ x: 50, y: 50, z: 0 });
      // minX = -5, maxX = 105, width = 110
      // minY = -5, maxY = 105, height = 110
      expect(cullable.boundingBox?.min.x).toBe(-5);
      expect(cullable.boundingBox?.max.x).toBe(105);
      // radius = sqrt(110^2 + 110^2) / 2 = 110 * sqrt(2) / 2 = 55 * sqrt(2) approx 77.78
      expect(cullable.radius).toBeCloseTo(77.78);
    });

    it('should handle empty points', () => {
      const cullable = createCullableFromDrawing({ id: 'empty', points: [] });
      expect(cullable.radius).toBe(0);
    });
  });

  describe('Culling Logic', () => {
    const culler = new FrustumCuller();

    // Set up a simple frustum for testing
    // Looking down Z axis, centered at origin
    const projectionMatrix = new THREE.Matrix4().makePerspective(-1, 1, 1, -1, 1, 100);
    const viewMatrix = new THREE.Matrix4().makeTranslation(0, 0, -10);
    culler.updateFromMatrices(projectionMatrix, viewMatrix);

    it('should identify visible points', () => {
      // Point directly in front of camera at (0, 0, -5) in world space
      // Since camera is at (0, 0, 10) looking towards origin?
      // makeTranslation(0, 0, -10) moves world by -10 in Z, so camera is at (0, 0, 10).
      // A point at (0, 0, 0) in world becomes (0, 0, -10) in view space.
      // Near plane is 1, far is 100. -10 is between them.
      expect(culler.isPointVisible({ x: 0, y: 0, z: 0 })).toBe(true);
    });

    it('should cull points behind camera', () => {
      expect(culler.isPointVisible({ x: 0, y: 0, z: 20 })).toBe(false);
    });

    it('should cull points outside frustum sides', () => {
      expect(culler.isPointVisible({ x: 1000, y: 0, z: 0 })).toBe(false);
    });

    it('should use sphere culling when available', () => {
      const visibleSphere = {
        id: 'sphere-1',
        position: { x: 0, y: 0, z: 0 },
        radius: 1,
      };
      const invisibleSphere = {
        id: 'sphere-2',
        position: { x: 100, y: 0, z: 0 },
        radius: 1,
      };

      expect(culler.isObjectVisible(visibleSphere)).toBe(true);
      expect(culler.isObjectVisible(invisibleSphere)).toBe(false);
    });

    it('should use bounding box culling when available', () => {
      const visibleBox = {
        id: 'box-1',
        position: { x: 0, y: 0, z: 0 },
        boundingBox: {
          min: { x: -1, y: -1, z: -1 },
          max: { x: 1, y: 1, z: 1 },
        },
      };

      expect(culler.isObjectVisible(visibleBox)).toBe(true);
    });

    it('should calculate distance from camera', () => {
      // Camera is at (0, 0, 10) due to viewMatrix
      const dist = culler.getDistanceFromCamera({ x: 0, y: 0, z: 0 });
      expect(dist).toBe(10);
    });

    it('should batch cull objects', () => {
      const objects = [
        { id: '1', position: { x: 0, y: 0, z: 0 } },
        { id: '2', position: { x: 100, y: 0, z: 0 } },
      ];

      const results = culler.cullObjects(objects);
      expect(results).toHaveLength(2);
      expect(results[0].isVisible).toBe(true);
      expect(results[1].isVisible).toBe(false);
    });

    it('should sort visible objects by distance', () => {
      const objects = [
        { id: 'far', position: { x: 0, y: 0, z: -50 } },
        { id: 'near', position: { x: 0, y: 0, z: 0 } },
        { id: 'culled', position: { x: 1000, y: 0, z: 0 } },
      ];

      const sorted = culler.getVisibleObjectsSorted(objects, true); // nearest first
      expect(sorted).toEqual(['near', 'far']);
    });
  });

  describe('updateFromCamera', () => {
    it('should update matrices from a THREE.Camera', () => {
      const culler = new FrustumCuller();
      const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000);
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);

      const updateMatrixWorldSpy = vi.spyOn(camera, 'updateMatrixWorld');
      const updateProjectionMatrixSpy = vi.spyOn(camera, 'updateProjectionMatrix');

      culler.updateFromCamera(camera);

      expect(updateMatrixWorldSpy).toHaveBeenCalled();
      expect(updateProjectionMatrixSpy).toHaveBeenCalled();
      expect(culler.getCameraPosition().z).toBe(100);
    });
  });

  describe('Utility Functions', () => {
    it('should calculate visibility statistics', () => {
      const culler = new FrustumCuller();
      const projectionMatrix = new THREE.Matrix4().makePerspective(-1, 1, 1, -1, 1, 100);
      const viewMatrix = new THREE.Matrix4().makeTranslation(0, 0, -10);
      culler.updateFromMatrices(projectionMatrix, viewMatrix);

      const objects = [
        { id: '1', position: { x: 0, y: 0, z: 0 } },
        { id: '2', position: { x: 100, y: 0, z: 0 } },
      ];

      const stats = culler.getStatistics(objects);
      expect(stats).toEqual({
        total: 2,
        visible: 1,
        culled: 1,
        cullRate: 0.5,
      });
    });

    it('should return empty statistics for empty array', () => {
      const culler = new FrustumCuller();
      const stats = culler.getStatistics([]);
      expect(stats.total).toBe(0);
      expect(stats.cullRate).toBe(0);
    });

    it('should get visible objects list', () => {
      const culler = new FrustumCuller();
      const projectionMatrix = new THREE.Matrix4().makePerspective(-1, 1, 1, -1, 1, 100);
      const viewMatrix = new THREE.Matrix4().makeTranslation(0, 0, -10);
      culler.updateFromMatrices(projectionMatrix, viewMatrix);

      const objects = [
        { id: 'visible', position: { x: 0, y: 0, z: 0 } },
        { id: 'hidden', position: { x: 100, y: 0, z: 0 } },
      ];

      expect(culler.getVisibleObjects(objects)).toEqual(['visible']);
    });

    it('should get frustum planes', () => {
      const culler = new FrustumCuller();
      expect(culler.getFrustumPlanes()).toHaveLength(6);
    });
  });
});
