/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CampaignService } from '../campaign-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      campaigns: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    })),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    })),
  },
}));

// Mock the schema symbols to avoid undefined errors
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...(actual as any),
  };
});

describe('CampaignService Security', () => {
  const mockUserId = 'user-123';
  const mockCampaignId = 'campaign-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listForUser', () => {
    it('should filter by userId', async () => {
      (db.query.campaigns.findMany as any).mockResolvedValue([]);

      await CampaignService.listForUser(mockUserId);

      expect(db.query.campaigns.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Object),
        }),
      );
    });
  });

  describe('listPublicTemplates', () => {
    it('queries only templates intended for public discovery and excludes heavy fields', async () => {
      (db.query.campaigns.findMany as any).mockResolvedValue([]);

      await CampaignService.listPublicTemplates();

      expect(db.query.campaigns.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Object),
          columns: {
            settingDetails: false,
            thematicElements: false,
            styleConfig: false,
            rulesConfig: false,
          },
        }),
      );
    });
  });

  describe('getById', () => {
    it('should return null if campaign not found or not owned', async () => {
      (db.query.campaigns.findFirst as any).mockResolvedValue(null);

      const result = await CampaignService.getById(mockCampaignId, mockUserId);
      expect(result).toBeNull();
    });

    it('should return campaign if owned by user', async () => {
      const mockCampaign = { id: mockCampaignId, userId: mockUserId, name: 'My Campaign' };
      (db.query.campaigns.findFirst as any).mockResolvedValue(mockCampaign);

      const result = await CampaignService.getById(mockCampaignId, mockUserId);
      expect(result).toEqual(mockCampaign);
    });
  });

  describe('create', () => {
    it('should insert campaign with userId', async () => {
      const mockCampaign = { id: mockCampaignId, userId: mockUserId, name: 'New Campaign' };
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockCampaign]),
      });

      const result = await CampaignService.create(mockUserId, { name: 'New Campaign' });
      expect(result).toEqual(mockCampaign);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should throw NotFoundError if campaign not found or not owned', async () => {
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      });

      await expect(
        CampaignService.update(mockCampaignId, mockUserId, { name: 'New Name' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should update campaign if owned by user', async () => {
      const mockCampaign = { id: mockCampaignId, userId: mockUserId, name: 'New Name' };
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockCampaign]),
      });

      const result = await CampaignService.update(mockCampaignId, mockUserId, { name: 'New Name' });
      expect(result).toEqual(mockCampaign);
    });
  });

  describe('delete', () => {
    it('should throw NotFoundError if campaign not found or not owned', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      });

      await expect(CampaignService.delete(mockCampaignId, mockUserId)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should succeed if owned by user', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: mockCampaignId }]),
      });

      const result = await CampaignService.delete(mockCampaignId, mockUserId);
      expect(result).toBe(true);
    });
  });
});
