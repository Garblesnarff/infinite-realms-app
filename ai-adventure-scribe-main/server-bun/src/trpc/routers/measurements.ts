/**
 * Measurements Router
 *
 * tRPC procedures for measurement template operations (AoE templates).
 * Provides endpoints for creating, deleting templates, calculating affected tokens,
 * and cleaning up temporary templates.
 *
 * Authorization:
 * - Anyone can view templates on scenes they have access to
 * - Authenticated users can create templates
 * - Only template creator or scene owner can delete templates
 * - Scene owner can cleanup old temporary templates
 *
 * @module server/trpc/routers/measurements
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AppError } from '../../lib/errors.js';
import { MeasurementService, type CreateTemplateData } from '../../services/measurement-service.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Validation schema for creating a measurement template
 */
const createTemplateSchema = z.object({
  sceneId: z.string().uuid(),
  templateType: z.enum(['cone', 'cube', 'sphere', 'cylinder', 'line', 'ray']),
  originX: z.number(),
  originY: z.number(),
  direction: z.number().min(0).max(360),
  distance: z.number().min(0),
  width: z.number().min(0).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  opacity: z.number().min(0).max(1).optional(),
  isTemporary: z.boolean().optional(),
});

/**
 * Measurements router
 */
export const measurementsRouter = router({
  /**
   * List all templates for a scene (PROTECTED)
   * Only scene owner or authorized users can view templates
   */
  list: protectedProcedure
    .input(z.object({ sceneId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        const templates = await MeasurementService.listTemplates(input.sceneId, ctx.user.userId);
        return { data: templates };
      } catch (error: unknown) {
        if (error instanceof AppError && error.statusCode === 404) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Get a single template by ID (PROTECTED)
   */
  getById: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const template = await MeasurementService.getTemplateById(input.templateId, ctx.user.userId);

      if (!template) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found',
        });
      }

      return template;
    }),

  /**
   * Create a new measurement template (PROTECTED)
   * Anyone can create temporary templates (for spell AoE visualization)
   */
  create: protectedProcedure
    .input(createTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to create templates',
        });
      }

      const templateData: CreateTemplateData = {
        sceneId: input.sceneId,
        templateType: input.templateType,
        originX: input.originX,
        originY: input.originY,
        direction: input.direction,
        distance: input.distance,
        width: input.width,
        color: input.color ?? '#FF0000',
        opacity: input.opacity ?? 0.5,
        isTemporary: input.isTemporary ?? true,
      };

      try {
        const template = await MeasurementService.createTemplate(
          input.sceneId,
          ctx.user.userId,
          templateData
        );

        return template;
      } catch (error: unknown) {
        if (error instanceof AppError && error.statusCode === 404) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Delete a measurement template (PROTECTED)
   * Only creator or scene owner can delete
   */
  delete: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to delete templates',
        });
      }

      const deleted = await MeasurementService.deleteTemplate(input.templateId, ctx.user.userId);

      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found',
        });
      }

      return { success: true };
    }),

  /**
   * Get tokens affected by a template (PROTECTED)
   * Calculates which tokens are within the template's area of effect
   */
  getAffectedTokens: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        const result = await MeasurementService.calculateAffectedTokens(input.templateId, ctx.user.userId);
        return result;
      } catch (error: unknown) {
        if (error instanceof AppError && error.statusCode === 404) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Clean up old temporary templates (PROTECTED)
   * Only scene owner or GM can cleanup
   */
  cleanup: protectedProcedure
    .input(
      z.object({
        sceneId: z.string().uuid(),
        maxAgeMinutes: z.number().int().min(1).max(1440).optional(), // Max 24 hours
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to cleanup templates',
        });
      }

      try {
        const deletedCount = await MeasurementService.cleanupTemporaryTemplates(
          input.sceneId,
          ctx.user.userId,
          input.maxAgeMinutes ?? 60
        );

        return {
          success: true,
          deletedCount,
        };
      } catch (error: unknown) {
        if (error instanceof AppError && error.statusCode === 404) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }
        throw error;
      }
    }),
});

/**
 * Type export for client use
 */
export type MeasurementsRouter = typeof measurementsRouter;
