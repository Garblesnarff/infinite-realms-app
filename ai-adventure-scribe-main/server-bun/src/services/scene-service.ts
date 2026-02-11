/**
 * Scene Service
 *
 * Handles complex scene management operations for Foundry VTT-style maps.
 * Provides type-safe database queries for scene creation, updates,
 * and retrieval with proper authorization checks.
 *
 * @module server/services/scene-service
 */

import { eq, and, desc, sql } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  scenes,
  sceneLayers,
  sceneSettings,
  campaigns,
  type Scene,
  type NewScene,
  type SceneLayer,
  type NewSceneLayer,
  type SceneSetting,
  type NewSceneSetting,
} from '../../../db/schema/index.js';
import { InternalServerError, NotFoundError } from '../lib/errors.js';

/**
 * Input data for creating a new scene
 */
export interface CreateSceneData {
  name: string;
  description?: string;
  campaignId: string;
  width?: number;
  height?: number;
  gridSize?: number;
  gridType?: string;
  gridColor?: string;
  backgroundImageUrl?: string;
  thumbnailUrl?: string;
}

/**
 * Default layers configuration for new scenes
 * Following Foundry VTT layer structure
 */
const DEFAULT_LAYERS: Array<Omit<NewSceneLayer, 'sceneId'>> = [
  { layerType: 'background', zIndex: 0, isVisible: true, opacity: '1.00', locked: false },
  { layerType: 'grid', zIndex: 1, isVisible: true, opacity: '0.30', locked: false },
  { layerType: 'tokens', zIndex: 2, isVisible: true, opacity: '1.00', locked: false },
  { layerType: 'effects', zIndex: 3, isVisible: true, opacity: '1.00', locked: false },
  { layerType: 'drawings', zIndex: 4, isVisible: true, opacity: '1.00', locked: false },
  { layerType: 'ui', zIndex: 5, isVisible: true, opacity: '1.00', locked: false },
];

export class SceneService {
  /**
   * Verify user owns the campaign
   */
  private static async verifyCampaignOwnership(campaignId: string, userId: string): Promise<void> {
    const campaign = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)),
    });

    if (!campaign) {
      throw new NotFoundError('Campaign', campaignId);
    }
  }

  /**
   * Verify user owns the scene
   */
  private static async verifySceneOwnership(sceneId: string, userId: string): Promise<Scene> {
    const scene = await db.query.scenes.findFirst({
      where: and(eq(scenes.id, sceneId), eq(scenes.userId, userId)),
    });

    if (!scene) {
      throw new NotFoundError('Scene', sceneId);
    }

    return scene;
  }

  /**
   * List all scenes for a campaign
   */
  static async listScenesForCampaign(campaignId: string, userId: string): Promise<Scene[]> {
    // Verify campaign ownership
    await this.verifyCampaignOwnership(campaignId, userId);

    const sceneList = await db.query.scenes.findMany({
      where: and(eq(scenes.campaignId, campaignId), eq(scenes.userId, userId)),
      orderBy: [desc(scenes.createdAt)],
    });

    return sceneList;
  }

  /**
   * Get single scene by ID with settings and layers
   */
  static async getSceneById(sceneId: string, userId: string): Promise<(Scene & { settings?: SceneSetting; layers: SceneLayer[] }) | null> {
    const scene = await db.query.scenes.findFirst({
      where: and(eq(scenes.id, sceneId), eq(scenes.userId, userId)),
      with: {
        settings: true,
        layers: {
          orderBy: (layers, { asc }) => [asc(layers.zIndex)],
        },
      },
    });

    if (!scene) {
      return null;
    }

    return scene as Scene & { settings?: SceneSetting; layers: SceneLayer[] };
  }

  /**
   * Create new scene with default settings and layers
   */
  static async createScene(userId: string, data: CreateSceneData): Promise<Scene> {
    // Verify campaign ownership
    await this.verifyCampaignOwnership(data.campaignId, userId);

    // Create scene
    const [scene] = await db
      .insert(scenes)
      .values({
        userId,
        name: data.name,
        description: data.description || null,
        campaignId: data.campaignId,
        width: data.width || 20,
        height: data.height || 20,
        gridSize: data.gridSize || 5,
        gridType: data.gridType || 'square',
        gridColor: data.gridColor || '#000000',
        backgroundImageUrl: data.backgroundImageUrl || null,
        thumbnailUrl: data.thumbnailUrl || null,
        isActive: false,
      })
      .returning();

    if (!scene) {
      throw new InternalServerError('Failed to create scene');
    }

    // Create default layers
    const layerValues = DEFAULT_LAYERS.map((layer) => ({
      ...layer,
      sceneId: scene.id,
    }));

    await db.insert(sceneLayers).values(layerValues);

    // Create default scene settings
    await db.insert(sceneSettings).values({
      sceneId: scene.id,
      enableFogOfWar: false,
      enableDynamicLighting: false,
      snapToGrid: true,
      gridOpacity: '0.30',
      ambientLightLevel: '1.00',
      darknessLevel: '0.00',
      weatherEffects: null,
      timeOfDay: null,
    });

    return scene;
  }

  /**
   * Update an existing scene
   */
  static async updateScene(
    sceneId: string,
    userId: string,
    updates: Partial<Omit<NewScene, 'userId' | 'campaignId'>>
  ): Promise<Scene> {
    // ⚡ Bolt: Optimized to perform ownership check atomically in the UPDATE query.
    // This reduces database round-trips from 2 to 1.
    const [updated] = await db
      .update(scenes)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId)))
      .returning();

    if (!updated) {
      // Throw NotFoundError if no rows were updated (either doesn't exist or wrong user)
      throw new NotFoundError('Scene', sceneId);
    }

    return updated;
  }

  /**
   * Delete a scene and cascade to related records
   */
  static async deleteScene(sceneId: string, userId: string): Promise<boolean> {
    // ⚡ Bolt: Optimized to perform ownership check atomically in the DELETE query.
    // This reduces database round-trips from 2 to 1.
    const result = await db
      .delete(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId)))
      .returning({ id: scenes.id });

    if (result.length === 0) {
      throw new NotFoundError('Scene', sceneId);
    }

    return true;
  }

  /**
   * Set a scene as the active scene for a campaign
   * Deactivates all other scenes in the campaign
   */
  static async setActiveScene(sceneId: string, campaignId: string, userId: string): Promise<Scene> {
    // ⚡ Bolt: Consolidated ownership verification into a single query.
    const scene = await db.query.scenes.findFirst({
      where: and(eq(scenes.id, sceneId), eq(scenes.userId, userId), eq(scenes.campaignId, campaignId)),
    });

    if (!scene) {
      // Fallback to provide accurate error message if it's the campaign that's missing
      await this.verifyCampaignOwnership(campaignId, userId);
      throw new NotFoundError('Scene', sceneId);
    }

    // ⚡ Bolt: Optimized to use a single UPDATE query with CASE logic instead of two separate updates.
    // This reduces database round-trips from 4 to 2 (1 Select + 1 Update).
    const results = await db
      .update(scenes)
      .set({
        isActive: sql`CASE WHEN ${scenes.id} = ${sceneId} THEN true ELSE false END`,
        updatedAt: new Date(),
      })
      .where(and(eq(scenes.campaignId, campaignId), eq(scenes.userId, userId)))
      .returning();

    const activeScene = results.find((s) => s.id === sceneId);

    if (!activeScene) {
      throw new InternalServerError('Failed to activate scene');
    }

    return activeScene;
  }

  /**
   * Update scene settings
   */
  static async updateSettings(
    sceneId: string,
    userId: string,
    settingsUpdates: Partial<Omit<NewSceneSetting, 'sceneId'>>
  ): Promise<SceneSetting> {
    // ⚡ Bolt: Removed redundant verifySceneOwnership call.
    // Ownership is verified atomically within the UPDATE query's EXISTS clause.

    // Check if settings exist
    const existingSettings = await db.query.sceneSettings.findFirst({
      where: eq(sceneSettings.sceneId, sceneId),
    });

    if (!existingSettings) {
      // For insertion, we still need to verify scene ownership manually
      // or we could use an INSERT ... SELECT pattern.
      // But keeping it simple for now as insertions are rare (usually created with scene).
      await this.verifySceneOwnership(sceneId, userId);

      // Create new settings if they don't exist
      const [newSettings] = await db
        .insert(sceneSettings)
        .values({
          sceneId,
          ...settingsUpdates,
        })
        .returning();

      if (!newSettings) {
        throw new InternalServerError('Failed to create scene settings');
      }

      return newSettings;
    }

    // Update existing settings
    const [updated] = await db
      .update(sceneSettings)
      .set({
        ...settingsUpdates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(sceneSettings.sceneId, sceneId),
        sql`EXISTS (
          SELECT 1
          FROM scenes s
          WHERE s.id = ${sceneSettings.sceneId}
            AND s.user_id = ${userId}
        )`
      ))
      .returning();

    if (!updated) {
      // If update fails, it means the scene doesn't exist or doesn't belong to the user
      throw new NotFoundError('Scene', sceneId);
    }

    return updated;
  }

  /**
   * Update a scene layer
   */
  static async updateLayer(
    sceneId: string,
    layerId: string,
    userId: string,
    updates: Partial<Omit<NewSceneLayer, 'sceneId'>>
  ): Promise<SceneLayer> {
    // ⚡ Bolt: Optimized to perform ownership check and layer verification in the UPDATE query.
    // This reduces database round-trips from 3 to 1.
    const [updated] = await db
      .update(sceneLayers)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(sceneLayers.id, layerId),
        eq(sceneLayers.sceneId, sceneId),
        sql`EXISTS (
          SELECT 1
          FROM scenes s
          WHERE s.id = ${sceneLayers.sceneId}
            AND s.user_id = ${userId}
        )`
      ))
      .returning();

    if (!updated) {
      // If no row was updated, either the layer or the scene was not found/authorized
      throw new NotFoundError('Layer or Scene', layerId);
    }

    return updated;
  }
}
