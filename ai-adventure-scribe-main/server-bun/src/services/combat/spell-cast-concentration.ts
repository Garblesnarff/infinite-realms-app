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

import type { AllowedCasts } from '../dm/dm-feature-gate.js';

/**
 * If the prompt declares a concentration spell cast (via the sheet's
 * `[spell_id=...]` tag), start concentration for the session's character.
 * Returns true when concentration was started.
 *
 * Safe to call when there is no tag, the spell is unknown, the spell does
 * not require concentration, or the character cannot cast the tagged spell
 * -- all are no-ops returning false. Throws nothing; callers wrap it so a
 * DB failure never breaks the chat route.
 */
export async function maybeStartConcentrationFromSpellCast(
  prompt: string,
  sessionId: string | null | undefined,
  allowedCasts?: AllowedCasts | null,
): Promise<boolean> {
  if (!prompt || !sessionId) return false;
  const spellId =
    extractSpellIdFromPrompt(prompt) ?? (/\bcast\s+bless\b/i.test(prompt) ? 'bless' : null);
  if (!spellId) return false;

  const spell = resolveCatalogSpell(spellId);
  if (!spell?.concentration) return false;

  // Lazy DB imports: only load db/client when we actually need it.
  const { db } = await import('../../../../db/client');
  const { characters, gameSessions } = await import('../../../../db/schema/index');
  const { getConcentration } = await import('./concentration-service.js');
  const { castableSpells, spellKey } = await import('../dm/castable-spells.js');

  // One character per session; the session owns the concentration state.
  const [session] = await db
    .select({ characterId: gameSessions.characterId })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  const characterId = session?.characterId;
  if (!characterId) return false;

  // The character must actually be able to cast the tagged spell. The #2718
  // gate reads cast claims by name from the player's words, and its phrase
  // parser cannot see a claim inside a [spell_id=...] tag, so a tag-only cast
  // is never refused by the gate — the hook checks the spell itself against
  // the same castable list the gate uses.
  if (allowedCasts?.character.id === characterId) {
    if (!allowedCasts.spells.some((name) => spellKey(name) === spellKey(spell.name))) return false;
  } else {
    const [character] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    if (!character) return false;
    const castable = new Set((await castableSpells(character)).map(spellKey));
    if (!castable.has(spellKey(spell.name))) return false;
  }

  // Already concentrating on this spell: keep the original startedAt.
  const current = await getConcentration(characterId);
  if (current && current.spellId === spell.id) return true;

  return startConcentrationOnCast(sessionId, characterId, { name: spell.name, id: spell.id });
}

/**
 * Context key a player message carries: the spell keys whose cast already started
 * concentration for it (#772).
 */
const CONCENTRATION_STARTED_KEY = 'concentrationStartedFor';

/**
 * Start concentration for a cast the player declared in `sessionId`'s newest player message,
 * once per message and spell (#772). Retry re-sends that saved message, and a failed save drops
 * the concentration row, so the row cannot tell a replay from a new cast. The message keeps the
 * list of spells it started instead: a new cast is a new message, so it still starts, and a
 * second concentration spell in the same message still replaces the first. Returns false on a
 * replay.
 */
export async function startConcentrationOnCast(
  sessionId: string,
  characterId: string,
  spell: { name: string; id?: string },
): Promise<boolean> {
  const { playerMessage } = await import('../dm/story-spell-slots.js');
  const { db } = await import('../../../../db/client');
  const { dialogueHistory } = await import('../../../../db/schema/index');
  const { eq, sql } = await import('drizzle-orm');
  const { startConcentration } = await import('./concentration-service.js');
  const message = await playerMessage(sessionId);
  const context = message?.context as Record<string, unknown> | null | undefined;
  const spellKey = spell.id ?? spell.name;
  const started = context?.[CONCENTRATION_STARTED_KEY];
  if (Array.isArray(started) && started.includes(spellKey)) return false;
  await startConcentration(characterId, spell);
  if (message) {
    // A context that is not a JSON object (null, an array, a scalar) is replaced by an
    // object, so the merge below never builds an array out of it.
    const object = sql`CASE WHEN jsonb_typeof(${dialogueHistory.context}) = 'object' THEN ${dialogueHistory.context} ELSE '{}'::jsonb END`;
    await db
      .update(dialogueHistory)
      .set({
        context: sql`${object} || jsonb_build_object(${CONCENTRATION_STARTED_KEY}::text, coalesce(${object} -> ${CONCENTRATION_STARTED_KEY}::text, '[]'::jsonb) || jsonb_build_array(${spellKey}::text))`,
      })
      .where(eq(dialogueHistory.id, message.id));
  }
  return true;
}

/** What the llm route's post-reply concentration hook is gated on. */
export interface ConcentrationReplyGate {
  allowedCasts?: AllowedCasts | null;
  /** Truthy when the provider reply failed (`result.error`): a cast the DM never answered. */
  replyError: unknown;
  /**
   * True when the #2718 feature gate refused the turn's casts (the character
   * lacks the spell, or no slot remains for it). The gate's refusal replaces
   * the reply with a refusal envelope and does NOT set `result.error`, so the
   * route reports it separately via its `onCastsRefused` callback.
   */
  castsRefused: boolean;
  /**
   * False when the request carried no `dmReply`, so the #2718 gate never ran
   * this turn (non-DM generations reach the same route). An ungated turn must
   * not start concentration: no refusal check happened.
   */
  gateRan: boolean;
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
  if (!gate.gateRan || gate.replyError || gate.castsRefused) return false;
  return maybeStartConcentrationFromSpellCast(prompt ?? '', sessionId, gate.allowedCasts);
}
