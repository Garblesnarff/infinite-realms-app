/**
 * #2341 — the pending entry is available BEFORE the DM is called.
 *
 * Run 14 typed "I cast Chill Touch at Valerius" with no encounter open; the DM narrated a miss
 * and moved Valerius, and only then did the combat-entry popup mount. The client now asks this
 * route first. The body is the shared fixture the client test also asserts it sends.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import {
  ABYSSAL_RECENT_NARRATION,
  abyssalRoster,
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCheckBody,
  pickedTargetCheckBody,
  RUN19_RECENT_NARRATION,
  run19Roster,
  sheetCastCheckBody,
  sheetCastRoster,
  silkAttackCheckBody,
  silkDeclaredAttack,
  silkRoster,
  untargetedSpellCheckBody,
} from '../../../../../../shared/test-fixtures/declared-attack-hold';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { createDeclaredAttackRoutes } = await import('../entry.js');

let authenticated = true;
let liveEncounter: unknown;
let roster: Array<{ name: string; source?: 'ledger' | 'map' | 'campaign' }> = [];
const defaultRoster = [{ name: 'Valerius' }, { name: 'Professor Darkwater' }];
const rosterCalls: Array<{ sessionId: string; userId: string }> = [];
const authenticateRequest = async () =>
  authenticated
    ? {
        user: { userId: 'user-owner', email: 'owner@example.test', plan: 'free' },
        error: null,
      }
    : { user: null, error: 'Unauthorized' };

const app = createRequestPipelineApp().use(
  createDeclaredAttackRoutes({
    authenticateRequest: authenticateRequest as never,
    loadCombatIntentActorRoster: (async (sessionId: string, userId: string) => {
      rosterCalls.push({ sessionId, userId });
      return roster;
    }) as never,
    getActiveEncounter: async () => liveEncounter,
  }),
);

const post = (body: unknown, sessionId = DECLARED_ATTACK_SESSION_ID) =>
  app.handle(
    new Request(`http://localhost/sessions/${sessionId}/declared-attack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/combat/sessions/:sessionId/declared-attack', () => {
  beforeEach(() => {
    authenticated = true;
    liveEncounter = undefined;
    roster = defaultRoster;
    rosterCalls.splice(0);
  });

  it.each([
    'I grab the Professor',
    'I draw my sword on the Professor',
    'I smash the Professor with my mace',
  ])('offers combat entry for a hostile creature action: %s', async (playerInput) => {
    const response = await post({ ...declaredAttackCheckBody, playerInput });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      pending: {
        trigger: 'player_intent',
        combatants: [{ name: 'Professor Darkwater', count: 1 }],
        declaredAttack: { actorName: 'Professor Darkwater' },
      },
    });
  });

  /**
   * #862: Hark N21-015. The creature in the scene is Dr. Marrow. "I grab the Professor"
   * shares no name word with him, and "I shove him off the ledge" is not the bare pronoun
   * "him". Both must still open combat entry on that one present creature. An object act
   * on the same roster stays a check. Two present creatures, and a title that matches
   * neither, stay unresolved.
   */
  describe('hostile act on the one present creature (#862)', () => {
    const marrow = { name: 'Dr. Marrow', source: 'ledger' as const };
    const valerius = { name: 'Valerius', source: 'ledger' as const };

    const expectMarrow = async (playerInput: string): Promise<void> => {
      const response = await post({ ...declaredAttackCheckBody, playerInput });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        pending: {
          trigger: 'player_intent',
          combatants: [{ name: 'Dr. Marrow', count: 1 }],
          declaredAttack: { actorName: 'Dr. Marrow' },
        },
      });
    };

    it('offers combat entry for "I grab the Professor" when only Dr. Marrow is present', async () => {
      roster = [marrow];
      await expectMarrow('I grab the Professor');
    });

    it('offers combat entry for "I shove him off the ledge" when only Dr. Marrow is present', async () => {
      roster = [marrow];
      await expectMarrow('I shove him off the ledge');
    });

    it('uses the one present creature when the rest of the roster is the campaign cast', async () => {
      roster = [marrow, { name: 'Warden Ilsa Vane', source: 'campaign' }];
      await expectMarrow('I grab the Professor');
    });

    it('uses the one creature the last message names when two are present', async () => {
      roster = [marrow, valerius];
      const response = await post({
        ...declaredAttackCheckBody,
        playerInput: 'I shove him off the ledge',
        recentNarration: 'Dr. Marrow leans over the chasm.',
      });
      expect(await response.json()).toMatchObject({
        pending: { declaredAttack: { actorName: 'Dr. Marrow' } },
      });
    });

    it('leaves "I smash the cauldron" as a check against that same creature', async () => {
      roster = [marrow];
      const response = await post({
        ...declaredAttackCheckBody,
        playerInput: 'I smash the cauldron',
      });
      expect(await response.json()).toEqual({ pending: null });
    });

    it('does not guess "the Professor" when two present creatures match neither word', async () => {
      roster = [marrow, valerius];
      const response = await post({
        ...declaredAttackCheckBody,
        playerInput: 'I grab the Professor',
      });
      expect(await response.json()).toEqual({ pending: null });
    });

    it('does not guess "him off the ledge" when two creatures are present and none was just named', async () => {
      roster = [marrow, valerius];
      const response = await post({
        ...declaredAttackCheckBody,
        playerInput: 'I shove him off the ledge',
      });
      expect(await response.json()).toEqual({ pending: null });
    });

    it.each([
      'I grab the Professor to stop him falling',
      'I grab him to stop his fall',
      'I grab him and pull him up',
      'I shove him back onto the ledge to save him',
    ])('leaves a helping grab as a check: %s (#1046)', async (playerInput) => {
      roster = [marrow];
      const response = await post({ ...declaredAttackCheckBody, playerInput });
      expect(await response.json()).toEqual({ pending: null });
    });

    it('still opens entry for an attack whose purpose only sounds like help (#1046)', async () => {
      roster = [{ name: 'Goblin', source: 'ledger' }];
      const response = await post({
        ...declaredAttackCheckBody,
        playerInput: 'I attack the goblin to stop him from escaping',
      });
      expect(await response.json()).toMatchObject({
        pending: { declaredAttack: { actorName: 'Goblin', verb: 'attack' } },
      });
    });

    it('keeps a later stab when an earlier grab was only to help (#1046)', async () => {
      roster = [{ name: 'Goblin', source: 'ledger' }];
      const response = await post({
        ...declaredAttackCheckBody,
        playerInput: 'I grab him to stop his fall. I stab the goblin',
      });
      expect(await response.json()).toMatchObject({
        pending: { declaredAttack: { actorName: 'Goblin', verb: 'stab' } },
      });
    });
  });

  it.each([
    'I smash the cauldron',
    'I crack the basalt with my mace',
    'I force the hatch',
    'I grab the Professor’s book',
    'I draw my longsword',
    'I draw a portrait of the Professor',
    'I do not grab the Professor',
  ])('leaves object acts and non-hostile wording in narrative: %s', async (playerInput) => {
    const response = await post({ ...declaredAttackCheckBody, playerInput });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: null });
  });

  it('returns no pending entry when a fight is already live (#2623)', async () => {
    liveEncounter = { id: 'encounter-live', status: 'active' };
    const response = await post(declaredAttackCheckBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: null });
  });

  it("returns the pending entry for run 14's Chill Touch turn", async () => {
    const response = await post(declaredAttackCheckBody);
    const body = (await response.json()) as { pending: Record<string, any> | null };

    expect(response.status).toBe(200);
    expect(rosterCalls).toEqual([{ sessionId: DECLARED_ATTACK_SESSION_ID, userId: 'user-owner' }]);
    expect(body.pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'Valerius', count: 1 }],
      declaredAttack: { actorName: 'Valerius', attackSource: 'spell', spellName: 'Chill Touch' },
    });
    expect(body.pending?.sceneSpec).toMatchObject({ sessionId: DECLARED_ATTACK_SESSION_ID });
  });

  it('hands the named weapon over in the pending for the Hark Night2 silk attack (#877)', async () => {
    roster = silkRoster;
    const response = await post(silkAttackCheckBody);
    const body = (await response.json()) as { pending: Record<string, any> | null };

    expect(response.status).toBe(200);
    expect(body.pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'Silk Woman', count: 1 }],
      // The weapon rides out of this route in the pending — the half of the seam this
      // route owns. That /enter accepts it unstripped is covered in combat-entry-http.
      declaredAttack: silkDeclaredAttack,
    });
  });

  it('answers null for a question to a creature, and for a message that names no attack', async () => {
    const question = await post({
      ...declaredAttackCheckBody,
      playerInput: 'I ask Valerius why he hangs from the ceiling.',
    });
    expect(await question.json()).toEqual({ pending: null });

    rosterCalls.splice(0);
    const peaceful = await post({
      ...declaredAttackCheckBody,
      playerInput: 'I study the fold and make an Arcana check.',
    });
    expect(await peaceful.json()).toEqual({ pending: null });
    // No combat verb, so the roster is never loaded for an ordinary turn.
    expect(rosterCalls).toEqual([]);
  });

  it('answers null when the spell is aimed at nobody on the roster', async () => {
    const response = await post({
      ...declaredAttackCheckBody,
      playerInput: 'I cast Chill Touch at the lantern.',
    });
    expect(await response.json()).toEqual({ pending: null });
  });

  it('refuses an unauthenticated caller and a body without the player', async () => {
    authenticated = false;
    expect((await post(declaredAttackCheckBody)).status).toBe(401);

    authenticated = true;
    expect((await post({ playerInput: declaredAttackCheckBody.playerInput })).status).toBe(422);
    expect((await post(declaredAttackCheckBody, 'not-a-uuid')).status).toBe(422);
  });

  it('holds a cantrip hurled at a named creature', async () => {
    const hurled = await post({
      ...declaredAttackCheckBody,
      playerInput: 'I hurl Acid Splash at Valerius.',
    });
    expect(((await hurled.json()) as any).pending).toMatchObject({
      declaredAttack: { actorName: 'Valerius', spellName: 'Acid Splash' },
    });
  });

  it('stands down for "I strike a bargain with Valerius"', async () => {
    const response = await post({
      ...declaredAttackCheckBody,
      playerInput: 'I strike a bargain with Valerius.',
    });
    expect(await response.json()).toEqual({ pending: null });
  });

  it('asks which creature when an attack spell is aimed at "him" and the narration names two', async () => {
    const response = await post(untargetedSpellCheckBody);
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.pending).toBeNull();
    expect(body.targetChoice).toEqual({
      spellName: 'Fire Bolt',
      candidates: ['Valerius', 'Professor Darkwater'],
    });
  });

  it('holds on the one creature the narration names, without asking', async () => {
    const response = await post({
      ...untargetedSpellCheckBody,
      recentNarration: 'Valerius the Upside Down drops from the ceiling.',
    });
    const body = (await response.json()) as any;

    expect(body.targetChoice).toBeUndefined();
    expect(body.pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'Valerius', count: 1 }],
      declaredAttack: { actorName: 'Valerius', attackSource: 'spell', spellName: 'Fire Bolt' },
    });
  });

  it('returns the pending entry once the player has picked the creature', async () => {
    const response = await post(pickedTargetCheckBody);
    const body = (await response.json()) as any;

    expect(body.targetChoice).toBeUndefined();
    expect(body.pending).toMatchObject({
      combatants: [{ name: 'Valerius', count: 1 }],
      declaredAttack: { actorName: 'Valerius', spellId: 'fire-bolt' },
    });
  });

  it('answers null for a picked name that is not on the roster, and for a spell that names nobody it can hold', async () => {
    const stranger = await post({ ...pickedTargetCheckBody, targetName: 'Nobody' });
    expect(await stranger.json()).toEqual({ pending: null });

    const light = await post({ ...untargetedSpellCheckBody, playerInput: 'I cast Light on him.' });
    expect(await light.json()).toEqual({ pending: null });
  });
});

type SheetCastBody = {
  pending: Record<string, unknown> | null;
  targetChoice?: { spellName: string; candidates: string[] };
};

/**
 * #2415 (run 17): the sheet's Cast button names no creature. The check used to miss it (the
 * tag's comma split the clause), so the DM was called first and invented the target.
 */
describe('declared-attack for a sheet cast with no target', () => {
  beforeEach(() => {
    authenticated = true;
    roster = sheetCastRoster;
    rosterCalls.splice(0);
  });

  it('offers Reeves as a choice, and does not pick her for the player', async () => {
    const response = await post(sheetCastCheckBody);
    const body = (await response.json()) as SheetCastBody;

    expect(response.status).toBe(200);
    expect(body.pending).toBeNull();
    expect(body.targetChoice).toEqual({
      spellName: 'Chill Touch',
      candidates: ['Captain Sarah Reeves'],
    });
  });

  it('offers the creatures this session has seen when the narration names none, never an unmet campaign NPC', async () => {
    roster = [...sheetCastRoster, { name: 'Warden Ilsa Vane', source: 'campaign' as const }];
    const response = await post({ ...sheetCastCheckBody, recentNarration: 'The wind rises.' });
    const body = (await response.json()) as SheetCastBody;

    expect(body.targetChoice?.candidates).toEqual([
      'Captain Sarah Reeves',
      'Professor Emil Darkwater',
    ]);
  });

  it('starts nothing when no creature is present', async () => {
    roster = [{ name: 'Warden Ilsa Vane', source: 'campaign' as const }];
    const unmet = await post({ ...sheetCastCheckBody, recentNarration: 'The wind rises.' });
    expect(await unmet.json()).toEqual({ pending: null });

    roster = [];
    const empty = await post(sheetCastCheckBody);
    expect(await empty.json()).toEqual({ pending: null });
  });

  it('seats the creature the player picked, from the same tagged line', async () => {
    const response = await post({ ...sheetCastCheckBody, targetName: 'Captain Sarah Reeves' });
    const body = (await response.json()) as SheetCastBody;

    expect(body.targetChoice).toBeUndefined();
    expect(body.pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'Captain Sarah Reeves', count: 1 }],
      declaredAttack: { actorName: 'Captain Sarah Reeves', spellId: 'chill-touch' },
    });
  });

  it('leaves a typed "I cast Chill Touch at Reeves" as it was: held on Reeves, no question', async () => {
    const response = await post({
      ...sheetCastCheckBody,
      playerInput: 'I cast Chill Touch at Reeves',
    });
    const body = (await response.json()) as SheetCastBody;

    expect(body.targetChoice).toBeUndefined();
    expect(body.pending).toMatchObject({
      combatants: [{ name: 'Captain Sarah Reeves', count: 1 }],
      declaredAttack: {
        actorName: 'Captain Sarah Reeves',
        attackSource: 'spell',
        spellName: 'Chill Touch',
      },
    });
  });
});

/**
 * #2445 (run 18): build d6852f04 offered "Iron" Jawn, Professor Darkwater and Captain Reeves
 * when the last DM message named only Reeves. None had been met: it was a fresh session.
 */
describe('declared-attack candidates on the Abyssal Descent roster', () => {
  const sheetCast = { ...sheetCastCheckBody, recentNarration: ABYSSAL_RECENT_NARRATION };
  const candidatesFor = async (body: Record<string, unknown>): Promise<string[] | null> => {
    const response = await post(body);
    const json = (await response.json()) as SheetCastBody;
    return json.targetChoice?.candidates ?? null;
  };

  beforeEach(() => {
    authenticated = true;
    roster = abyssalRoster;
    rosterCalls.splice(0);
  });

  it('offers only Reeves when the last DM message names her, though "iron" is in it', async () => {
    expect(await candidatesFor(sheetCast)).toEqual(['Captain Sarah Reeves']);
  });

  it('offers nobody, and starts nothing, when it names no one and nobody has been met', async () => {
    const response = await post({ ...sheetCast, recentNarration: 'The wind rises.' });
    expect(await response.json()).toEqual({ pending: null });
  });

  it('falls back to the creature met earlier, never to the unmet campaign NPCs', async () => {
    roster = [
      abyssalRoster[0],
      abyssalRoster[1],
      { ...abyssalRoster[2], source: 'ledger' as const },
    ];
    expect(await candidatesFor({ ...sheetCast, recentNarration: 'The wind rises.' })).toEqual([
      'Captain Sarah Reeves',
    ]);
  });

  it('never offers an actor with no source as a fallback candidate', async () => {
    roster = [{ name: 'Captain Sarah Reeves' }, { ...abyssalRoster[0], source: undefined }];
    const response = await post({ ...sheetCast, recentNarration: 'The wind rises.' });
    expect(await response.json()).toEqual({ pending: null });
  });

  it('names a campaign NPC only in full: a surname or nickname alone offers no one (#2458)', async () => {
    expect(
      await candidatesFor({
        ...sheetCast,
        recentNarration: 'Reeves and Darkwater peer over the iron rail while Jawn waits.',
      }),
    ).toBeNull();
  });

  it('run 19: "basalt" and "mother of pearl" do not offer Mother Basalt, only Reeves (#2458)', async () => {
    roster = run19Roster;
    expect(await candidatesFor({ ...sheetCast, recentNarration: RUN19_RECENT_NARRATION })).toEqual([
      'Captain Sarah Reeves',
    ]);
    expect(
      await candidatesFor({ ...sheetCast, recentNarration: 'Mother Basalt steps forward.' }),
    ).toEqual(['Mother Basalt']);
  });

  it('offers every creature the message names, and a nickname-only mention names no one', async () => {
    expect(
      await candidatesFor({
        ...sheetCast,
        recentNarration:
          'Captain Sarah Reeves and Professor Emil Darkwater peer over the iron rail.',
      }),
    ).toEqual(['Professor Emil Darkwater', 'Captain Sarah Reeves']);
    expect(
      await candidatesFor({
        ...sheetCast,
        recentNarration: 'Iron Jawn strides in, and Captain Sarah Reeves salutes him.',
      }),
    ).toEqual(['"Iron" Jawn', 'Captain Sarah Reeves']);
  });
});
