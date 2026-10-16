/**
 * #610 (#218 step 6): damage the story deals (`damage` in the reply) reaches the sheet.
 * The server is the one writer: it subtracts the amount through `applyNonAttackDamage` —
 * the same writer the client damage route (POST /v1/characters/:id/damage) uses — so a
 * story blow carries the one dying transition (death saves, instant death, the
 * participant row and the sheet in one transaction) and its engine lines. The sheet reads
 * the new HP on its next load (GET /v1/characters/:id).
 *
 * Once per player message, as the slot spend in story-spell-slots.ts: the deterministic
 * engine chat line (`story-damage:<session>:<character>:<message time>`) is the
 * applied-record — a retried turn finds it and stops, so a second application for the
 * same message cannot land. No migration: the line lives in dialogue_history, like the
 * #310 story-XP notice. The notice doubles as the "damage line" #610's reporter looked
 * for: it is posted in chat and broadcast, so a live session sees it without a refresh.
 *
 * Module stays importable without DATABASE_URL (db/client throws at load without it), so
 * the pure validator tests run outside the real-DB suite: every DB-touching import is
 * lazy, inside the functions.
 */

import { logger } from '../../lib/logger.js';

export type StoryDamageOutcome =
  | 'applied'
  | 'already_applied'
  | 'invalid_damage'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending';

export interface StoryDamage {
  amount: number;
  source: string;
}

/** One story beat never deals more than this; larger is a prompt bug, not narration. */
export const MAX_STORY_DAMAGE = 999;

export function validDamage(damage: unknown): damage is StoryDamage {
  if (!damage || typeof damage !== 'object') return false;
  const d = damage as Record<string, unknown>;
  return (
    typeof d.amount === 'number' &&
    Number.isInteger(d.amount) &&
    d.amount >= 1 &&
    d.amount <= MAX_STORY_DAMAGE &&
    typeof d.source === 'string' &&
    d.source.trim().length >= 1 &&
    d.source.trim().length <= 120
  );
}

const damageIdSeed = (sessionId: string, characterId: string, since: Date): string =>
  `story-damage:${sessionId}:${characterId}:${since.getTime()}`;

/**
 * The single writer. The deterministic engine line is the applied-record: a retried turn
 * finds it and stops before any HP moves, so the same player message cannot deal its
 * damage twice.
 */
export async function applyStoryDamageOnce(input: {
  characterId: string;
  userId: string;
  sessionId: string;
  characterName: string;
  since: Date;
  amount: number;
  source: string;
}): Promise<'applied' | 'already_applied'> {
  const { characterId, userId, sessionId, characterName, since, amount, source } = input;
  const { engineChatLineExists, postEngineChatLine } = await import('../engine-chat-line.js');
  const idSeed = damageIdSeed(sessionId, characterId, since);
  if (await engineChatLineExists(idSeed)) return 'already_applied';
  const { applyNonAttackDamage } = await import('../combat/non-attack-damage.js');
  const { vitals, engineLines } = await applyNonAttackDamage(
    characterId,
    userId,
    amount,
    `story: ${source.trim()}`,
  );
  const lines = [
    `⚙️ Engine: story damage — ${source.trim()} deals ${amount} damage to ${characterName}. ` +
      `HP ${vitals.currentHitPoints}/${vitals.maxHitPoints}.`,
    ...engineLines,
  ];
  try {
    await postEngineChatLine({
      sessionId,
      userId,
      idSeed,
      text: lines.join('\n'),
      context: {
        intent: 'story_damage',
        combatEngineBlocks: [{ sequence: 0, source: 'system', lines, cards: [] }],
      },
    });
  } catch (error) {
    // The damage already landed and the sheet shows it; the notice is cosmetic.
    // Residual: a notice write that fails leaves no applied-record, so a retry of the
    // same player message would apply the damage again — the same failure mode as the
    // client damage route's own retry. Logged for the #218 follow-up (a damage-events
    // table would close it the way experienceEvents closed it for XP).
    logger.warn({
      msg: 'STORY_DAMAGE_NOTICE_FAILED',
      sessionId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return 'applied';
}

/** Reads the reply's `damage` and applies it for the session's own character. */
export async function applyStoryDamage(input: {
  userId: string;
  sessionId: string;
  damage: unknown;
  /** The reply asks for a roll: the outcome is not known yet, so nothing is dealt yet. */
  rollRequested?: boolean;
}): Promise<StoryDamageOutcome> {
  const { userId, sessionId } = input;
  const { ownedSessionCharacter } = await import('./dm-feature-gate.js');
  const { playerMessage } = await import('./story-spell-slots.js');
  const character = await ownedSessionCharacter(sessionId, userId);
  const message = character ? await playerMessage(sessionId) : null;
  let outcome: StoryDamageOutcome;
  if (!character) outcome = 'no_character';
  // The damage belongs to the roll's result, which arrives as its own player message.
  else if (input.rollRequested) outcome = 'roll_pending';
  else if (!validDamage(input.damage)) outcome = 'invalid_damage';
  // No saved player message: the turn answers nothing the player did.
  else if (!message?.createdAt) outcome = 'no_player_message';
  else {
    const damage = input.damage as StoryDamage;
    outcome = await applyStoryDamageOnce({
      characterId: character.id,
      userId,
      sessionId,
      characterName: character.name,
      since: message.createdAt,
      amount: damage.amount,
      source: damage.source,
    });
  }
  logger.info({
    msg: 'DM_STORY_DAMAGE',
    sessionId,
    characterId: character?.id ?? null,
    amount:
      input.damage && typeof input.damage === 'object'
        ? (input.damage as { amount?: unknown }).amount
        : undefined,
    outcome,
  });
  return outcome;
}
