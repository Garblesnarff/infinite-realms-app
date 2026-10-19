/**
 * #709: casting a concentration spell outside combat starts concentration.
 *
 * The sheet's Cast button appends `[spell_id=<id>, spell_level=<level>]` to the
 * player's message. When the spell has `concentration: true`, the server must
 * create the `character_concentration` row so the damage route prompts CON
 * saves and the sheet shows the marker.
 *
 * Fixtures follow the real producers:
 * - The `[spell_id=...]` tag format follows `buildSpellCastMessage`
 *   (src/features/game-session/components/game/overhaul/spell-view-model.ts).
 * - Spell data follows the SRD catalog via `resolveCatalogSpell`
 *   (server-bun/src/data/spellData.ts); Dancing Lights has concentration: true.
 * - The session->character link follows `game_sessions.character_id`
 *   (db/schema/game.ts).
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  realDb,
  testId,
} from '../../__tests__/fixtures/real-db.js';
import {
  characterConcentration,
  characters,
  gameSessions,
} from '../../../../../db/schema/index';
import { getConcentration } from '../concentration-service.js';
import {
  extractSpellIdFromPrompt,
  maybeStartConcentrationFromSpellCast,
} from '../spell-cast-concentration.js';

if (!hasRealDb) {
  console.warn('[spell-cast-concentration] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

describe('extractSpellIdFromPrompt', () => {
  it('extracts the spell id from the sheet Cast tag', () => {
    expect(
      extractSpellIdFromPrompt('I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].'),
    ).toBe('dancing-lights');
  });

  it('extracts the spell id when the tag has no trailing comma', () => {
    expect(extractSpellIdFromPrompt('I cast Bless [spell_id=bless]')).toBe('bless');
  });

  it('returns null when there is no tag', () => {
    expect(extractSpellIdFromPrompt('I cast Dancing Lights')).toBeNull();
  });

  it('returns null for an empty prompt', () => {
    expect(extractSpellIdFromPrompt('')).toBeNull();
  });
});

describeWithDb('maybeStartConcentrationFromSpellCast', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('user');

  let characterId: string;
  let sessionId: string;
  let sessionWithoutCharacterId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;
    const [{ id }] = await db
      .insert(characters)
      .values({ userId, name: testId('caster'), level: 3 })
      .returning({ id: characters.id });
    characterId = id;

    const [session] = await db
      .insert(gameSessions)
      .values({ characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    sessionId = session.id;

    const [noCharSession] = await db
      .insert(gameSessions)
      .values({ characterId: null, sessionNumber: 2, status: 'active' })
      .returning({ id: gameSessions.id });
    sessionWithoutCharacterId = noCharSession.id;
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    await closeRealDb();
  });

  it('starts concentration when the prompt casts Dancing Lights (concentration cantrip)', async () => {
    const started = await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    expect(started).toBe(true);
    const state = await getConcentration(characterId);
    expect(state?.spellName).toBe('Dancing Lights');
    expect(state?.spellId).toBe('dancing-lights');
  });

  it('does not start concentration for Fire Bolt (no concentration)', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const started = await maybeStartConcentrationFromSpellCast(
      'I cast Fire Bolt [spell_id=fire-bolt, spell_level=cantrip].',
      sessionId,
    );
    expect(started).toBe(false);
    expect(await getConcentration(characterId)).toBeNull();
  });

  it('does not start concentration when the prompt has no spell tag', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const started = await maybeStartConcentrationFromSpellCast('I cast Dancing Lights', sessionId);
    expect(started).toBe(false);
    expect(await getConcentration(characterId)).toBeNull();
  });

  it('does not start concentration for an unknown spell id', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const started = await maybeStartConcentrationFromSpellCast(
      'I cast Not A Spell [spell_id=not-a-spell, spell_level=cantrip].',
      sessionId,
    );
    expect(started).toBe(false);
    expect(await getConcentration(characterId)).toBeNull();
  });

  it('does not start concentration when the session has no character', async () => {
    const started = await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionWithoutCharacterId,
    );
    expect(started).toBe(false);
  });

  it('is idempotent when already concentrating on the same spell', async () => {
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    const before = await getConcentration(characterId);
    const started = await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    expect(started).toBe(true);
    const after = await getConcentration(characterId);
    // Same row kept (not replaced): the original startedAt survives.
    expect(after?.id).toBe(before?.id);
  });

  it('replaces concentration when a different concentration spell is cast', async () => {
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    const started = await maybeStartConcentrationFromSpellCast(
      'I cast Bless [spell_id=bless, spell_level=level 1].',
      sessionId,
    );
    expect(started).toBe(true);
    const state = await getConcentration(characterId);
    expect(state?.spellName).toBe('Bless');
  });

  it('a CON save fires on damage after the spell-cast started concentration', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    // The caster needs CON 14 (+2) for the save math; reuse the characters row.
    const { checkConcentrationOnDamage } = await import('../concentration-service.js');
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    // Pin the d20 to 10: 10 + 2 = 12 vs DC 10 (2 damage) -> success, kept.
    const result = await checkConcentrationOnDamage(characterId, 2, { rollD20Fn: () => 10 });
    expect(result.hadConcentration).toBe(true);
    expect(result.saveTriggered).toBe(true);
    expect(result.dc).toBe(10);
    expect(result.success).toBe(true);
    expect(result.dropped).toBe(false);
    // Concentration survives the successful save.
    expect((await getConcentration(characterId))?.spellName).toBe('Dancing Lights');
  });

  it('a failed CON save after the spell-cast drops concentration', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const { checkConcentrationOnDamage } = await import('../concentration-service.js');
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    // Pin the d20 to 1: 1 + 2 = 3 vs DC 10 -> fail, dropped.
    const result = await checkConcentrationOnDamage(characterId, 2, { rollD20Fn: () => 1 });
    expect(result.saveTriggered).toBe(true);
    expect(result.success).toBe(false);
    expect(result.dropped).toBe(true);
    expect(result.droppedSpell).toBe('Dancing Lights');
    expect(await getConcentration(characterId)).toBeNull();
  });
});
