/**
 * #218 step 1: a spell the player casts in the story, and the DM turn's gate allows, spends its
 * slot on the sheet. The server is the one writer (`SpellSlotsService.spendStoryCastSlots`); the
 * sheet reads `character_spell_slots` on its next load.
 *
 * One slot of the spell's own level. A cantrip spends nothing, and neither does a ritual the
 * player says they cast as a ritual (RP-13) — but only for a class with ritual casting (#217
 * FIX round 3). Upcasting, pact slots and refusing a cast with no slot left are not handled
 * here; the refusal check below owns the 2014 5e slot rules.
 */

import { resolveCatalogSpell } from '../../data/spellData.js';
import { logger } from '../../lib/logger.js';
import { SpellSlotsService } from '../spell-slots-service.js';

import type { AllowedCasts } from './dm-feature-gate.js';

/** Classes with ritual casting in 2014 5e (SRD 5.1): a ritual cast as a ritual needs no
 *  slot. Sorcerer, Ranger, Paladin get nothing; Warlock only via Book of Ancient Secrets,
 *  which is not tracked — so warlock gets no exemption here. */
const RITUAL_CASTING_CLASSES = new Set(['wizard', 'cleric', 'druid', 'bard']);

/** Pact-magic classes: their slots are a separate pool the slot rows do not track. */
const PACT_CLASSES = new Set(['warlock']);

/**
 * "I cast it as a ritual" — but "not as a ritual" must not count. The negation check
 * runs first so "I cast Detect Magic, not as a ritual" is never a ritual cast.
 */
export function isCastAsRitual(playerInput: string | undefined): boolean {
  const input = playerInput ?? '';
  if (/\b(?:not|n't|without|never)\b[\w\s,]{0,24}\bas\s+a\s+ritual\b/i.test(input)) return false;
  return (
    /\bas\s+a\s+ritual\b/i.test(input) ||
    /\britually\b/i.test(input) ||
    /\britual\s+casting\b/i.test(input)
  );
}

/**
 * The class that granted the spell: `character_spells.source_class_id`, else the
 * character's own class. Drives the pact-magic and ritual-casting rules below.
 */
async function castingClassName(
  characterId: string,
  characterClass: string | null,
  spellName: string,
): Promise<string> {
  const { db } = await import('../../../../db/client');
  const { and, eq, sql } = await import('drizzle-orm');
  const { characterSpells, spells, classes } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ name: classes.name })
    .from(characterSpells)
    .innerJoin(spells, eq(characterSpells.spellId, spells.id))
    .innerJoin(classes, eq(characterSpells.sourceClassId, classes.id))
    .where(
      and(
        eq(characterSpells.characterId, characterId),
        eq(sql`lower(${spells.name})`, spellName.toLowerCase()),
      ),
    )
    .limit(1);
  return (row?.name ?? characterClass ?? '').toLowerCase();
}

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
    // The ritual exemption must match the gate's (spellsWithNoSlot below): a ritual cast
    // as a ritual spends nothing only for a class with ritual casting. Anything else
    // falls through to the slot spend.
    const castingClass = await castingClassName(casts.character.id, casts.character.class, spellName);
    const ritualExempt =
      (catalog?.ritual ?? false) &&
      isCastAsRitual(playerInput) &&
      RITUAL_CASTING_CLASSES.has(castingClass);
    if (diceRoll) outcomes.set(spellName, 'dice_roll');
    else if (spellLevel === null) outcomes.set(spellName, 'unknown_level');
    else if (spellLevel === 0) outcomes.set(spellName, 'cantrip');
    else if (ritualExempt) outcomes.set(spellName, 'ritual');
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
 * #217 (RP-11): which of the gate-allowed casts have no slot left to spend. The spend
 * below runs after the reply is allowed, so it cannot refuse — the gate calls this first.
 * 2014 5e rules (FIX round 3):
 * - Upcasting: a slot of the spell's level OR HIGHER pays. Refuse only when every row
 *   at the spell's level and above is spent.
 * - Rituals: a ritual cast as a ritual needs no slot, but only for a class with ritual
 *   casting (wizard/cleric/druid/bard). "not as a ritual" is not a ritual cast.
 * - Pact magic: a warlock spell checks nothing — pact slots are a separate pool the
 *   slot rows do not track, so a spent wizard row never blocks a warlock spell.
 * Fails open, as the gate's header requires:
 * - no `character_spell_slots` rows at all: a first cast initializes them in the spend;
 * - an unknown spell level, a cantrip, and a dice-roll report (a cast the turn already
 *   spent — refusing it would punish reporting the roll);
 * - a retried turn: retry replays the same saved player message, and the spend's own
 *   `already_spent` rule (a usage-log row at or after the message) means its casts are paid for.
 */
export async function spellsWithNoSlot(input: {
  character: { id: string; class?: string | null };
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
    const className = await castingClassName(character.id, character.class ?? null, name);
    // Pact magic: warlock pact slots are separate and untracked — never refuse on the
    // shared rows.
    if (PACT_CLASSES.has(className)) continue;
    // Ritual cast as a ritual: no slot needed, but only for ritual-casting classes.
    if (
      (catalog?.ritual ?? false) &&
      isCastAsRitual(playerInput) &&
      RITUAL_CASTING_CLASSES.has(className)
    )
      continue;
    // Upcasting: refuse only when no slot at the spell's level or higher remains.
    const rows = await db
      .select({
        totalSlots: characterSpellSlots.totalSlots,
        usedSlots: characterSpellSlots.usedSlots,
      })
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, character.id),
          gte(characterSpellSlots.spellLevel, level),
        ),
      );
    if (!rows.length) continue;
    if (rows.some((row) => row.usedSlots < row.totalSlots)) continue;
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
