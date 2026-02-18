/**
 * Campaign Service
 *
 * Handles CRUD operations for D&D campaigns using Drizzle ORM.
 * Ensures proper authorization by always filtering by userId.
 *
 * @module server/services/campaign-service
 */

import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../../db/client';
import { campaigns, type Campaign, type NewCampaign } from '../../../db/schema/index';
import { InternalServerError, NotFoundError } from '../lib/errors.js';

export class CampaignService {
  /**
   * List all campaigns for a user
   * Optimized to exclude heavy JSONB fields by default for list view
   */
  static async listForUser(userId: string): Promise<Campaign[]> {
    return await db.query.campaigns.findMany({
      where: eq(campaigns.userId, userId),
      orderBy: [desc(campaigns.createdAt)],
      columns: {
        id: true,
        userId: true,
        name: true,
        description: true,
        genre: true,
        difficultyLevel: true,
        campaignLength: true,
        tone: true,
        status: true,
        backgroundImage: true,
        artStyle: true,
        createdAt: true,
        updatedAt: true,
        // Exclude heavy fields:
        settingDetails: false,
        thematicElements: false,
        styleConfig: false,
        rulesConfig: false,
        era: true,
        location: true,
        atmosphere: true,
      },
    }) as Campaign[];
  }

  /**
   * Get a single campaign by ID with ownership verification
   */
  static async getById(id: string, userId: string): Promise<Campaign | null> {
    const campaign = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, id), eq(campaigns.userId, userId)),
    });

    return campaign || null;
  }

  /**
   * Create a new campaign
   */
  static async create(userId: string, data: Partial<NewCampaign>): Promise<Campaign> {
    const [campaign] = await db
      .insert(campaigns)
      .values({
        ...data,
        userId,
        name: data.name || 'Unnamed Campaign',
      } as NewCampaign)
      .returning();

    if (!campaign) {
      throw new InternalServerError('Failed to create campaign');
    }

    return campaign;
  }

  /**
   * Update an existing campaign with ownership verification
   */
  static async update(
    id: string,
    userId: string,
    data: Partial<NewCampaign>
  ): Promise<Campaign> {
    const [updated] = await db
      .update(campaigns)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .returning();

    if (!updated) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Campaign', id);
    }

    return updated;
  }

  /**
   * Delete a campaign with ownership verification
   */
  static async delete(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
      .returning({ id: campaigns.id });

    if (result.length === 0) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Campaign', id);
    }

    return true;
  }
}
