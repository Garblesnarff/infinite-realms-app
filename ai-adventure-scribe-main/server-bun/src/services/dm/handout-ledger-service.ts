import { buildHandoutPossessionFact } from './handout-action-service.js';
import { alert } from '../../lib/alerting.js';
import { logger } from '../../lib/logger.js';
import { NarrativeLedgerService } from '../narrative/narrative-ledger-service.js';

import type { JournalHandoutEntry } from './handout-action-service.js';

export async function recordHandoutPossessionFact(input: {
  entry: JournalHandoutEntry;
  recipientName: string | null;
  sessionId: string;
  campaignId: string | null;
  userId: string;
}): Promise<void> {
  const { entry, recipientName, sessionId, campaignId, userId } = input;
  if (!recipientName) {
    logger.warn({
      msg: 'HANDOUT_FACT_RECIPIENT_MISSING',
      sessionId,
      handoutId: entry.id,
    });
    alert('handout_fact_recipient_missing', { sessionId });
    return;
  }

  try {
    await NarrativeLedgerService.assertFact(
      buildHandoutPossessionFact(entry, recipientName, sessionId, campaignId || undefined),
      userId,
    );
  } catch (error) {
    logger.warn({
      msg: 'HANDOUT_NARRATIVE_FACT_WRITE_FAILED',
      sessionId,
      handoutId: entry.id,
      error: error instanceof Error ? error.message : error,
    });
    alert('narrative_fact_write_failed', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
