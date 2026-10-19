/**
 * Start concentration when a concentration spell is cast outside combat (#709).
 *
 * Combat spells go through `CombatAttackService.resolveSpellAttack`, which calls
 * `maybeStartConcentrationOnCast`. But utility spells (Dancing Lights, Bless, etc.)
 * are narrated by the DM without touching the combat engine -- the cast never
 * reaches `resolveSpellAttack`, so no `character_concentration` row is created and
 * the damage route has nothing to check.
 *
 * The sheet's Cast button appends `[spell_id=<id>, spell_level=<level>]` to the
 * player's message (see `buildSpellCastMessage`). When the llm route sees that
 * tag for a spell with `concentration: true`, the caster starts concentrating.
 * This runs on player intent (the cast was declared), not on DM narration --
 * in 5e you start concentrating when you cast the spell.
 *
 * @module server/services/combat/spell-cast-concentration
 */
import { eq } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { gameSessions } from '../../../../db/schema/index';
import { resolveCatalogSpell } from '../../data/spellData.js';
import { getConcentration, startConcentration } from './concentration-service.js';
import { extractSpellIdFromPrompt } from './spell-cast-tag.js';

export { extractSpellIdFromPrompt };

/**
 * If the prompt declares a concentration spell cast (via the sheet's
 * `[spell_id=...]` tag), start concentration for the session's character.
 * Returns true when concentration was started.
 *
 * Safe to call when there is no tag, the spell is unknown, or the spell does
 * not require concentration -- all are no-ops returning false. Throws nothing;
 * callers wrap it so a DB failure never breaks the chat route.
 */
export async function maybeStartConcentrationFromSpellCast(
  prompt: string,
  sessionId: string | null | undefined,
): Promise<boolean> {
  if (!prompt || !sessionId) return false;
  const spellId = extractSpellIdFromPrompt(prompt);
  if (!spellId) return false;

  const spell = resolveCatalogSpell(spellId);
  if (!spell?.concentration) return false;

  // One character per session; the session owns the concentration state.
  const [session] = await db
    .select({ characterId: gameSessions.characterId })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  const characterId = session?.characterId;
  if (!characterId) return false;

  // Already concentrating on this spell: keep the original startedAt.
  const current = await getConcentration(characterId);
  if (current && current.spellId === spell.id) return true;

  await startConcentration(characterId, { name: spell.name, id: spell.id });
  return true;
}
