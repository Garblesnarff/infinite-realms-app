import { sql } from 'drizzle-orm';

import { spellSlotUsageLog } from '../../../../db/schema/index';

/** Compare the usage timestamp to an instant even on legacy timestamp-without-time-zone schemas. */
export function slotUsageAtOrAfter(since: Date): ReturnType<typeof sql> {
  return sql`${spellSlotUsageLog.timestamp} >= ${since.toISOString()}::timestamptz`;
}
