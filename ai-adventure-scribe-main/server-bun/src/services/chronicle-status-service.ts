import { eq } from 'drizzle-orm';

import { sessionChronicles } from '../../../db/schema/index';

import type { db } from '../../../db/client';

export async function persistChronicleFailure(database: Pick<typeof db, 'transaction'>, chronicleId: string, error: unknown): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.update(sessionChronicles).set({ status: 'failed', errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Chronicle generation failed', updatedAt: new Date() }).where(eq(sessionChronicles.id, chronicleId));
  });
}
