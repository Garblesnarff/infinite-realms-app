/**
 * #218 step 4: conditions the story applies or removes (`conditions` in the reply) reach the
 * sheet. The server is the one writer: it writes `character_conditions` rows — the
 * out-of-combat table, keyed on the character with clock-based duration (there is no
 * encounter and no participant outside combat) — which the sheet reads on its next load
 * through GET /v1/characters/:id.
 *
 * Idempotency comes from the active state, not the player message: 2014 5e says a creature
 * subjected to the same condition twice suffers no additional effect, so an apply while
 * the condition is already active is a no-op, and a remove with nothing active removes
 * nothing. A retry of the same turn therefore lands exactly once.
 *
 * Known limitation: exhaustion stacks by level in 5e (1–6), but `character_conditions`
 * tracks no level, so re-applying exhaustion while it is active is dropped rather than
 * escalated. Timed conditions are stored against the clock; the sheet shows the name
 * with no remaining-time display.
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { playerMessage } from './story-spell-slots.js';
import { logger } from '../../lib/logger.js';

export type StoryConditionChange = {
  name: string;
  change: 'apply' | 'remove';
  duration_minutes?: number | null;
};

export type StoryConditionsOutcome =
  | 'applied'
  | 'already_applied'
  | 'invalid_conditions'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending';

/** A turn that changes more than this many conditions is a prompt bug, not narration. */
const MAX_CONDITIONS_PER_TURN = 6;

/**
 * FIX round 3: the 15 conditions of 2014 5e (SRD 5.1). The story may only apply
 * or remove these — a name outside this list is invalid, whatever the library
 * happens to hold. Exhaustion *levels* (1–6 stacking) stay a follow-up (#218).
 */
export const SRD_2014_CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;

function validConditions(conditions: unknown): conditions is StoryConditionChange[] {
  if (
    !Array.isArray(conditions) ||
    conditions.length === 0 ||
    conditions.length > MAX_CONDITIONS_PER_TURN
  )
    return false;
  return conditions.every((condition) => {
    if (!condition || typeof condition !== 'object') return false;
    const c = condition as StoryConditionChange;
    if (typeof c.name !== 'string' || c.name.trim().length === 0 || c.name.trim().length > 40)
      return false;
    if (
      !(SRD_2014_CONDITIONS as readonly string[]).includes(c.name.trim().toLowerCase())
    )
      return false;
    if (c.change !== 'apply' && c.change !== 'remove') return false;
    if (c.duration_minutes == null) return true;
    return (
      Number.isInteger(c.duration_minutes) &&
      c.duration_minutes >= 1 &&
      c.duration_minutes <= 24 * 60
    );
  });
}

async function libraryIdFor(name: string): Promise<{ id: string } | null> {
  const { db } = await import('../../../../db/client');
  const { eq, sql } = await import('drizzle-orm');
  const { conditionsLibrary } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ id: conditionsLibrary.id })
    .from(conditionsLibrary)
    .where(eq(sql`lower(${conditionsLibrary.name})`, name.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function applyStoryConditionsOnce(input: {
  characterId: string;
  conditions: Array<StoryConditionChange & { conditionId: string }>;
}): Promise<'applied' | 'already_applied'> {
  const { db } = await import('../../../../db/client');
  const { and, eq, gt, isNull, or } = await import('drizzle-orm');
  const { characterConditions, characters } = await import('../../../../db/schema/index');
  const { characterId, conditions } = input;
  const now = new Date();
  const notExpired = or(isNull(characterConditions.expiresAt), gt(characterConditions.expiresAt, now));
  return db.transaction(async (tx) => {
    // Lock the character row: two turns for one message cannot both read "no active
    // condition" and both insert.
    const [locked] = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .for('update');
    if (!locked) return 'already_applied';
    let anyApplied = false;
    for (const condition of conditions) {
      const active = await tx
        .select({ id: characterConditions.id })
        .from(characterConditions)
        .where(
          and(
            eq(characterConditions.characterId, characterId),
            eq(characterConditions.conditionId, condition.conditionId),
            eq(characterConditions.isActive, true),
            notExpired,
          ),
        )
        .limit(1);
      if (condition.change === 'apply') {
        // 5e: the same condition twice has no additional effect; a retry is a no-op too.
        if (active.length > 0) continue;
        const minutes =
          typeof condition.duration_minutes === 'number' ? condition.duration_minutes : null;
        await tx.insert(characterConditions).values({
          characterId,
          conditionId: condition.conditionId,
          durationType: minutes ? 'minutes' : 'permanent',
          durationValue: minutes,
          expiresAt: minutes ? new Date(now.getTime() + minutes * 60_000) : null,
          sourceDescription: 'Applied in the story',
          isActive: true,
        });
        anyApplied = true;
      } else {
        if (active.length === 0) continue;
        await tx
          .update(characterConditions)
          .set({ isActive: false })
          .where(
            and(
              eq(characterConditions.characterId, characterId),
              eq(characterConditions.conditionId, condition.conditionId),
              eq(characterConditions.isActive, true),
            ),
          );
        anyApplied = true;
      }
    }
    return anyApplied ? 'applied' : 'already_applied';
  });
}

/** Reads the reply's `conditions` and applies them for the session's own character. */
export async function applyStoryConditions(input: {
  userId: string;
  sessionId: string;
  conditions: unknown;
  /** The reply asks for a roll: the outcome is not known yet, so nothing is applied yet. */
  rollRequested?: boolean;
}): Promise<StoryConditionsOutcome> {
  const { userId, sessionId } = input;
  const character = await ownedSessionCharacter(sessionId, userId);
  const message = character ? await playerMessage(sessionId) : null;
  let outcome: StoryConditionsOutcome;
  if (!character) outcome = 'no_character';
  // The condition belongs to the roll's result, which arrives as its own player message.
  else if (input.rollRequested) outcome = 'roll_pending';
  else if (!validConditions(input.conditions)) outcome = 'invalid_conditions';
  // No saved player message: the turn answers nothing the player did.
  else if (!message?.createdAt) outcome = 'no_player_message';
  else {
    const resolved: Array<StoryConditionChange & { conditionId: string }> = [];
    let unknownName = false;
    for (const condition of input.conditions as StoryConditionChange[]) {
      const library = await libraryIdFor(condition.name.trim());
      if (!library) {
        unknownName = true;
        break;
      }
      resolved.push({ ...condition, name: condition.name.trim(), conditionId: library.id });
    }
    outcome = unknownName
      ? 'invalid_conditions'
      : await applyStoryConditionsOnce({ characterId: character.id, conditions: resolved });
  }
  logger.info({
    msg: 'DM_STORY_CONDITIONS',
    sessionId,
    characterId: character?.id ?? null,
    count: Array.isArray(input.conditions) ? input.conditions.length : 0,
    outcome,
  });
  return outcome;
}

/**
 * What the sheet's Conditions panel shows: active, non-expired character conditions.
 * `duration` follows the client Condition shape (rounds, -1 permanent); clock-based
 * out-of-combat conditions carry no round count, so 0 renders as no duration.
 */
export async function getActiveCharacterConditions(
  characterId: string,
): Promise<Array<{ name: string; description: string; duration: number }>> {
  const { db } = await import('../../../../db/client');
  const { and, eq, gt, isNull, or } = await import('drizzle-orm');
  const { characterConditions, conditionsLibrary } = await import('../../../../db/schema/index');
  const now = new Date();
  const rows = await db
    .select({
      name: conditionsLibrary.name,
      description: conditionsLibrary.description,
      durationType: characterConditions.durationType,
    })
    .from(characterConditions)
    .innerJoin(conditionsLibrary, eq(characterConditions.conditionId, conditionsLibrary.id))
    .where(
      and(
        eq(characterConditions.characterId, characterId),
        eq(characterConditions.isActive, true),
        or(isNull(characterConditions.expiresAt), gt(characterConditions.expiresAt, now)),
      ),
    );
  return rows.map((row) => ({
    name: row.name,
    description: row.description ?? '',
    duration: row.durationType === 'permanent' ? -1 : 0,
  }));
}
