/**
 * #2341 — the pending entry is available BEFORE the DM is called.
 *
 * Run 14 typed "I cast Chill Touch at Valerius" with no encounter open; the DM narrated a miss
 * and moved Valerius, and only then did the combat-entry popup mount. The client now asks this
 * route first. The body is the shared fixture the client test also asserts it sends.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCheckBody,
  pickedTargetCheckBody,
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
      return [{ name: 'Valerius' }, { name: 'Professor Darkwater' }];
    }) as never,
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
    rosterCalls.splice(0);
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
