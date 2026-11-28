/**
 * #1537: the DM grants Inspiration. 2014 SRD: the DM awards Inspiration for good roleplay, and a
 * hero holds at most one. The reply's `inspiration_grant` names the player's character. The
 * engine checks that it is the sender's character and not already held, then writes the flag
 * (CharacterService.grantInspiration, a compare-and-set) and posts one engine line.
 * It also publishes `character_state_updated` so the Inspiration coin refreshes.
 *
 * LLM_INSPIRATION_GRANT (shadow by default, the house pattern of LLM_STRICT_BRANCH_VALIDATION):
 * - `shadow` (default): the grant is validated, logged and counted, and nothing is written.
 * - `on`: the grant is written and its engine line is posted.
 */

import { randomUUID } from 'node:crypto';

import { logger } from '../../lib/logger.js';
import { envelopeInspiration } from '../character-envelope.js';
import { ownedSessionCharacter } from './dm-feature-gate.js';

import type { CharacterService } from '../character-service.js';
import type { EngineChatLineWriter } from '../engine-chat-line.js';
import type { StoryCharacterUpdateReason } from './story-broadcast.js';

// character-service.ts and engine-chat-line.ts load the database client when imported, so both
// are loaded at call time (as dm-feature-gate.ts does). Route contract tests import this module
// without a database.
const loadCharacterService = async (): Promise<typeof CharacterService> =>
  (await import('../character-service.js')).CharacterService;

export type InspirationGrantMode = 'shadow' | 'on';

export type InspirationGrantOutcome =
  | 'granted'
  | 'shadow'
  | 'already_held'
  | 'no_character'
  | 'name_mismatch'
  | 'roll_pending'
  | 'refused';

export function inspirationGrantMode(): InspirationGrantMode {
  return process.env.LLM_INSPIRATION_GRANT?.trim().toLowerCase() === 'on' ? 'on' : 'shadow';
}

const counts = new Map<InspirationGrantOutcome, number>();

/** Per-outcome counts since process start (or since the last test reset). */
export function inspirationGrantCounts(): Readonly<
  Partial<Record<InspirationGrantOutcome, number>>
> {
  return Object.fromEntries(counts);
}

export function resetInspirationGrantCountsForTests(): void {
  counts.clear();
}

type GrantRow = { id: string; name: string; personalityNotes: string | null };

export interface InspirationGrantDeps {
  mode?: InspirationGrantMode;
  character?: (sessionId: string, userId: string) => Promise<GrantRow | null>;
  grant?: (
    characterId: string,
    userId: string,
  ) => ReturnType<typeof CharacterService.grantInspiration>;
  writeLine?: EngineChatLineWriter;
  publish?: (sessionId: string, reason: StoryCharacterUpdateReason) => void;
}

function record(
  outcome: InspirationGrantOutcome,
  detail: Record<string, unknown>,
): InspirationGrantOutcome {
  counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  logger.info({ msg: 'DM_INSPIRATION_GRANT', outcome, ...detail });
  return outcome;
}

/**
 * Applies one `inspiration_grant` from a DM reply. Never throws into the turn: a failed write is
 * logged by the caller and the player keeps their reply.
 */
export async function applyStoryInspiration(
  input: { userId: string; sessionId: string; grant: unknown; rollRequested?: boolean },
  deps: InspirationGrantDeps = {},
): Promise<InspirationGrantOutcome> {
  const { userId, sessionId } = input;
  const named = (input.grant as { character_name?: unknown } | null)?.character_name;
  if (typeof named !== 'string' || named.trim() === '') {
    return record('refused', { sessionId, reason: 'no_name' });
  }
  if (input.rollRequested) return record('roll_pending', { sessionId });

  const row = await (deps.character ?? ownedSessionCharacter)(sessionId, userId);
  if (!row) return record('no_character', { sessionId });
  if (row.name.trim().toLowerCase() !== named.trim().toLowerCase()) {
    return record('name_mismatch', { sessionId, characterId: row.id });
  }
  if (envelopeInspiration(row.personalityNotes)) {
    return record('already_held', { sessionId, characterId: row.id });
  }

  const mode = deps.mode ?? inspirationGrantMode();
  if (mode === 'shadow') {
    return record('shadow', { sessionId, characterId: row.id, mode });
  }

  const grantWrite = deps.grant ?? (await loadCharacterService()).grantInspiration;
  const result = await grantWrite(row.id, userId);
  if (!result.success) {
    const outcome = result.reason === 'already_held' ? 'already_held' : 'refused';
    return record(outcome, { sessionId, characterId: row.id, reason: result.reason });
  }

  // The flag is set; the line is one per grant. A later grant is refused by the flag, so a
  // retry of the same reply cannot post a second line.
  const writeLine = deps.writeLine ?? (await import('../engine-chat-line.js')).postEngineChatLine;
  await writeLine({
    sessionId,
    userId,
    idSeed: `inspiration-grant:${randomUUID()}`,
    text: `${row.name} gains Inspiration.`,
    context: { intent: 'inspiration_grant' },
  });
  // The coin refreshes on character_state_updated, like every other story applier (#130). A
  // failed broadcast must not fail the grant: the write already landed.
  try {
    const publish =
      deps.publish ?? (await import('./story-broadcast.js')).publishStoryCharacterUpdate;
    publish(sessionId, 'story_inspiration');
  } catch (broadcastError) {
    logger.warn({
      msg: 'DM_INSPIRATION_BROADCAST_FAILED',
      sessionId,
      characterId: row.id,
      error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
    });
  }
  return record('granted', { sessionId, characterId: row.id, mode });
}
