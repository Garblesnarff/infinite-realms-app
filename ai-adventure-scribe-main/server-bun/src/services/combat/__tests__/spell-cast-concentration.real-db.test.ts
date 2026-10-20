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
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  campaigns,
  characterConcentration,
  characters,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  realDb,
  testId,
} from '../../__tests__/fixtures/real-db.js';

import type * as ConcentrationService from '../concentration-service.js';
import type * as SpellCastConcentration from '../spell-cast-concentration.js';

if (!hasRealDb) {
  console.warn(
    '[spell-cast-concentration] SKIPPED: set TEST_DATABASE_URL to run these.',
  );
}

describeWithDb('maybeStartConcentrationFromSpellCast', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('user');

  let characterId: string;
  let sessionId: string;
  let sessionWithoutCharacterId: string;
  const extraSessionIds: string[] = [];
  const extraCampaignIds: string[] = [];

  let getConcentration: typeof ConcentrationService.getConcentration;
  let maybeStartConcentrationFromSpellCast: typeof SpellCastConcentration.maybeStartConcentrationFromSpellCast;
  let maybeStartConcentrationAfterReply: typeof SpellCastConcentration.maybeStartConcentrationAfterReply;

  beforeAll(async () => {
    if (!hasRealDb) return;
    ({ getConcentration } = await import('../concentration-service.js'));
    ({ maybeStartConcentrationFromSpellCast, maybeStartConcentrationAfterReply } =
      await import('../spell-cast-concentration.js'));
    const [{ id }] = await db
      .insert(characters)
      .values({
        userId,
        name: testId('caster'),
        level: 3,
        cantrips: 'Dancing Lights',
        knownSpells: 'Bless',
      })
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
    for (const id of [sessionId, sessionWithoutCharacterId, ...extraSessionIds]) {
      await db.delete(gameSessions).where(eq(gameSessions.id, id));
    }
    for (const id of extraCampaignIds) {
      await db.delete(campaigns).where(eq(campaigns.id, id));
    }
    await db.delete(characters).where(eq(characters.id, characterId));
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

  it('does not start concentration for a concentration spell the character cannot cast', async () => {
    // Bane requires concentration, but the caster has only Dancing Lights
    // (cantrip) and Bless (known). The #2718 gate cannot see a claim inside
    // a [spell_id=...] tag, so the hook checks the tagged spell against the
    // character's castable spells itself.
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const started = await maybeStartConcentrationFromSpellCast(
      '[spell_id=bane, spell_level=level 1].',
      sessionId,
    );
    expect(started).toBe(false);
    expect(await getConcentration(characterId)).toBeNull();
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
    // Default CON 10 (+0); DC 10 for 2 damage.
    const { checkConcentrationOnDamage } = await import('../concentration-service.js');
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    // Pin the d20 to 10: 10 + 0 = 10 vs DC 10 -> success, kept.
    const result = await checkConcentrationOnDamage(characterId, 2, { rollD20Fn: () => 10 });
    expect(result.hadConcentration).toBe(true);
    expect(result.saveTriggered).toBe(true);
    expect(result.dc).toBe(10);
    expect(result.success).toBe(true);
    expect(result.dropped).toBe(false);
    // Concentration survives the successful save.
    expect((await getConcentration(characterId))?.spellName).toBe('Dancing Lights');
  });

  // Refused/failed casts must not change concentration. These tests run the
  // exact post-reply decision the llm route calls, plus the real #2718 gate
  // (the hook's wiring partner), against the real DB — no mock.module.
  // What is NOT tested here: the route wiring itself. The llm.ts call with
  // the gateRan field and the try/catch at server-bun/src/routes/v1/llm.ts
  // 1081-1096 have no test; the wiring is visible in the diff and is the
  // only route code this PR adds.
  //
  // The refusals before the hook, all in server-bun/src/routes/v1/llm.ts
  // (verified at head ac2afb8c; llm.ts is unchanged since): 401 auth
  // (line 637), 400 missing prompt (line 672), party-defeated terminal
  // return (line 776), 402 quota (line 808), the #2718 feature gate (called
  // at line 1026 — its refusal at dm-feature-gate.ts:352 replaces the reply
  // with a refusal envelope and does NOT set result.error, so the route
  // passes the outcome through the gate's onCastsRefused callback), and the
  // provider error early return (result.error check at line 1042, degraded
  // envelope returned at line 1067). The hook itself is llm.ts:1082, and
  // the gate runs only inside `if (dmReply)` (line 1025), so the route also
  // passes gateRan: a turn the gate never ran (non-DM generation) must not
  // start concentration. Nothing after the hook can refuse the turn:
  // usage recording only records, envelope parse and narration repair only
  // rewrite text inside try/catch, and the story slot spend only runs for
  // casts the gate allowed (failures are logged).
  it('a #2718-refused cast starts no concentration when none exists', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const started = await maybeStartConcentrationAfterReply(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
      { replyError: null, castsRefused: true, gateRan: true },
    );
    expect(started).toBe(false);
    expect(await getConcentration(characterId)).toBeNull();
  });

  it('a #2718-refused cast leaves an existing concentration row untouched', async () => {
    // Concentrating on Dancing Lights via a successful cast first.
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    const before = await getConcentration(characterId);
    expect(before?.spellName).toBe('Dancing Lights');
    // A refused cast (of a DIFFERENT spell, Bless) must not touch the row:
    // same id, same spell as before.
    const started = await maybeStartConcentrationAfterReply(
      'I cast Bless [spell_id=bless, spell_level=level 1].',
      sessionId,
      { replyError: null, castsRefused: true, gateRan: true },
    );
    expect(started).toBe(false);
    const after = await getConcentration(characterId);
    expect(after?.id).toBe(before?.id);
    expect(after?.spellName).toBe('Dancing Lights');
    expect(after?.spellId).toBe('dancing-lights');
  });

  it('a failed reply leaves an existing concentration row untouched', async () => {
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    const before = await getConcentration(characterId);
    // A cast the DM never answered (provider error) must not start or change
    // concentration.
    const started = await maybeStartConcentrationAfterReply(
      'I cast Bless [spell_id=bless, spell_level=level 1].',
      sessionId,
      { replyError: 'provider_error', castsRefused: false, gateRan: true },
    );
    expect(started).toBe(false);
    const after = await getConcentration(characterId);
    expect(after?.id).toBe(before?.id);
    expect(after?.spellName).toBe('Dancing Lights');
  });

  it('the post-reply hook starts concentration when the reply succeeds and nothing refused the cast', async () => {
    // This is the route's success path through the decision function the llm
    // route calls inside its try/catch — the hook at llm.ts:1082.
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const started = await maybeStartConcentrationAfterReply(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
      { replyError: null, castsRefused: false, gateRan: true },
    );
    expect(started).toBe(true);
    const state = await getConcentration(characterId);
    expect(state?.spellName).toBe('Dancing Lights');
    expect(state?.spellId).toBe('dancing-lights');
  });

  it('a turn the #2718 gate never ran leaves an existing concentration row untouched', async () => {
    // A non-DM generation (no dmReply in the request) reaches the same route
    // but skips the gate. Without a refusal check, no concentration starts.
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    const before = await getConcentration(characterId);
    const started = await maybeStartConcentrationAfterReply(
      'I cast Bless [spell_id=bless, spell_level=level 1].',
      sessionId,
      { replyError: null, castsRefused: false, gateRan: false },
    );
    expect(started).toBe(false);
    const after = await getConcentration(characterId);
    expect(after?.id).toBe(before?.id);
    expect(after?.spellName).toBe('Dancing Lights');
  });

  it('the real #2718 refusal reaches the hook decision through onCastsRefused', async () => {
    // This test runs the actual gate (no mock.module) against the real DB:
    // the test character lacks Bless, so claiming it is refused. The test
    // then feeds the gate's own outcome into the route's decision function —
    // the same two calls the route wires together at llm.ts:1026 and
    // llm.ts:1082.
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const { refuseFeaturesCharacterLacks } = await import('../../dm/dm-feature-gate.js');
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('campaign') })
      .returning({ id: campaigns.id });
    extraCampaignIds.push(campaignId);
    const [{ id: gateSessionId }] = await db
      .insert(gameSessions)
      .values({ characterId, campaignId, sessionNumber: 3, status: 'active' })
      .returning({ id: gameSessions.id });
    extraSessionIds.push(gateSessionId);
    // The gate reads cast claims by NAME from the player's words (a typed
    // claim); the [spell_id=] tag is the hook's input, fed to the decision
    // below — the route passes the same message to both.
    const prompt = 'I cast Bless [spell_id=bless, spell_level=level 1].';
    let gateRefused = false;
    const result = await refuseFeaturesCharacterLacks({
      result: { text: JSON.stringify({ text: 'A holy light answers.', narration_segments: [] }) },
      userId,
      sessionId: gateSessionId,
      playerInput: 'I cast Bless.',
      inCombat: false,
      clientCharacterId: null,
      onCastsRefused: () => {
        gateRefused = true;
      },
    });
    expect(gateRefused).toBe(true);
    // The refusal replaces the reply but does NOT set result.error — this is
    // why the callback exists and why the hook cannot rely on result.error.
    expect(result.error).toBeFalsy();
    const started = await maybeStartConcentrationAfterReply(prompt, gateSessionId, {
      replyError: result.error,
      castsRefused: gateRefused,
      gateRan: true,
    });
    expect(started).toBe(false);
    expect(await getConcentration(characterId)).toBeNull();
  });

  it('a tag-only cast of a spell the character lacks never starts concentration', async () => {
    // The hook takes the spell id from the [spell_id=...] tag, but the #2718
    // gate reads casts by name from the player's words — its phrase parser
    // captures junk from a tag-only message and never sees the claim, so a
    // tag-only cast is NOT refused. This test pins that behavior end to end:
    // the gate stays blind, and the hook's own castable check blocks it.
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const { refuseFeaturesCharacterLacks } = await import('../../dm/dm-feature-gate.js');
    const [{ id: tagCampaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('campaign') })
      .returning({ id: campaigns.id });
    extraCampaignIds.push(tagCampaignId);
    const [{ id: tagSessionId }] = await db
      .insert(gameSessions)
      .values({ characterId, campaignId: tagCampaignId, sessionNumber: 4, status: 'active' })
      .returning({ id: gameSessions.id });
    extraSessionIds.push(tagSessionId);
    const prompt = '[spell_id=bane, spell_level=level 1].';
    let gateRefused = false;
    const result = await refuseFeaturesCharacterLacks({
      result: { text: JSON.stringify({ text: 'Darkness falls.', narration_segments: [] }) },
      userId,
      sessionId: tagSessionId,
      playerInput: prompt,
      inCombat: false,
      clientCharacterId: null,
      onCastsRefused: () => {
        gateRefused = true;
      },
    });
    // The gate does not refuse a tag-only claim: it never saw one.
    expect(gateRefused).toBe(false);
    const started = await maybeStartConcentrationAfterReply(prompt, tagSessionId, {
      replyError: result.error,
      castsRefused: gateRefused,
      gateRan: true,
    });
    expect(started).toBe(false);
    expect(await getConcentration(characterId)).toBeNull();
  });

  it('a failed CON save after the spell-cast drops concentration', async () => {
    await db.delete(characterConcentration).where(eq(characterConcentration.characterId, characterId));
    const { checkConcentrationOnDamage } = await import('../concentration-service.js');
    await maybeStartConcentrationFromSpellCast(
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].',
      sessionId,
    );
    // Pin the d20 to 1: 1 + 0 = 1 vs DC 10 -> fail, dropped.
    const result = await checkConcentrationOnDamage(characterId, 2, { rollD20Fn: () => 1 });
    expect(result.saveTriggered).toBe(true);
    expect(result.success).toBe(false);
    expect(result.dropped).toBe(true);
    expect(result.droppedSpell).toBe('Dancing Lights');
    expect(await getConcentration(characterId)).toBeNull();
  });
});
