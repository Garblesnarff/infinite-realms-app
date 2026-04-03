/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  VisionWorkerManager,
  calculateVisionAsync,
  calculateMultiVisionAsync,
  updateVisionWalls,
  clearVisionCache
} from '../vision-worker-manager';

// Mock Web Worker
class MockWorker {
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(public url: string, public options?: any) {}
}

const MockWorkerSpy = vi.fn((url: string, options?: any) => new MockWorker(url, options));

describe('VisionWorkerManager', () => {
  let manager: VisionWorkerManager;

  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorkerSpy);
    // Reset the singleton properly for each test
    (VisionWorkerManager as any).instance = null;
    manager = VisionWorkerManager.getInstance();
  });

  afterEach(() => {
    manager.terminate();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should be a singleton', () => {
    const instance1 = VisionWorkerManager.getInstance();
    const instance2 = VisionWorkerManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should initialize correctly', async () => {
    await manager.initialize();
    expect(MockWorkerSpy).toHaveBeenCalled();
  });

  it('should handle calculateVision successfully', async () => {
    await manager.initialize();
    const token = { id: 'token-1', x: 100, y: 100, rotation: 0, vision: { enabled: true, range: 60 } } as any;
    const walls = [] as any[];

    const promise = manager.calculateVision(token, walls);

    // Check if worker was created
    const worker = (manager as any).worker as unknown as MockWorker;
    expect(worker).toBeDefined();

    // The call to postMessage might be async due to ensureInitialized
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    // Simulate worker response
    const mockPolygon = { points: [{ x: 0, y: 0 }], range: 60, visionMode: 'basic' };
    const requestId = (worker.postMessage.mock.calls[0][0] as any).requestId;

    worker.onmessage!({
      data: {
        type: 'VISION_RESULT',
        payload: { tokenId: 'token-1', polygon: mockPolygon },
        requestId
      }
    } as MessageEvent);

    const result = await promise;
    expect(result).toEqual(mockPolygon);
  });

  it('should handle calculateVision timeout', async () => {
    vi.useFakeTimers();
    await manager.initialize();
    const token = { id: 'token-1', x: 100, y: 100, rotation: 0, vision: { enabled: true, range: 60 } } as any;
    const promise = manager.calculateVision(token, []);

    // We need to wait for the microtask that sets up the timeout
    await vi.advanceTimersByTimeAsync(0);

    // Fast-forward time for the 5s timeout
    const timeoutPromise = vi.advanceTimersByTimeAsync(5001);

    await expect(promise).rejects.toThrow('Vision calculation timeout');
    await timeoutPromise;

    // Back to real timers to avoid interference
    vi.useRealTimers();
  });

  it('should handle calculateMultiVision successfully', async () => {
    await manager.initialize();
    const tokens = [{ id: 'token-1', x: 100, y: 100, rotation: 0, vision: { enabled: true, range: 60 } }] as any[];
    const walls = [] as any[];

    const promise = manager.calculateMultiVision(tokens, walls);

    const worker = (manager as any).worker as unknown as MockWorker;
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    const mockPolygons = { 'token-1': { points: [], range: 60, visionMode: 'basic' } };
    const requestId = (worker.postMessage.mock.calls[0][0] as any).requestId;

    worker.onmessage!({
      data: {
        type: 'MULTI_VISION_RESULT',
        payload: { polygons: mockPolygons },
        requestId
      }
    } as MessageEvent);

    const result = await promise;
    expect(result.get('token-1')).toEqual(mockPolygons['token-1']);
  });

  it('should handle worker error response', async () => {
    await manager.initialize();
    const token = { id: 'token-1', x: 100, y: 100, rotation: 0, vision: { enabled: true, range: 60 } } as any;
    const promise = manager.calculateVision(token, []);

    const worker = (manager as any).worker as unknown as MockWorker;
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    const requestId = (worker.postMessage.mock.calls[0][0] as any).requestId;

    worker.onmessage!({
      data: {
        type: 'ERROR',
        payload: { error: 'Calculation failed' },
        requestId
      }
    } as MessageEvent);

    await expect(promise).rejects.toThrow('Calculation failed');
  });

  it('should update walls', async () => {
    await manager.initialize();
    const walls = [{ id: 'wall-1' }] as any[];
    manager.updateWalls(walls);

    const worker = (manager as any).worker as unknown as MockWorker;
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'UPDATE_WALLS',
      payload: { walls }
    });
  });

  it('should clear cache', async () => {
    await manager.initialize();
    manager.clearCache();

    const worker = (manager as any).worker as unknown as MockWorker;
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'CLEAR_CACHE'
    });
  });

  it('should track stats correctly', async () => {
    await manager.initialize();
    const token = { id: 'token-1', x: 100, y: 100, rotation: 0, vision: { enabled: true, range: 60 } } as any;

    manager.resetStats();
    expect(manager.getStats().totalRequests).toBe(0);

    const promise = manager.calculateVision(token, []);

    // In our implementation, stats.totalRequests++ happens before ensureInitialized()
    // However, calculateVision is async.
    // Let's check stats after the call has started.
    await vi.waitFor(() => {
      expect(manager.getStats().totalRequests).toBe(1);
    });

    const worker = (manager as any).worker as unknown as MockWorker;
    await vi.waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    const requestId = (worker.postMessage.mock.calls[0][0] as any).requestId;

    worker.onmessage!({
      data: {
        type: 'VISION_RESULT',
        payload: { tokenId: 'token-1', polygon: {} },
        requestId
      }
    } as MessageEvent);

    await promise;
    expect(manager.getStats().totalCalculations).toBe(1);
  });

  it('should restart worker', async () => {
    await manager.initialize();
    const firstWorker = (manager as any).worker;

    await manager.restart();
    expect((manager as any).worker).not.toBe(firstWorker);
    expect(firstWorker.terminate).toHaveBeenCalled();
  });

  describe('Convenience Functions', () => {
    it('calculateVisionAsync should use manager', async () => {
      const spy = vi.spyOn(manager, 'calculateVision').mockResolvedValue({} as any);
      await calculateVisionAsync({ id: 't1' } as any, []);
      expect(spy).toHaveBeenCalled();
    });

    it('calculateMultiVisionAsync should use manager', async () => {
      const spy = vi.spyOn(manager, 'calculateMultiVision').mockResolvedValue(new Map());
      await calculateMultiVisionAsync([{ id: 't1' } as any], []);
      expect(spy).toHaveBeenCalled();
    });

    it('updateVisionWalls should use manager', () => {
      const spy = vi.spyOn(manager, 'updateWalls');
      updateVisionWalls([]);
      expect(spy).toHaveBeenCalled();
    });

    it('clearVisionCache should use manager', () => {
      const spy = vi.spyOn(manager, 'clearCache');
      clearVisionCache();
      expect(spy).toHaveBeenCalled();
    });
  });
});
