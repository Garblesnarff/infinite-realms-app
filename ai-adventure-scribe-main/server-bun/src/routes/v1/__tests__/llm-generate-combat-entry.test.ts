/* eslint-disable max-lines -- the route contract matrix keeps A1-A4 together. */
/**
 * #1779 §1 — the entry gate is wired into the turn pipeline, not merely written.
 *
 * The gate's own behaviour is covered in `services/combat/__tests__/combat-entry-gate.test.ts`.
 * What this file proves is that `POST /v1/llm/generate` — the single funnel every DM turn
 * passes through — runs detection against the accepted response and returns a pending handoff,
 * without creating an encounter before the player confirms it.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import {
  DECLARED_ATTACK_PLAYER_INPUT,
  declaredAttackCheckBody,
  declinedTurnBody,
  SHEET_CAST_PLAYER_INPUT,
  sheetCastRoster,
} from '../../../../../shared/test-fixtures/declared-attack-hold';

let generatedResult: Record<string, unknown> = { text: '{}', provider: 'openrouter', model: 'm' };
let generatedInputs: Record<string, unknown>[] = [];
const infoLogs: unknown[] = [];
const warningLogs: unknown[] = [];
const defaultIntentActors = [
  { name: 'Professor Emil Darkwater' },
  { name: 'The Ghoul', monsterId: 'srd:ghoul' },
  { name: 'Valerius' },
];
let intentActors: Array<{ name: string; monsterId?: string }> = defaultIntentActors;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'entry-user', email: 'entry@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: (entry: unknown) => {
    infoLogs.push(entry);
  },
  warn: (entry: unknown) => {
    warningLogs.push(entry);
  },
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async (input: Record<string, unknown>) => {
      generatedInputs.push(input);
      return generatedResult;
    },
  },
}));
mock.module('../../../services/combat/combat-intent-roster.js', () => ({
  loadCombatIntentActorRoster: async () => intentActors,
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const COMBAT_ENTRY = {
  sessionId: SESSION_ID,
  player: { characterId: 'char-1', name: 'The Storyteller', initiativeModifier: 2 },
};

const dmEnvelope = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    text: "Your fist lands with a sickening squelch. Dishwasher Prime doesn't seem hurt.",
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    scene_spec: null,
    map_actions: [],
    handout_actions: [],
    combatants: [],
    combat_actions: [],
    ...overrides,
  });

const generate = async (body: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/llm/generate — combat entry gate', () => {
  beforeEach(() => {
    generatedResult = { text: '{}', provider: 'openrouter', model: 'm' };
    generatedInputs = [];
    intentActors = defaultIntentActors;
    infoLogs.length = 0;
    warningLogs.length = 0;
  });

  it('returns a pending entry for a hostile turn without seating an encounter', async () => {
    generatedResult = {
      text: dmEnvelope({
        combat_actions: [
          {
            actor_id: 'the-storyteller',
            action_type: 'attack',
            target_ids: ['dishwasher-prime'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ],
      }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({ prompt: 'I punch it', combatEntry: COMBAT_ENTRY });
    const body = (await response.json()) as { text: string };

    expect(response.status).toBe(200);
    const envelope = JSON.parse(body.text) as Record<string, unknown>;
    expect(envelope.combat_transition).toBe('none');
    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'tactical_action',
      combatants: [{ name: 'Dishwasher Prime', count: 1 }],
      sceneSpecSynthesized: true,
    });
  });

  it('returns combat-entry intent for an attack against a named friendly NPC (#1943)', async () => {
    generatedResult = {
      text: dmEnvelope({
        text: 'Vance catches your arm before the punch lands.',
        combat_actions: [
          {
            actor_id: 'the-storyteller',
            action_type: 'attack',
            target_ids: ['vance'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ],
      }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'I attempt to punch Vance',
      combatEntry: COMBAT_ENTRY,
    });
    const body = (await response.json()) as { text: string };
    const envelope = JSON.parse(body.text) as Record<string, unknown>;

    expect(envelope.combat_transition).toBe('none');
    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'tactical_action',
      combatants: [{ name: 'Vance', count: 1 }],
    });
    expect(envelope.combat_actions).toEqual([
      expect.objectContaining({
        actor_id: 'the-storyteller',
        action_type: 'attack',
        target_ids: ['vance'],
      }),
    ]);
  });

  it('end-to-end: resolves the raw swing-and-punch declaration into an unarmed first-action handoff', async () => {
    generatedResult = {
      text: dmEnvelope({ text: 'The professor braces as your attack begins.' }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'I attempt to swing and punch the professor',
      combatEntry: COMBAT_ENTRY,
    });
    const body = (await response.json()) as { text: string };
    const envelope = JSON.parse(body.text) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'player_intent',
      declaredAttack: {
        verb: 'punch',
        actorName: 'Professor Emil Darkwater',
        attackSource: 'unarmed',
      },
    });
  });

  it('forces player-intent entry from pure prose and injects the server directive (#1943 A1-A3)', async () => {
    generatedResult = {
      text: 'Darkwater flinches as you square your shoulders.',
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'i punch Darkwater',
      combatEntry: COMBAT_ENTRY,
    });
    const body = (await response.json()) as { text: string };
    const envelope = JSON.parse(body.text) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'Professor Emil Darkwater', count: 1 }],
    });
    expect(envelope.text).toContain('Darkwater flinches');
    expect(generatedInputs[0]?.prompt).toContain(
      '<declared_attack actor="Professor Emil Darkwater">',
    );
    expect(generatedInputs[0]?.prompt).toContain('Do NOT resolve it.');
  });

  it('drives ordinary attack phrasing through the contract-violation telemetry path (#1943)', async () => {
    generatedResult = {
      text: dmEnvelope({
        text: 'Your punch hits Professor Emil Darkwater before he can react.',
      }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'i take a swing and attempt to punch the professor',
      combatEntry: COMBAT_ENTRY,
    });
    const body = (await response.json()) as { text: string };
    const envelope = JSON.parse(body.text) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'Professor Emil Darkwater', count: 1 }],
    });
    expect(generatedInputs[0]?.prompt).toContain(
      '<declared_attack actor="Professor Emil Darkwater">',
    );
    expect(warningLogs).toContainEqual(
      expect.objectContaining({
        msg: 'COMBAT_INTENT_DIRECTIVE_CONTRACT_VIOLATION',
        event: 'contract_violation',
        sessionId: SESSION_ID,
        actorName: 'Professor Emil Darkwater',
        verb: 'punch',
      }),
    );
  });

  it('uses the tail-tagged player input for old clients (#1943 A1)', async () => {
    generatedResult = {
      text: 'The blow is only a wind-up.',
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.\n<player_input>i punch Darkwater</player_input>',
      combatEntry: COMBAT_ENTRY,
    });
    const envelope = JSON.parse(((await response.json()) as { text: string }).text) as Record<
      string,
      unknown
    >;

    expect(envelope.combat_entry_pending).toMatchObject({ trigger: 'player_intent' });
    expect(generatedInputs[0]?.prompt).toContain(
      '<declared_attack actor="Professor Emil Darkwater">',
    );
  });

  it('does not treat a peaceful question to an NPC as an attack (#1943 A2)', async () => {
    generatedResult = {
      text: dmEnvelope({ text: 'Darkwater considers your question.' }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'I ask Darkwater why he lied',
      combatEntry: COMBAT_ENTRY,
    });
    const envelope = JSON.parse(((await response.json()) as { text: string }).text) as Record<
      string,
      unknown
    >;

    expect(envelope.combat_entry_pending).toBeUndefined();
    expect(generatedInputs[0]?.prompt).not.toContain('<declared_attack');
    expect(infoLogs).toContainEqual(
      expect.objectContaining({
        msg: 'COMBAT_INTENT_NO_DECLARATION',
        sessionId: SESSION_ID,
        prefilter: false,
        detector: null,
      }),
    );
  });

  it('strips an untargeted initiative request from Cast Light (#1943 A4)', async () => {
    generatedResult = {
      text: dmEnvelope({
        text: 'You cast Light and the room brightens.',
        roll_requests: [
          {
            type: 'initiative',
            formula: '1d20+dex',
            purpose: 'Initiative',
            dc: null,
            ac: null,
            advantage: false,
            disadvantage: false,
          },
        ],
      }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'Cast Light',
      combatEntry: COMBAT_ENTRY,
    });
    const envelope = JSON.parse(((await response.json()) as { text: string }).text) as Record<
      string,
      unknown
    >;

    expect(envelope.combat_entry_pending).toBeUndefined();
    expect(envelope.roll_requests).toEqual([]);
    expect(generatedInputs).toHaveLength(1);
  });

  it('recognizes a damage spell declared against a roster actor (#1943 A2-A3)', async () => {
    generatedResult = {
      text: 'The spell gathers at the tip of your finger.',
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'cast Magic Missile at the ghoul',
      combatEntry: COMBAT_ENTRY,
    });
    const envelope = JSON.parse(((await response.json()) as { text: string }).text) as Record<
      string,
      unknown
    >;

    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'The Ghoul', monsterId: 'srd:ghoul', count: 1 }],
    });
    expect(generatedInputs[0]?.prompt).toContain('<declared_attack actor="The Ghoul">');
  });

  it('leaves a peaceful turn untouched', async () => {
    generatedResult = {
      text: dmEnvelope({
        roll_requests: [
          {
            type: 'check',
            formula: '1d20+3',
            purpose: 'Investigation',
            dc: 12,
            ac: null,
            advantage: false,
            disadvantage: false,
          },
        ],
      }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({ prompt: 'I search the kitchen', combatEntry: COMBAT_ENTRY });
    const body = (await response.json()) as { text: string };
    expect((JSON.parse(body.text) as Record<string, unknown>).combat_entry_pending).toBeUndefined();
  });

  it('stays backward compatible with clients that send no combatEntry', async () => {
    generatedResult = {
      text: dmEnvelope({ combat_transition: 'start' }),
      provider: 'openrouter',
      model: 'test/model',
    };
    const response = await generate({ prompt: 'I punch it' });
    expect(response.status).toBe(200);
    expect(
      (JSON.parse(((await response.json()) as { text: string }).text) as Record<string, unknown>)
        .combat_entry_pending,
    ).toBeUndefined();
  });

  it("tells the DM run 14's Chill Touch has not been resolved (#2341)", async () => {
    generatedResult = {
      text: dmEnvelope({ text: 'Frost gathers on your fingertips.' }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: DECLARED_ATTACK_PLAYER_INPUT,
      combatEntry: { sessionId: SESSION_ID, player: declaredAttackCheckBody.player },
    });
    const envelope = JSON.parse(((await response.json()) as { text: string }).text) as Record<
      string,
      unknown
    >;

    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'player_intent',
      declaredAttack: { actorName: 'Valerius', spellName: 'Chill Touch' },
    });
    const prompt = String(generatedInputs[0]?.prompt);
    expect(prompt).toContain('<declared_attack actor="Valerius">');
    expect(prompt).toContain('has NOT been resolved');
    expect(prompt).toContain('describe only the moment before the roll');
  });

  it('does not ask again when the player declined: the turn body carries no combatEntry (#2341)', async () => {
    generatedResult = {
      text: dmEnvelope({ text: 'You let the spell fade. Valerius watches from the ceiling.' }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({ prompt: 'Continue the scene.', ...declinedTurnBody });
    const envelope = JSON.parse(((await response.json()) as { text: string }).text) as Record<
      string,
      unknown
    >;

    expect(response.status).toBe(200);
    expect(declinedTurnBody).not.toHaveProperty('combatEntry');
    expect(envelope.combat_entry_pending).toBeUndefined();
    expect(generatedInputs[0]?.prompt).not.toContain('<declared_attack');

    // The same words with `combatEntry` DO reach the gate: leaving it off is what stops the
    // second popup, so the client omitting it is the whole fix for a declined turn.
    const withEntry = await generate({
      prompt: 'Continue the scene.',
      ...declinedTurnBody,
      combatEntry: { sessionId: SESSION_ID, player: declaredAttackCheckBody.player },
    });
    const gated = JSON.parse(((await withEntry.json()) as { text: string }).text) as Record<
      string,
      unknown
    >;
    expect(gated.combat_entry_pending).toMatchObject({ trigger: 'player_intent' });
  });
  describe('a sheet cast that names no creature (#2415, run 17)', () => {
    const sheetCastTurn = {
      prompt: 'Continue the scene.',
      player_input: SHEET_CAST_PLAYER_INPUT,
      combatEntry: { sessionId: SESSION_ID, player: declaredAttackCheckBody.player },
    };
    /** The DM's reply to run 17's cast: a fight, against a name taken from its own mood text. */
    const unseenShadowReply = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      text: 'Frost gathers on your fingertips. Shadows that do not cast light shift below.',
      provider: 'openrouter',
      model: 'test/model',
      ...extra,
    });
    const shadowEnvelope = (combatants: Array<{ name: string; count: number }>): string =>
      dmEnvelope({
        combat_transition: 'start',
        combatants,
        roll_requests: [
          { type: 'initiative', purpose: 'Roll initiative' },
          { type: 'skill', skill: 'perception', purpose: 'Notice the shaft' },
        ],
      });
    const envelopeOf = async (response: Response): Promise<Record<string, unknown>> =>
      JSON.parse(((await response.json()) as { text: string }).text);

    it('never seats a combatant the DM invented, and starts no fight', async () => {
      intentActors = sheetCastRoster;
      generatedResult = unseenShadowReply({
        text: shadowEnvelope([{ name: 'The Unseen Shadow', count: 1 }]),
      });

      const envelope = await envelopeOf(await generate(sheetCastTurn));

      expect(envelope.combat_entry_pending).toBeUndefined();
      expect(envelope.combat_transition).toBe('none');
      expect(envelope.combatants).toBeUndefined();
      // Only the combat dice go; an ordinary check the DM asked for stays.
      expect(envelope.roll_requests).toEqual([
        { type: 'skill', skill: 'perception', purpose: 'Notice the shaft' },
      ]);
      expect(infoLogs).toContainEqual(
        expect.objectContaining({ msg: 'COMBAT_ENTRY_INVENTED_TARGET_DROPPED' }),
      );
    });

    it('starts no fight when no creature is present at all', async () => {
      intentActors = [];
      generatedResult = unseenShadowReply({ text: shadowEnvelope([]) });

      const envelope = await envelopeOf(await generate(sheetCastTurn));

      expect(envelope.combat_entry_pending).toBeUndefined();
      expect(envelope.combat_transition).toBe('none');
    });

    it('keeps a combatant that is on the roster and drops the invented one beside it', async () => {
      intentActors = sheetCastRoster;
      generatedResult = unseenShadowReply({
        text: shadowEnvelope([
          { name: 'The Unseen Shadow', count: 1 },
          { name: 'Captain Sarah Reeves', count: 1 },
        ]),
      });

      const envelope = await envelopeOf(await generate(sheetCastTurn));

      expect(envelope.combat_entry_pending).toMatchObject({
        combatants: [{ name: 'Captain Sarah Reeves', count: 1 }],
      });
    });

    it('lets the DM seat a creature it just introduced when the player cast "at him"', async () => {
      intentActors = sheetCastRoster;
      generatedResult = unseenShadowReply({
        text: shadowEnvelope([{ name: 'The Bandit', count: 1 }]),
      });

      const envelope = await envelopeOf(
        await generate({ ...sheetCastTurn, player_input: 'I cast Chill Touch at him.' }),
      );

      expect(envelope.combat_entry_pending).toMatchObject({
        combatants: [{ name: 'The Bandit', count: 1 }],
      });
    });

    it('does not touch a player who named the creature, or a DM-started fight on a plain turn', async () => {
      intentActors = sheetCastRoster;
      generatedResult = unseenShadowReply({
        text: shadowEnvelope([{ name: 'The Unseen Shadow', count: 1 }]),
      });

      const named = await envelopeOf(
        await generate({ ...sheetCastTurn, player_input: 'I cast Chill Touch at Reeves' }),
      );
      expect(named.combat_entry_pending).toMatchObject({
        declaredAttack: { actorName: 'Captain Sarah Reeves', spellName: 'Chill Touch' },
      });

      const ambush = await envelopeOf(
        await generate({ ...sheetCastTurn, player_input: 'I open the door.' }),
      );
      expect(ambush.combat_entry_pending).toMatchObject({
        combatants: [{ name: 'The Unseen Shadow', count: 1 }],
      });
    });
  });
});
