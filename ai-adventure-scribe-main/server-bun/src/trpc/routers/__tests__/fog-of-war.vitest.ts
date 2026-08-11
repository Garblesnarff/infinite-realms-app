/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FogOfWarService } from '../../../services/fog-of-war-service.js';
import { fogOfWarRouter } from '../fog-of-war.js';

// Mock FogOfWarService
vi.mock('../../../services/fog-of-war-service.js', () => ({
  FogOfWarService: {
    getRevealedAreas: vi.fn(),
    revealArea: vi.fn(),
    revealAreas: vi.fn(),
    concealArea: vi.fn(),
    concealAreas: vi.fn(),
    resetFogOfWar: vi.fn(),
    mergeRevealedAreas: vi.fn(),
    getFogOfWarRecord: vi.fn(),
  },
}));

// Mock broadcastToScene
vi.mock('../../../ws.js', () => ({
  broadcastToScene: vi.fn(),
}));

describe('Fog of War Router Input Validation', () => {
  const mockUserId = 'user_01KAT5E3WFD7NGE3C0TDHX2T5G'; // WorkOS ID format (non-UUID)
  const mockUuidUserId = '123e4567-e89b-12d3-a456-426614174000'; // UUID ID format
  const mockSceneId = '123e4567-e89b-12d3-a456-426614174000'; // UUID scene ID

  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {
      user: { userId: mockUserId },
    };
    // Default mock implementations to avoid router errors on successful service delegation
    vi.mocked(FogOfWarService.concealArea).mockResolvedValue(true);
  });

  it('should accept non-UUID WorkOS userId as targetUserId in reveal', async () => {
    const caller = fogOfWarRouter.createCaller(mockCtx);

    const polygon = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };

    await expect(
      caller.reveal({
        sceneId: mockSceneId,
        polygon,
        targetUserId: mockUserId, // Should be accepted without validation error
      })
    ).resolves.not.toThrow();
  });

  it('should accept UUID as targetUserId in reveal', async () => {
    const caller = fogOfWarRouter.createCaller(mockCtx);

    const polygon = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };

    await expect(
      caller.reveal({
        sceneId: mockSceneId,
        polygon,
        targetUserId: mockUuidUserId, // Should also be accepted
      })
    ).resolves.not.toThrow();
  });

  it('should accept non-UUID WorkOS userId as targetUserId in revealBatch', async () => {
    const caller = fogOfWarRouter.createCaller(mockCtx);

    const polygons = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ];

    await expect(
      caller.revealBatch({
        sceneId: mockSceneId,
        polygons,
        targetUserId: mockUserId, // Should be accepted without validation error
      })
    ).resolves.not.toThrow();
  });

  it('should accept non-UUID WorkOS userId as targetUserId in conceal', async () => {
    const caller = fogOfWarRouter.createCaller(mockCtx);

    const areaId = '123e4567-e89b-12d3-a456-426614174000';

    await expect(
      caller.conceal({
        sceneId: mockSceneId,
        areaId,
        targetUserId: mockUserId, // Should be accepted without validation error
      })
    ).resolves.not.toThrow();
  });

  it('should accept non-UUID WorkOS userId as targetUserId in concealBatch', async () => {
    const caller = fogOfWarRouter.createCaller(mockCtx);

    const areaIds = ['123e4567-e89b-12d3-a456-426614174000'];

    await expect(
      caller.concealBatch({
        sceneId: mockSceneId,
        areaIds,
        targetUserId: mockUserId, // Should be accepted without validation error
      })
    ).resolves.not.toThrow();
  });
});
