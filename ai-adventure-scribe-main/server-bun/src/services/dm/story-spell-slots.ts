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
export async function storedSpellLevel(name: string): Promise<number | null> {
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

/**
 * #217 (RP-11): which of the gate-allowed casts have no slot left at their level. The spend
 * below runs after the reply is allowed, so it cannot refuse — the gate calls this first.
 * Fails open, as the gate's header requires:
 * - no `character_spell_slots` row: a first cast initializes it in the spend, and a class with
 *   no slots at that level never reaches the spend (its `no_slot` outcome is logged there);
 * - an unknown spell level, a cantrip, and a ritual cast as a ritual spend nothing;
 * - a dice-roll report (`playerMessage` intent) describes a cast the turn already spent — the
 *   slot it used is gone by design, so refusing it would punish reporting the roll;
 * - a retried turn: retry replays the same saved player message, and the spend's own
 *   `already_spent` rule (a usage-log row at or after the message) means its casts are paid for.
 */
export async function spellsWithNoSlot(input: {
  character: { id: string };
  sessionId: string | undefined;
  playerInput: string | undefined;
  spells: string[];
}): Promise<Array<{ name: string; level: number }>> {
  const { character, sessionId, playerInput, spells } = input;
  if (!sessionId || !spells.length) return [];
  const message = await playerMessage(sessionId);
  if ((message?.context as { intent?: unknown } | null)?.intent === 'dice_roll') return [];
  const { db } = await import('../../../../db/client');
  const { and, eq, gte } = await import('drizzle-orm');
  const { characterSpellSlots, spellSlotUsageLog } = await import('../../../../db/schema/index');
  // Retry replays the same saved player message without saving a new one: if its casts were
  // already spent — a usage-log row at or after the message, the spend's own `already_spent`
  // rule — the ledger reads full because of that spend, not because of a new cast.
  if (message?.createdAt) {
    const [paid] = await db
      .select({ id: spellSlotUsageLog.id })
      .from(spellSlotUsageLog)
      .where(
        and(
          eq(spellSlotUsageLog.characterId, character.id),
          eq(spellSlotUsageLog.sessionId, sessionId),
          gte(spellSlotUsageLog.timestamp, message.createdAt),
        ),
      )
      .limit(1);
    if (paid) return [];
  }
  const refused: Array<{ name: string; level: number }> = [];
  for (const name of spells) {
    const catalog = resolveCatalogSpell(name, name);
    const level = catalog?.level ?? (await storedSpellLevel(name));
    if (level === null || level === 0) continue;
    if (catalog?.ritual && /\britual\b/i.test(playerInput ?? '')) continue;
    const [slot] = await db
      .select({
        totalSlots: characterSpellSlots.totalSlots,
        usedSlots: characterSpellSlots.usedSlots,
      })
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, character.id),
          eq(characterSpellSlots.spellLevel, level),
        ),
      )
      .limit(1);
    if (!slot || slot.usedSlots < slot.totalSlots) continue;
    refused.push({ name, level });
  }
  return refused;
}

/** The one line a cast refused for lack of a slot gets (#217, RP-11). */
export function slotRefusalLine(characterName: string, spellName: string, level: number): string {
  return `${characterName} can't cast ${spellName}: no ${ordinal(level)}-level spell slots left.`;
}

const ordinal = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};
