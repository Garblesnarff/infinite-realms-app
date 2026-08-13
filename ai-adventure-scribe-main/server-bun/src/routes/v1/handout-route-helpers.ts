import type { campaignJournalEntries } from '../../../../db/schema/index.js';
import type {
  AuthoredHandout,
  JournalHandoutEntry,
} from '../../services/dm/handout-action-service.js';

export const entryFromRow = (
  row: typeof campaignJournalEntries.$inferSelect,
  sessionNumber: number | null,
  recipient: string | null,
): JournalHandoutEntry => ({
  id: row.id,
  sessionId: row.sessionId,
  sessionNumber,
  recipient,
  mode: row.handoutMode as 'authored' | 'improvised',
  key: row.handoutKey,
  title: row.title,
  body: row.body,
  giver: row.giver || 'Unknown',
  assetPath: row.assetPath,
  createdAt: row.createdAt.toISOString(),
});

export const authoredFromChunk = (metadata: unknown): AuthoredHandout | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  return typeof record.key === 'string' &&
    typeof record.title === 'string' &&
    typeof record.giver === 'string' &&
    typeof record.body === 'string'
    ? { key: record.key, title: record.title, giver: record.giver, body: record.body }
    : null;
};
