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
 * DB imports are lazy (inside the function, after early returns) so unit tests
 * that mock the DB-facing leaves never load db/client at import time -- the
 * same pattern as maybeStartConcentrationOnCast in combat-attack-service.ts.
 *
 * @module server/services/combat/spell-cast-concentration
 */
import { eq } from 'drizzle-orm';

import { extractSpellIdFromPrompt } from './spell-cast-tag.js';
import { resolveCatalogSpell } from '../../data/spellData.js';

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

  // Lazy DB imports: only load db/client when we actually need it.
  const { db } = await import('../../../../db/client');
  const { gameSessions } = await import('../../../../db/schema/index');
  const { getConcentration, startConcentration } = await import('./concentration-service.js');

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


/** What the llm route's post-reply concentration hook is gated on. */
export interface ConcentrationReplyGate {
  /** Truthy when the provider reply failed (`result.error`): a cast the DM never answered. */
  replyError: unknown;
  /**
   * True when the #2718 feature gate refused the turn's casts (the character
   * lacks the spell, or no slot remains for it). The gate's refusal replaces
   * the reply with a refusal envelope and does NOT set `result.error`, so the
   * route reports it separately via its `onCastsRefused` callback.
   */
  castsRefused: boolean;
}

/**
 * The post-reply decision behind the concentration hook in
 * `POST /v1/llm/generate`: start concentration only when the DM reply
 * succeeded AND the cast was not refused. A refused cast and a reply that
 * never arrived both leave concentration exactly as it was.
 *
 * Extracted from the route so the refusal path is testable without driving
 * the HTTP route (and without `mock.module`).
 */
export async function maybeStartConcentrationAfterReply(
  prompt: string | null | undefined,
  sessionId: string | null | undefined,
  gate: ConcentrationReplyGate,
): Promise<boolean> {
  if (gate.replyError || gate.castsRefused) return false;
  return maybeStartConcentrationFromSpellCast(prompt ?? '', sessionId);
}
