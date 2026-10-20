/**
 * The resolution-narration payload of a dying player's turn (#874), and the exact
 * `POST /v1/llm/generate` bodies the client builds from it.
 *
 * Shared on purpose (#2286 pattern). A dying character clicked Roll on the dying
 * tray; the engine resolved the death save, then the client asked the DM model to
 * narrate the settled turn. That narration call's `message` is not player text:
 * `combat-resolution-step.ts` `narrate()` sends `JSON.stringify({...})` of the
 * turn's resolved actions, and `ai-service.ts` put that JSON in the generate
 * body's `player_input` field — the field the route caps at 20000 chars because
 * it is the *player's* input. The payload passes the cap in any real fight, the
 * route answered 422, and every death-save Roll ended in "I encountered an issue
 * processing your message." The client test asserts the narration call no longer
 * sends `player_input`; the server test posts these bodies through the real
 * route schema.
 *
 * Every piece follows its real producer:
 *  - NPC results: `server-bun/src/services/combat/npc-turn-runner.ts`
 *    (`advanceNpcTurns` result entries: action, `outcomesFrom` attack outcomes,
 *    `engineResult` = the exposed `resolveAttack` output — here
 *    `ENEMY_STRIKES_DOWNED_PLAYER` from `./engine-results`, restamped with each
 *    creature's identity — `actorIsPlayer: false`, `transcriptLines: []`).
 *  - Engine rows: the real `buildNpcEngineMessage` (shared/npc-engine-message),
 *    stamped as the client does in `use-ai-response.ts` (npcResult +
 *    combatEncounterId + actionId in the row context).
 *  - The death-save intent result: the shape `executeCombatIntent` returns for
 *    `death_save` (`{ ...turnFields, deathSaves, npcTurns, engineRows }`; the
 *    save itself is one `HPMechanics.resolveDeathSave` entry).
 *  - Accumulation: `combat-resolution-step.ts` — the player's entry carries the
 *    whole intent result as its `engineResult` (so the drained batch rides
 *    inside it: `npcTurns.results` plus `engineRows` twice), and the batch is
 *    ALSO retained entry by entry by `retainNpcResults`. Each creature's facts
 *    therefore reach the payload about three times.
 *  - Mapping + envelope: the real `dmFacingResolvedAction`, and `narrate()`'s
 *    JSON envelope (authoritativeCombatResults, its note, currentTurn,
 *    turnHandoff).
 *
 * Measured with these producers: 1 creature ≈ 11,005 chars (fits), 2 ≈ 20,916
 * (422), 4 ≈ 40,739 (422). A dying turn is the worst case precisely because the
 * death-save entry embeds the whole drain.
 */
import { buildNpcEngineMessage } from '../npc-engine-message';
import { ENEMY_STRIKES_DOWNED_PLAYER } from './engine-results';
import { dmFacingResolvedAction } from '../../src/services/combat/dm-resolved-action';

export const DEATH_SAVE_NARRATION_SESSION_ID = 'session-death-save-narration';

export const DYING_CLERIC = {
  id: 'player-thrum',
  name: 'Thrum Ironsoul',
  participantType: 'player',
  maxHp: 28,
};

const monster = (index: number) => ({
  id: `monster-${index}`,
  name: `Abyssal Horror ${index}`,
  participantType: 'monster',
  maxHp: 40,
});

type FixtureMonster = ReturnType<typeof monster>;

const npcResultFor = (m: FixtureMonster, round: number) => {
  const engineResult = {
    ...ENEMY_STRIKES_DOWNED_PLAYER,
    actorId: m.id,
    actorName: m.name,
    targetId: DYING_CLERIC.id,
    targetName: DYING_CLERIC.name,
  };
  // `outcomesFrom` reads these fields off the exposed result at runtime; the
  // fixture's static type is a spread over Record<string, unknown>, so name
  // them once here.
  const exposedHit = engineResult as unknown as {
    targetNewHp: number;
    damageType?: string;
    hit: boolean;
    finalDamage: number;
    isCritical: boolean;
  };
  return {
    action: {
      actor_id: m.id,
      action_type: 'attack',
      target_ids: [DYING_CLERIC.id],
      weapon_id: null,
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    },
    round,
    outcomes: [
      {
        participantId: DYING_CLERIC.id,
        newHp: exposedHit.targetNewHp,
        damageType: exposedHit.damageType,
        hit: exposedHit.hit,
        finalDamage: exposedHit.finalDamage,
        isCritical: exposedHit.isCritical,
      },
    ],
    engineResult,
    actorIsPlayer: false as const,
    transcriptLines: [] as string[],
  };
};

const engineRowFor = (
  m: FixtureMonster,
  result: ReturnType<typeof npcResultFor>,
  round: number,
) => {
  const message = buildNpcEngineMessage(
    [DYING_CLERIC, m] as never,
    round,
    { type: 'attack', actorId: m.id, targetIds: [DYING_CLERIC.id] },
    result.engineResult as never,
  );
  const actionId = `enc-abyss:${round}:${m.id}:attack`;
  return {
    id: `npc-row-${m.id}-${round}`,
    sequence: 100 + round,
    text: message.text,
    kind: 'npc',
    actionId,
    sessionId: DEATH_SAVE_NARRATION_SESSION_ID,
    timestamp: '2026-10-20T03:30:00.000Z',
    context: {
      ...message.context,
      npcResult: result.engineResult,
      combatEncounterId: 'enc-abyss',
      actionId,
    },
  };
};

/**
 * The JSON string `narrate()` hands to `AIService.chatWithDM` as `message` for a
 * death-save turn in a fight with `monsterCount` creatures still standing.
 */
export function buildDeathSaveNarrationPayload(monsterCount = 4): string {
  const monsters = Array.from({ length: monsterCount }, (_, i) => monster(i + 1));
  const results = monsters.map((m) => npcResultFor(m, 9));
  const engineRows = monsters.map((m, i) => engineRowFor(m, results[i], 9));
  const batch = {
    results,
    currentParticipant: {
      id: DYING_CLERIC.id,
      name: DYING_CLERIC.name,
      participantType: 'player',
      vitalState: 'dying',
    },
    round: 10,
    combatEnded: false,
    iterationCount: monsterCount,
    iterationCap: (monsterCount + 1) * 2,
    capReached: false,
    transcriptLines: [] as string[],
    engineRows,
  };
  const intentResult = {
    previousParticipant: null,
    currentParticipant: { id: monsters[0].id, name: monsters[0].name },
    newRound: false,
    roundNumber: 9,
    deathSaves: [
      {
        participantId: DYING_CLERIC.id,
        roll: 14,
        isSuccess: true,
        isCritical: false,
        successes: 1,
        failures: 2,
        isStabilized: false,
        isDead: false,
        wasRevived: false,
        newCurrentHp: 0,
      },
    ],
    npcTurns: batch,
    engineRows,
  };
  const resolvedActions: Array<Record<string, unknown>> = [
    {
      action: {
        actor_id: DYING_CLERIC.id,
        action_type: 'death_save',
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      outcomes: [],
      engineResult: intentResult,
    },
    ...batch.results.map(({ transcriptLines: _dropped, ...result }) => ({
      ...result,
      actorIsPlayer: false,
    })),
  ];
  const roster = [DYING_CLERIC, ...monsters];
  return JSON.stringify({
    authoritativeCombatResults: resolvedActions.map((entry) =>
      dmFacingResolvedAction(entry, roster as never),
    ),
    authoritativeCombatResultsNote:
      'Each engineFact is what the engine resolved. Do not invent different numbers, targets, or outcomes.',
    refusedActions: [],
    withheldPlayerActions: [],
    currentTurn: DYING_CLERIC.name,
    turnHandoff:
      'Thrum Ironsoul is unconscious and dying, so they take no action and say nothing. Do not ask what they do.',
  });
}

/**
 * The exact body `llmApiClient.generateText` POSTs for the narration call
 * (rest-client.ts: prompt, systemPrompt, maxTokens 8192, temperature 0.9,
 * provider openrouter, requestType user, sessionId, metrics). The prompt's tail
 * is ai-service's assembly: the payload rides inside `<player_input>` either way.
 * `includePlayerInput: true` reproduces the pre-#874 client, which also sent the
 * payload as the `player_input` field.
 */
export function buildNarrationGenerateBody(
  payload: string,
  options: { includePlayerInput: boolean },
): Record<string, unknown> {
  return {
    prompt: [
      'CAMPAIGN CONTEXT',
      'The party descends into the Abyss.',
      '<player_input>',
      payload,
      '</player_input>',
    ].join('\n'),
    systemPrompt: 'You are Nisaba, the AI Dungeon Master.',
    ...(options.includePlayerInput ? { player_input: payload } : {}),
    maxTokens: 8192,
    temperature: 0.9,
    provider: 'openrouter',
    requestType: 'user',
    sessionId: DEATH_SAVE_NARRATION_SESSION_ID,
    // ai-service's `metrics` is measurePromptSections output: a
    // Record<string, number> of per-section token counts (the route schema
    // rejects any non-number value).
    metrics: {
      total: 15234,
      system: 3900,
      history: 900,
      player_input: 10185,
      scene: 120,
      canon_cut: 0,
      history_below_floor: 0,
    },
  };
}
