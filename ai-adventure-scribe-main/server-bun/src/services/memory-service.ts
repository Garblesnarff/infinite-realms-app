import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import { CampaignService } from './campaign-service.js';
import { SessionService } from './session-service.js';
import { db } from '../../../db/client';
import { memories, type NewMemory } from '../../../db/schema/index';
import { NotFoundError } from '../lib/errors.js';

export class MemoryService {
  static async list(
    sessionId: string,
    userId: string,
    options: {
      limit?: number;
      category?: string;
      recentSince?: Date;
      minNarrativeWeight?: number;
      top?: boolean;
    } = {},
  ) {
    await SessionService.getSessionById(sessionId, userId);
    const conditions = [eq(memories.sessionId, sessionId)];
    if (options.category)
      conditions.push(sql`${memories.metadata}->>'category' = ${options.category}`);
    if (options.recentSince) conditions.push(gte(memories.createdAt, options.recentSince));
    if (options.minNarrativeWeight) {
      conditions.push(gte(memories.narrativeWeight, options.minNarrativeWeight));
    }
    return db.query.memories.findMany({
      where: and(...conditions),
      orderBy: options.top
        ? [desc(memories.importance), desc(memories.createdAt)]
        : [options.minNarrativeWeight ? asc(memories.createdAt) : desc(memories.createdAt)],
      limit: options.limit ?? 50,
    });
  }

  static async insert(records: NewMemory[], userId: string) {
    for (const record of records) await this.verifyRecordOwnership(record, userId);
    return db.insert(memories).values(records).returning();
  }

  static async getById(memoryId: string, userId: string) {
    const memory = await db.query.memories.findFirst({ where: eq(memories.id, memoryId) });
    if (!memory) throw new NotFoundError('Memory', memoryId);
    await this.verifyRecordOwnership(memory, userId);
    return memory;
  }

  static async updateScores(
    memoryId: string,
    userId: string,
    updates: { importance?: number; narrativeWeight?: number },
  ): Promise<void> {
    await this.getById(memoryId, userId);
    await db
      .update(memories)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(memories.id, memoryId));
  }

  static async updateContent(memoryId: string, userId: string, content: string): Promise<void> {
    await this.getById(memoryId, userId);
    await db
      .update(memories)
      .set({ content, updatedAt: new Date() })
      .where(eq(memories.id, memoryId));
  }

  static async match(
    sessionId: string,
    userId: string,
    embedding: string,
    limit: number,
    threshold: number,
  ): Promise<unknown[]> {
    await SessionService.getSessionById(sessionId, userId);
    const result = await db.execute(sql`
      SELECT * FROM match_memories(
        ${embedding}::vector,
        ${sessionId}::uuid,
        ${threshold}::float,
        ${limit}::int
      )
    `);
    return Array.from(result as Iterable<unknown>);
  }

  private static async verifyRecordOwnership(
    record: Pick<NewMemory, 'sessionId' | 'campaignId'>,
    userId: string,
  ): Promise<void> {
    if (record.sessionId) {
      await SessionService.getSessionById(record.sessionId, userId);
      return;
    }
    if (record.campaignId) {
      const campaign = await CampaignService.getById(record.campaignId, userId);
      if (campaign) return;
    }
    throw new NotFoundError('Memory parent', record.sessionId || record.campaignId || 'unknown');
  }
}
