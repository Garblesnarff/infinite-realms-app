/**
 * #218 step 1: a spell the player casts in the story, and the DM turn's gate allows, spends its
 * slot on the sheet. The server is the one writer (`SpellSlotsService.spendStoryCastSlots`); the
 * sheet reads `character_spell_slots` on its next load.
 *
 * One slot of the spell's own level. A cantrip spends nothing, and neither does a ritual the
 * player says they cast as a ritual (RP-13). Upcasting, pact slots and refusing a cast with no
 * slot left are not handled here.
 */

import { resolveCatalogSpell } from '../../data/spellData.js';
import { logger } from '../../lib/logger.js';
import { SpellSlotsService } from '../spell-slots-service.js';

import type { AllowedCasts } from './dm-feature-gate.js';

/**
 * The player message the turn answers: the session's newest player row. The client saves it
 * before the DM turn starts, and Retry re-sends that saved message without saving a new one.
 */
export async function playerMessage(
  sessionId: string,
): Promise<{ createdAt: Date | null; context: unknown } | null> {
  const { db } = await import('../../../../db/client');
  const { and, desc, eq } = await import('drizzle-orm');
  const { dialogueHistory } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ createdAt: dialogueHistory.createdAt, context: dialogueHistory.context })
    .from(dialogueHistory)
    .where(and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'player')))
    .orderBy(desc(dialogueHistory.createdAt))
    .limit(1);
  return row ?? null;
}

/** A spell the catalog does not hold has its level in the `spells` table, when it is there. */
async function storedSpellLevel(name: string): Promise<number | null> {
  const { db } = await import('../../../../db/client');
  const { eq, sql } = await import('drizzle-orm');
  const { spells } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ level: spells.level })
    .from(spells)
    .where(eq(sql`lower(${spells.name})`, name.toLowerCase()))
    .limit(1);
  return row?.level ?? null;
}

export async function spendStorySpellSlots(input: {
  userId: string;
  sessionId: string;
  playerInput: string;
  casts: AllowedCasts;
}): Promise<void> {
  const { userId, sessionId, playerInput, casts } = input;
  const message = await playerMessage(sessionId);
  // A dice-roll result is sent as the player's input, and its text is the DM's roll purpose
  // ("Arcana to cast Burning Hands: 15"): it reports a cast already spent for, never a new one.
  const diceRoll = (message?.context as { intent?: unknown } | null)?.intent === 'dice_roll';
  const outcomes = new Map<string, string>();
  const toSpend: Array<{ spellName: string; spellLevel: number }> = [];
  for (const spellName of casts.spells) {
    const catalog = resolveCatalogSpell(spellName, spellName);
    const spellLevel = catalog?.level ?? (await storedSpellLevel(spellName));
    if (diceRoll) outcomes.set(spellName, 'dice_roll');
    else if (spellLevel === null) outcomes.set(spellName, 'unknown_level');
    else if (spellLevel === 0) outcomes.set(spellName, 'cantrip');
    else if (catalog?.ritual && /\britual\b/i.test(playerInput)) outcomes.set(spellName, 'ritual');
    else toSpend.push({ spellName, spellLevel });
  }
  if (toSpend.length) {
    const spent = await SpellSlotsService.spendStoryCastSlots({
      characterId: casts.character.id,
      userId,
      sessionId,
      since: message?.createdAt ?? null,
      spells: toSpend,
    });
    toSpend.forEach(({ spellName }, index) => outcomes.set(spellName, spent[index] ?? 'unknown'));
  }
  for (const [spellName, outcome] of outcomes) {
    logger.info({
      msg: 'DM_STORY_SLOT_SPEND',
      sessionId,
      characterId: casts.character.id,
      spellName,
      outcome,
    });
  }
}
