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
 *
 * #777: falls roll on the server. When the envelope's damage carries a fall height
 * (fallHeightFeet), the server rolls 1d6 bludgeoning per 10 feet fallen, maximum
 * 20d6 (2014 PHB p.183), and ignores the model's amount; the #768 cap still applies
 * to the rolled total. A fall with no height carries no fallHeightFeet and flows
 * through today's clamp path, because there is no height to roll from. A fall under
 * 10 feet rolls 0 dice: it still claims the message's once-per-message slot with a
 * 0-damage marker row (so a regenerated taller fall for the same message is blocked)
 * and moves no HP.
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
  /**
   * #777: when the damage is a fall, the height in feet (whole number, >= 0).
   * The server rolls from it and ignores `amount`. Absent for non-fall damage
   * (and for a fall whose height is unknown — that flows through today's path).
   */
  fallHeightFeet?: number;
}

/** One story beat never deals more than this; larger is a prompt bug, not narration. */
export const MAX_STORY_DAMAGE = 999;

/** 2014 PHB p.183 (#777): a fall deals at most this many d6. */
export const MAX_FALL_DICE = 20;

/** Whole 10-foot bands in a fall; a fall under 10 feet deals no damage. */
export function fallDiceFromHeight(heightFeet: number): number {
  return Math.min(MAX_FALL_DICE, Math.max(0, Math.floor(heightFeet / 10)));
}

/** Sum of `fallDiceFromHeight` d6 rolls; `random` returns a value in [0, 1). */
export function rollFallDamage(heightFeet: number, random: () => number): number {
  const dice = fallDiceFromHeight(heightFeet);
  let total = 0;
  for (let i = 0; i < dice; i++) total += 1 + Math.floor(random() * 6);
  return total;
}

/**
 * Test-only. Seeded RNG for the fall roll. The real-db tests drive the real
 * /v1/llm/generate route, so the roll cannot take an injected parameter — the
 * route's dynamic import resolves to this same module instance. Production
 * leaves `random` unset (Math.random). Follows the storyDamageAfterClaimForTests
 * precedent in this file.
 */
export const storyDamageRandomForTests: { random?: () => number } = {};

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
  // #777: a fall height, when present, must be a whole number of feet >= 0.
  // Anything else (null, a string, a negative, a fraction) is malformed and the
  // whole claim fails closed — the strict schema cannot express null here, so a
  // null reaching the server is not a "fall with unknown height" but bad input.
  const heightValid =
    d.fallHeightFeet === undefined ||
    (typeof d.fallHeightFeet === 'number' &&
      Number.isInteger(d.fallHeightFeet) &&
      d.fallHeightFeet >= 0);
  if (!heightValid) return false;
  // #777 Round 2: when a valid height is present, the height — not the model
  // amount — sets the damage, so the 1..999 amount range is skipped (an amount
  // of 0 or 1000 with a height rolls from the height instead of dropping as
  // invalid_damage). The amount must still be an integer number, and the
  // source rules still apply; with no height the range still applies.
  if (
    typeof d.amount !== 'number' ||
    !Number.isInteger(d.amount) ||
    (d.fallHeightFeet === undefined && (d.amount < 1 || d.amount > MAX_STORY_DAMAGE)) ||
    typeof d.source !== 'string' ||
    d.source.trim().length < 1 ||
    d.source.trim().length > 120
  ) {
    return false;
  }
  return true;
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
    if (typeof damage.fallHeightFeet === 'number') {
      // #777: the height, not the model amount, sets the damage. The #768 cap
      // inside applyStoryDamageOnce still applies to the rolled total.
      const random = storyDamageRandomForTests.random ?? Math.random;
      const dice = fallDiceFromHeight(damage.fallHeightFeet);
      const rolled = rollFallDamage(damage.fallHeightFeet, random);
      logger.info({
        msg: 'DM_STORY_FALL_ROLL',
        sessionId,
        characterId: character.id,
        heightFeet: damage.fallHeightFeet,
        dice,
        rolled,
        modelAmount: damage.amount,
      });
      if (rolled === 0) {
        // A fall under 10 feet deals no damage, but it still consumes the
        // message's once-per-message slot (#777 item 1): without a claim row,
        // a regenerated taller fall for the same message would apply in full.
        // The marker row deals 0 damage and moves no HP; a repeat apply for
        // this message conflicts on it and returns 'already_applied'.
        const { claimEngineChatLine } = await import('../engine-chat-line.js');
        const idSeed = damageIdSeed(sessionId, character.id, message.createdAt);
        const claimed = await claimEngineChatLine({
          sessionId,
          userId,
          idSeed,
          text: `⚙️ Engine: story damage — ${damage.source.trim()} deals 0 damage to ${character.name}.`,
          context: { intent: 'story_damage', claim: true },
        });
        if (!claimed) {
          outcome = 'already_applied';
        } else {
          logger.info({
            msg: 'DM_STORY_FALL_NO_DAMAGE',
            sessionId,
            characterId: character.id,
            heightFeet: damage.fallHeightFeet,
          });
          outcome = 'applied';
        }
      } else {
        outcome = await applyStoryDamageOnce({
          characterId: character.id,
          userId,
          sessionId,
          characterName: character.name,
          since: message.createdAt,
          amount: rolled,
          source: damage.source,
        });
      }
    } else {
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
