import { and, asc, eq, isNull } from 'drizzle-orm';

import { SessionService } from '../session-service.js';
import {
  canonicalSubjectName,
  renderSceneStateFromFacts,
  resolveSupersession,
  type AssertFactInput,
  type AssertFactResult,
  type FactSubjectType,
} from './narrative-ledger-core.js';
import { db } from '../../../../db/client';
import { narrativeFacts, type NarrativeFact } from '../../../../db/schema/index';

export * from './narrative-ledger-core.js';

export class NarrativeLedgerService {
  /**
   * Supersede-never-overwrite write. Finds the live row for the case-folded
   * subject key and either no-ops (identical value), rejects (precedence), or
   * invalidates it and inserts the replacement - all in one transaction.
   */
  static async assertFact(
    input: AssertFactInput,
    userId: string,
  ): Promise<AssertFactResult<NarrativeFact>> {
    await SessionService.getSessionById(input.sessionId, userId);
    const subjectName = canonicalSubjectName(input.subjectName);

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(narrativeFacts)
        .where(
          and(
            eq(narrativeFacts.sessionId, input.sessionId),
            eq(narrativeFacts.subjectType, input.subjectType),
            eq(narrativeFacts.subjectName, subjectName),
            eq(narrativeFacts.predicate, input.predicate),
            isNull(narrativeFacts.invalidatedAt),
          ),
        )
        .limit(1)
        .for('update');

      const decision = resolveSupersession(current ?? null, {
        value: input.value,
        source: input.source,
      });

      if (decision.action === 'unchanged') {
        return { rejected: false, action: 'unchanged', fact: current! } as const;
      }
      if (decision.action === 'reject') {
        return { rejected: true, action: 'rejected', reason: decision.reason } as const;
      }

      const now = new Date();
      const id = crypto.randomUUID();

      if (decision.action === 'supersede') {
        await tx
          .update(narrativeFacts)
          .set({ invalidatedAt: now, invalidatedBy: id })
          .where(eq(narrativeFacts.id, current!.id));
      }

      const [inserted] = await tx
        .insert(narrativeFacts)
        .values({
          id,
          sessionId: input.sessionId,
          campaignId: input.campaignId,
          subjectType: input.subjectType,
          subjectName,
          predicate: input.predicate,
          value: input.value,
          knownBy: input.knownBy ?? ['dm'],
          isBelief: input.isBelief ?? false,
          source: input.source,
          turnIndex: input.turnIndex,
          messageId: input.messageId,
          needsReview: input.needsReview ?? false,
          validFrom: now,
        })
        .returning();

      return {
        rejected: false,
        action: decision.action === 'supersede' ? 'superseded' : 'inserted',
        fact: inserted!,
      } as const;
    });
  }

  /** Current (non-superseded) facts. Staged facts stay hidden unless asked for. */
  static async currentFacts(
    sessionId: string,
    userId: string,
    options: { subjectType?: FactSubjectType; subjectName?: string; includeStaged?: boolean } = {},
  ): Promise<NarrativeFact[]> {
    await SessionService.getSessionById(sessionId, userId);
    const conditions = [
      eq(narrativeFacts.sessionId, sessionId),
      isNull(narrativeFacts.invalidatedAt),
    ];
    if (options.subjectType) conditions.push(eq(narrativeFacts.subjectType, options.subjectType));
    if (options.subjectName) {
      conditions.push(eq(narrativeFacts.subjectName, canonicalSubjectName(options.subjectName)));
    }
    if (!options.includeStaged) conditions.push(eq(narrativeFacts.needsReview, false));

    return db
      .select()
      .from(narrativeFacts)
      .where(and(...conditions))
      .orderBy(
        asc(narrativeFacts.subjectType),
        asc(narrativeFacts.subjectName),
        asc(narrativeFacts.predicate),
      );
  }

  /** Full supersession chain for one (subject, predicate), oldest first. */
  static async history(
    sessionId: string,
    userId: string,
    subjectName: string,
    predicate: string,
  ): Promise<NarrativeFact[]> {
    await SessionService.getSessionById(sessionId, userId);
    return db
      .select()
      .from(narrativeFacts)
      .where(
        and(
          eq(narrativeFacts.sessionId, sessionId),
          eq(narrativeFacts.subjectName, canonicalSubjectName(subjectName)),
          eq(narrativeFacts.predicate, predicate),
        ),
      )
      .orderBy(asc(narrativeFacts.validFrom));
  }

  /** The `<scene_state>` block for the next prompt (memory-system-design-v2.md §3.3). */
  static async renderSceneState(
    sessionId: string,
    userId: string,
    options: { audience?: string[] } = {},
  ): Promise<string> {
    const facts = await this.currentFacts(sessionId, userId);
    return renderSceneStateFromFacts(facts, options.audience ?? ['dm']);
  }
}
