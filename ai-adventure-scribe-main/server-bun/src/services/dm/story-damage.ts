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
 * applied-record. The insert is the claim (#777): `onConflictDoNothing` on
 * dialogue_history's primary key, and zero rows means already applied, so HP does
 * not move. No migration. The notice doubles as the "damage line" #610's reporter
 * looked for: after the HP write it is rewritten with the result and broadcast, so a
 * live session sees it without a refresh. A throw after the insert and before any
 * HP change deletes that row, so a retry applies once. A throw after the HP write
 * keeps the row, so a retry does not apply twice.
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

/**
 * The strategist's bound (#768 FIX): story damage never kills outright. Above 1 HP the
 * claim is capped at current HP minus 1, so the worst it can do is drop the hero to 1;
 * at 1 HP it is capped at 1, so it may drop the hero to 0 (dying, death saves) but can
 * never overflow into instant death. At 0 HP the claim is capped below the maximum, so
 * the SRD at-zero rule applies (one failure per hit) and an inflated claim cannot
 * overflow into instant death there either.
 */
export function capStoryDamage(
  amount: number,
  currentHitPoints: number,
  maxHitPoints: number,
): number {
  if (currentHitPoints > 1) return Math.min(amount, currentHitPoints - 1);
  if (currentHitPoints === 1) return Math.min(amount, 1);
  return Math.min(amount, Math.max(1, maxHitPoints - 1));
}

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
 * Test-only. Runs after the claim insert and before the HP write.
 * Production leaves `run` unset.
 */
export const storyDamageAfterClaimForTests: { run?: () => Promise<void> | void } = {};

/**
 * The single writer. The dialogue_history primary key is the claim (#777): the insert
 * runs before any HP write, and a conflict means this message already applied.
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
  const { claimEngineChatLine, rewriteEngineChatLine } = await import('../engine-chat-line.js');
  const idSeed = damageIdSeed(sessionId, characterId, since);
  // The per-hit half-max net is off on this path (character-vitals-service.ts deliberately
  // leaves `targetIsPlayer` unset for DM-resolved damage), so an uncapped claim of 25 on a
  // 12 HP hero — or 999 — would be massive damage and kill outright. The cap makes story
  // damage unable to kill: it can drop a hero to 1, never past it.
  const { CharacterVitalsService } = await import('../character-vitals-service.js');
  const before = await CharacterVitalsService.getVitals(characterId, userId);
  const capped = capStoryDamage(amount, before.currentHitPoints, before.maxHitPoints);
  const sourceText = source.trim();
  const damageSentence =
    `⚙️ Engine: story damage — ${sourceText} deals ${capped} damage to ${characterName}` +
    (capped !== amount ? ` (capped from a claim of ${amount})` : '');
  const claimed = await claimEngineChatLine({
    sessionId,
    userId,
    idSeed,
    text: `${damageSentence}.`,
    context: { intent: 'story_damage', claim: true },
  });
  if (!claimed) return 'already_applied';
  if (capped !== amount) {
    logger.info({
      msg: 'DM_STORY_DAMAGE_CAPPED',
      sessionId,
      characterId,
      claimed: amount,
      capped,
      currentHitPoints: before.currentHitPoints,
    });
  }
  try {
    if (storyDamageAfterClaimForTests.run) await storyDamageAfterClaimForTests.run();
    const { applyNonAttackDamage } = await import('../combat/non-attack-damage.js');
    const { vitals, engineLines } = await applyNonAttackDamage(
      characterId,
      userId,
      capped,
      `story: ${sourceText}`,
    );
    // #130: the live sheet only refreshes on combat-state-updated (#2641), but
    // story damage lands out of combat — publish the invalidation so the
    // sheet's CharacterContext refetches instead of showing the stale HP.
    // A failed broadcast must not fail the damage: the write already landed.
    try {
      const { publishStoryCharacterUpdate } = await import('./story-broadcast.js');
      publishStoryCharacterUpdate(sessionId, 'story_damage');
    } catch (broadcastError) {
      logger.warn({
        msg: 'DM_STORY_DAMAGE_BROADCAST_FAILED',
        sessionId,
        characterId,
        error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
      });
    }
    const lines = [
      `${damageSentence}. HP ${vitals.currentHitPoints}/${vitals.maxHitPoints}.`,
      ...engineLines,
    ];
    try {
      await rewriteEngineChatLine({
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
      // The damage already landed and the claim row is the applied-record, so a retry
      // must not apply again. The notice text is cosmetic.
      logger.warn({
        msg: 'STORY_DAMAGE_NOTICE_FAILED',
        sessionId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return 'applied';
  } catch (error) {
    // The claim committed before the HP write. If that write did not happen,
    // drop the row so a retry can apply once. If HP moved, keep the row.
    let wrote = true;
    try {
      const after = await CharacterVitalsService.getVitals(characterId, userId);
      wrote =
        after.currentHitPoints !== before.currentHitPoints ||
        after.temporaryHitPoints !== before.temporaryHitPoints ||
        after.vitalState !== before.vitalState ||
        after.deathSavesFailures !== before.deathSavesFailures;
    } catch {
      wrote = true;
    }
    if (!wrote) {
      const { releaseEngineChatLine } = await import('../engine-chat-line.js');
      await releaseEngineChatLine(idSeed);
    }
    throw error;
  }
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
