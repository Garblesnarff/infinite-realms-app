/**
 * Drawings Router
 *
 * tRPC procedures for scene drawing operations.
 * Provides endpoints for creating, updating, deleting, and listing drawings on scenes.
 *
 * Authorization:
 * - Anyone can view drawings on scenes they have access to
 * - Only authenticated users can create drawings
 * - Only the drawing creator or scene owner can update/delete drawings
 * - Scene owner can bulk delete drawings
 *
 * @module server/trpc/routers/drawings
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { DrawingService, type CreateDrawingData } from '../../services/drawing-service.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * Validation schema for point coordinates
 */
const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * Validation schema for creating a drawing
 */
const createDrawingSchema = z.object({
  sceneId: z.string().uuid(),
  drawingType: z.enum(['freehand', 'line', 'circle', 'rectangle', 'polygon', 'text']),
  pointsData: z.array(pointSchema).min(1),
  strokeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  strokeWidth: z.number().min(1).max(50),
  fillColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().int().optional(),
  textContent: z.string().nullable().optional(),
  fontSize: z.number().int().min(8).max(200).nullable().optional(),
  fontFamily: z.string().nullable().optional(),
});

/**
 * Validation schema for updating a drawing
 */
const updateDrawingSchema = z.object({
  pointsData: z.array(pointSchema).min(1).optional(),
  strokeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  strokeWidth: z.number().min(1).max(50).optional(),
  fillColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().int().optional(),
  textContent: z.string().nullable().optional(),
  fontSize: z.number().int().min(8).max(200).nullable().optional(),
  fontFamily: z.string().nullable().optional(),
});

/**
 * Drawings router
 */
export const drawingsRouter = router({
  /**
   * List all drawings for a scene (PROTECTED)
   * Only scene owner or authorized users can view drawings
   */
  list: protectedProcedure
    .input(z.object({ sceneId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const drawings = await DrawingService.listDrawings(input.sceneId, ctx.user.userId);
      return { data: drawings };
    }),

  /**
   * Get a single drawing by ID (PROTECTED)
   */
  getById: protectedProcedure
    .input(z.object({ drawingId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const drawing = await DrawingService.getDrawingById(input.drawingId, ctx.user.userId);

      if (!drawing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Drawing not found',
        });
      }

      return drawing;
    }),

  /**
   * Create a new drawing (PROTECTED)
   * Requires authentication
   */
  create: protectedProcedure
    .input(createDrawingSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to create drawings',
        });
      }

      const drawingData: CreateDrawingData = {
        sceneId: input.sceneId,
        drawingType: input.drawingType,
        pointsData: input.pointsData,
        strokeColor: input.strokeColor,
        strokeWidth: input.strokeWidth,
        fillColor: input.fillColor ?? null,
        fillOpacity: input.fillOpacity ?? 0,
        zIndex: input.zIndex ?? 0,
        textContent: input.textContent ?? null,
        fontSize: input.fontSize ?? null,
        fontFamily: input.fontFamily ?? null,
      };

      const drawing = await DrawingService.createDrawing(
        input.sceneId,
        ctx.user.userId,
        drawingData
      );

      return drawing;
    }),

  /**
   * Update a drawing (PROTECTED)
   * Only creator or scene owner can update
   */
  update: protectedProcedure
    .input(
      z.object({
        drawingId: z.string().uuid(),
        updates: updateDrawingSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to update drawings',
        });
      }

      try {
        const updated = await DrawingService.updateDrawing(
          input.drawingId,
          ctx.user.userId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input.updates as any
        );

        if (!updated) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Drawing not found',
          });
        }

        return updated;
      } catch (error) {
        if (error instanceof Error && error.message.includes('Not authorized')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Drawing not found',
          });
        }
        throw error;
      }
    }),

  /**
   * Delete a drawing (PROTECTED)
   * Only creator or scene owner can delete
   */
  delete: protectedProcedure
    .input(z.object({ drawingId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to delete drawings',
        });
      }

      try {
        const deleted = await DrawingService.deleteDrawing(input.drawingId, ctx.user.userId);

        if (!deleted) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Drawing not found',
          });
        }

        return { success: true };
      } catch (error) {
        if (error instanceof Error && error.message.includes('Not authorized')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Drawing not found',
          });
        }
        throw error;
      }
    }),

  /**
   * Bulk delete drawings (PROTECTED)
   * Only scene owner can bulk delete
   */
  bulkDelete: protectedProcedure
    .input(
      z.object({
        sceneId: z.string().uuid(),
        drawingIds: z.array(z.string().uuid()).min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to delete drawings',
        });
      }

      try {
        const deletedCount = await DrawingService.bulkDeleteDrawings(
          input.sceneId,
          input.drawingIds,
          ctx.user.userId
        );

        return {
          success: true,
          deletedCount,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('Only scene owner')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Scene not found',
          });
        }
        throw error;
      }
    }),
});

/**
 * Type export for client use
 */
export type DrawingsRouter = typeof drawingsRouter;
