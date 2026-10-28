/* eslint-disable max-lines -- one turn pipeline shared by the CLI and the browser. */
import { mapToAscii } from '../../server-bun/src/tactical/serialize';
import { buildTacticalDigest } from '../../server-bun/src/tactical/tactical-context';

import type { InitiativeOrderEntry } from '../../server-bun/src/services/combat/initiative-order';
import type { AIResponse } from '@/services/ai/shared/types';
import type { RollRequest } from '@/types/roll-request';

import { buildAIContext } from '@/hooks/ai/ai-utils';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { stripAssetTags } from '@/lib/utils';
import { AIService } from '@/services/ai-service';
import {
  combatBoundaryFromResult,
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
  type StructuredCombatAction,
} from '@/services/combat/combat-action-executor';
import {
  buildCombatEntryPlayer,
  type CombatEntryPayload,
} from '@/services/combat/structured-combat-payload';
import { DiceEngine, type DiceRollResult } from '@/services/dice/DiceEngine';
import { extractHeadlessOptions } from '@/services/headless-game-options';
import { userDataApi } from '@/services/user-data-api';
import { resolveFormulaForCharacter } from '@/utils/roll-request/formula-utils';

export type HeadlessEvent =
  | { type: 'narration'; text: string; provider?: 'openrouter' | 'gemini'; model?: string }
  | { type: 'options'; options: string[] }
  | { type: 'roll_request'; requests: RollRequest[] }
  | { type: 'roll_result'; request: RollRequest; result: DiceRollResult }
  | {
      type: 'map_state';
      map: unknown;
      ascii: string;
      digest: string;
      initiative: InitiativeOrderEntry[];
    }
  | { type: 'error'; message: string };

export class ContractViolationError extends Error {
  readonly category = 'contract';

  constructor(message: string) {
    super(message);
    this.name = 'ContractViolationError';
  }
}

/**
 * The server refused to seat a pending combat entry (#913). The shape is the one the
 * auto-play failure streak and the CLI transcript already read: fingerprinted
 * `combat_entry:<status>:entry:<detail>`, three identical refusals stop the run
 * instead of the entry being re-proposed until the turn budget is gone.
 */
export class CombatEntryError extends Error {
  readonly category = 'transport';
  readonly stage = 'entry';
  readonly status: number;
  readonly detail: string;
  readonly responseBody: string;
  readonly envelope: unknown;
  readonly fingerprint: string;

  constructor(params: { status: number; detail: string; responseBody: string; envelope: unknown }) {
    super(`Combat entry failed (${params.status}, stage: entry): ${params.detail}`);
    this.name = 'CombatEntryError';
    this.status = params.status;
    this.detail = params.detail;
    this.responseBody = params.responseBody;
    this.envelope = params.envelope;
    this.fingerprint = `combat_entry:${params.status}:entry:${params.detail}`;
  }

  toTranscriptDetail(): Record<string, unknown> {
    return {
      kind: 'combat_entry_failure',
      status: this.status,
      stage: this.stage,
      detail: this.detail,
      responseBody: this.responseBody,
      dmEnvelope: this.envelope,
    };
  }
}

/** The refusal's detail is the route's `error` line when it sent one, else the status. */
async function combatEntryError(
  enterResponse: Response,
  envelope: AIResponse,
): Promise<CombatEntryError> {
  const responseBody = await enterResponse.text().catch(() => '');
  let detail = `HTTP ${enterResponse.status}`;
  try {
    const parsed = JSON.parse(responseBody) as { error?: unknown } | null;
    if (typeof parsed?.error === 'string' && parsed.error) detail = parsed.error;
  } catch {
    // A non-JSON refusal body keeps the status line as its detail.
  }
  return new CombatEntryError({
    status: enterResponse.status,
    detail,
    responseBody,
    envelope,
  });
}

export type HeadlessRollOutcome =
  | { skipped: false; request: RollRequest; result: DiceRollResult }
  | { skipped: true; request: RollRequest; error: ContractViolationError };
export type CompletedHeadlessRoll = Extract<HeadlessRollOutcome, { skipped: false }>;

/**
 * A non-React orchestrator over the exact client services used by the browser.
 * React owns presentation; this class owns only the reusable play pipeline.
 */
export class HeadlessGameClient {
  private readonly processedRolls = new Set<string>();
  private pending: RollRequest[] = [];
  private options: string[] = [];
  private history: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }> = [];
  private turnCount = 0;
  private character: Record<string, unknown> = {};
  private combatActive = false;

  constructor(readonly sessionId: string) {}

  async load(): Promise<void> {
    const [session, messages] = await Promise.all([
      userDataApi.getSession(this.sessionId),
      userDataApi.listSessionMessages(this.sessionId, 0, 200),
    ]);
    this.turnCount = Number(session.turn_count || 0);
    this.history = (messages.messages || []).map(
      (message: Record<string, unknown>, index: number) => ({
        id: String(message.id || `history-${index}`),
        role: message.speaker_type === 'player' ? 'user' : 'assistant',
        content: String(message.message || ''),
        timestamp: new Date(String(message.timestamp || Date.now())),
      }),
    );
    this.combatActive = Boolean(await this.getMap());
  }

  get pendingRolls(): readonly RollRequest[] {
    return this.pending;
  }

  get availableOptions(): readonly string[] {
    return this.options;
  }

  /**
   * One turn. Any failure after the LLM has answered is re-thrown with the provider/model
   * that served it attached, so a failed turn still lands in provider telemetry.
   */
  async play(
    input: string,
    diceRollBatch?: readonly CompletedHeadlessRoll[],
  ): Promise<HeadlessEvent[]> {
    const telemetry: { provider?: 'openrouter' | 'gemini'; model?: string } = {};
    try {
      return await this.runTurn(input, diceRollBatch, telemetry);
    } catch (error) {
      throw this.withTelemetry(error as object, telemetry.provider, telemetry.model);
    }
  }

  private async runTurn(
    input: string,
    diceRollBatch: readonly CompletedHeadlessRoll[] | undefined,
    telemetry: { provider?: 'openrouter' | 'gemini'; model?: string },
  ): Promise<HeadlessEvent[]> {
    const diceRolls = diceRollBatch || [];
    const diceRoll = diceRolls.at(-1);
    if (this.pending.length && !diceRolls.length) {
      throw new Error('Resolve the pending roll before sending another action');
    }
    const rollMessages = diceRolls.map((roll) => this.formatRoll(roll));
    const isUnresolvableContinuation = input === 'I attempt it.';
    const effectiveInput = isUnresolvableContinuation ? input : rollMessages.at(-1) || input;
    const priorRollMessages = isUnresolvableContinuation ? rollMessages : rollMessages.slice(0, -1);
    const priorRollHistory = priorRollMessages.map((content, index) => ({
      id: `roll-${crypto.randomUUID()}-${index}`,
      role: 'user' as const,
      content,
      timestamp: new Date(),
    }));
    const context = diceRoll
      ? { intent: 'dice_roll', diceRoll: this.rollContext(diceRoll) }
      : { intent: this.turnCount === 0 ? 'first_action' : 'query' };
    const game = await userDataApi.getSessionContext(this.sessionId);
    this.character = game.character;
    const combat = this.combatActive
      ? await this.combatSnapshot()
      : { encounterId: null, currentParticipantId: null, initiativeOrder: [] };
    const aiContext = buildAIContext({
      sessionId: this.sessionId,
      starterCampaignId: game.starter_campaign_id || undefined,
      currentSceneDescription:
        typeof game.current_scene_description === 'string'
          ? game.current_scene_description
          : undefined,
      campaign: game.campaign,
      character: game.character,
      currentPhase: 'exploration',
      isInCombat: this.combatActive,
      encounterId: combat.encounterId,
      currentTurnParticipantId: combat.currentParticipantId,
      pendingRollsCount: this.pending.length,
    });
    // The tactical server computes geometry; the DM receives only its digest and never derives
    // distance itself. Without this the prompt carries no board and every combat contract on
    // the server — translation, prose floor, spatial check — is a no-op.
    //
    // Gated on `combatActive` rather than on there being a current participant, because the
    // one turn on which there is no current participant is the turn immediately after the
    // engine ended the encounter — and that is precisely the turn carrying the killing blow,
    // the character going down, and the reason the fight is over. Requiring a live participant
    // here meant the DM was guaranteed never to be told how any fight ended. The entity id is
    // only used to centre the board digest, so a fight with no board left passes a placeholder.
    if (this.combatActive) {
      const tactical = await this.loadTacticalContext(combat.currentParticipantId ?? '-');
      if (tactical) {
        (aiContext.gameState as Record<string, unknown>).tacticalContext = tactical.context;
        // #849: ai-service echoes the delivery token on the generate call so the
        // server can confirm delivery of the one-shot facts and delete them.
        if (tactical.deliveryToken)
          (aiContext.gameState as Record<string, unknown>).tacticalDeliveryToken =
            tactical.deliveryToken;
      }
    }
    const nextTurnCount = this.turnCount + 1;
    let response = await AIService.chatWithDM({
      message: effectiveInput,
      context: aiContext,
      conversationHistory: [...this.history, ...priorRollHistory],
      turnCount: nextTurnCount,
      onProviderResponse: (metadata) => {
        telemetry.provider = metadata.provider;
        telemetry.model = metadata.model;
      },
    });
    if (!response || typeof response.text !== 'string' || !response.text.trim()) {
      throw new ContractViolationError('DM response is missing a non-empty text field');
    }
    if (response.roll_requests !== undefined && !Array.isArray(response.roll_requests)) {
      throw new ContractViolationError('DM response roll_requests field is not an array');
    }
    // #913: the browser completes a pending entry in `dm-actions-handler` — confirm,
    // roll initiative, POST `/enter`. This client never read the field, so the pending's
    // initiative request fell into the narrative roll queue, the roll went back as chat
    // text, nothing seated, and the DM re-proposed the same entry every turn (the
    // fair-test failure: 8 proposals, no encounter). Seat it the same way here.
    if (response.combat_entry_pending && !this.combatActive) {
      response = await this.seatPendingCombatEntry(response);
    }
    // #1907 PR1: a pending handoff is not a seated encounter. Only the explicit `/enter`
    // response can report `combat_entry.entered`; the model's raw start signal is not authority.
    if (response.combat_entry?.entered) {
      this.combatActive = true;
    } else if (response.combat_transition === 'end') {
      const endResponse = await userDataApi.endTacticalMap(this.sessionId);
      if (!endResponse.ok) throw new Error(`Structured combat end failed (${endResponse.status})`);
      this.combatActive = false;
    }
    if (response.map_actions?.length) {
      const actionResponse = await userDataApi.applyDmTacticalActions(
        this.sessionId,
        response.map_actions as Parameters<typeof userDataApi.applyDmTacticalActions>[1],
      );
      if (!actionResponse.ok)
        throw new Error(`DM tactical action batch failed (${actionResponse.status})`);
    }
    // Declared attacks are executed here, not merely reported. The CLI used to print
    // `combat_actions` into a transcript and drop them, so no headless run has ever put an
    // attack through the engine — which is exactly what "zero combat_actions ever populated"
    // measured. The encounter id is re-read because a start transition on this same turn is
    // what created it.
    const targeted = ((response.combat_actions ?? []) as StructuredCombatAction[]).filter(
      (action) => 'target_ids' in action,
    );
    if (targeted.length && this.combatActive) {
      const encounterId = combat.encounterId ?? (await this.combatSnapshot()).encounterId;
      if (encounterId) await this.resolveCombatActions(encounterId, targeted);
    }
    const processed = await processRollRequests({
      responseText: response.text,
      existingRequests: (response.roll_requests || []) as RollRequest[],
      isDiceRollMessage: Boolean(diceRoll),
      processedSet: this.processedRolls,
      // @ts-expect-error // #192 GameContext is not assignable to Record<string, unknown> aiContext param
      aiContext,
      sessionId: this.sessionId,
      characterId: String(game.character.id || 'player'),
    });
    this.pending = processed.playerRollRequests;
    const text = stripAssetTags(response.text).replace(/\n{3,}/g, '\n\n');
    for (let index = 0; index < priorRollMessages.length; index += 1) {
      await userDataApi.saveSessionMessages(this.sessionId, {
        speaker_type: 'player',
        message: priorRollMessages[index],
        context: { intent: 'dice_roll', diceRoll: this.rollContext(diceRolls[index]) },
        timestamp: new Date().toISOString(),
      });
    }
    await userDataApi.saveSessionMessages(
      this.sessionId,
      {
        speaker_type: 'player',
        message: effectiveInput,
        context,
        timestamp: new Date().toISOString(),
      },
      diceRoll ? null : undefined,
    );
    await userDataApi.saveSessionMessages(this.sessionId, {
      speaker_type: 'dm',
      message: text,
      context: { roll_requests: this.pending },
      timestamp: new Date().toISOString(),
    });
    this.history.push(...priorRollHistory);
    this.history.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: effectiveInput,
      timestamp: new Date(),
    });
    this.history.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: text,
      timestamp: new Date(),
    });
    this.turnCount = nextTurnCount;
    await userDataApi.updateSession(this.sessionId, { turn_count: this.turnCount });
    const events: HeadlessEvent[] = [
      { type: 'narration', text, provider: telemetry.provider, model: telemetry.model },
    ];
    this.options = extractHeadlessOptions(text, response.options);
    if (this.options.length) events.push({ type: 'options', options: this.options });
    if (this.pending.length) events.push({ type: 'roll_request', requests: this.pending });
    const map = await this.getMap();
    // The board is the authority on whether combat is running; `combatActive` is only a
    // cache of it. It used to be written solely by start/end transitions, so it could not
    // learn about an encounter the *engine* ended -- the last hostile going down tears the
    // map down server-side without any transition passing through here. The flag then stayed
    // true, and the next turn told the DM it was mid-fight on a board that no longer existed.
    // Re-reading it from the map already fetched for this turn's events costs nothing and
    // means the flag can only ever be one turn's work behind the server, never permanently
    // wrong. (The nine-encounters loop itself was the server bug fixed in
    // combat-intent-service's `endCombatIfResolved`; this stops the client from carrying a
    // stale answer in either direction.)
    this.combatActive = Boolean(map);
    if (map) {
      const tacticalMap = map as Parameters<typeof mapToAscii>[0];
      events.push({
        type: 'map_state',
        map,
        ascii: mapToAscii(tacticalMap),
        digest: buildTacticalDigest(tacticalMap),
        initiative: await this.getInitiativeOrder(),
      });
    }
    return events;
  }

  /**
   * Seat a pending combat entry the way the browser does (#913). The headless player is
   * the one who declared the attack (or picked the action that proposed the fight), so
   * confirmation is the standing auto-play policy — the same policy that auto-rolls every
   * DM roll request; declining is a human-only choice with no scripted equivalent. The
   * initiative d20 is rolled here and consumed by `/enter`. A refusal throws
   * `CombatEntryError`, so a deterministic refusal fails the turn loudly and the
   * auto-play failure streak stops the run, instead of the entry being re-proposed in
   * silence. The DM's telegraph text stays the turn's narration: the transcript is the
   * audit record of what the DM actually said.
   */
  private async seatPendingCombatEntry(response: AIResponse): Promise<AIResponse> {
    const pending = response.combat_entry_pending;
    if (!pending) return response;
    const player = buildCombatEntryPlayer(this.character);
    if (!player) return response;

    const initiativeRoll = DiceEngine.roll('1d20');
    // The pending's type does not declare the seating hint the gate can attach; the
    // browser forwards it when present, and so does this.
    const seatingHint = (pending as { seatingHint?: CombatEntryPayload['seatingHint'] })
      .seatingHint;
    const enterPayload: CombatEntryPayload = {
      combatants: pending.combatants,
      sceneSpec: pending.sceneSpec,
      player,
      ...(pending.declaredAttack ? { declaredAttack: pending.declaredAttack } : {}),
      ...(seatingHint ? { seatingHint } : {}),
      ...(initiativeRoll.naturalRoll !== undefined
        ? { playerInitiativeRoll: initiativeRoll.naturalRoll }
        : {}),
    };
    const enterResponse = await userDataApi.enterCombat(this.sessionId, enterPayload);
    if (!enterResponse.ok) throw await combatEntryError(enterResponse, response);

    const responseBody = await enterResponse.text().catch(() => '');
    type EnteredCombatPayload = {
      encounter?: { id?: unknown };
      first_action?: { combat_action?: StructuredCombatAction };
      first_action_refusal?: unknown;
      npcTurns?: { combatEnded?: unknown };
    };
    let entryPayload: EnteredCombatPayload | null = null;
    try {
      entryPayload = JSON.parse(responseBody) as EnteredCombatPayload;
    } catch {
      entryPayload = null;
    }
    // A 201 the client cannot read the encounter out of is not a seat it can play:
    // fail the turn loudly (the failure streak ends the run) rather than inventing
    // an encounter id and playing a fight that may not exist.
    const encounterId =
      typeof entryPayload?.encounter?.id === 'string' ? entryPayload.encounter.id : null;
    if (!encounterId) {
      throw new CombatEntryError({
        status: enterResponse.status,
        detail: 'Combat entry response did not include an encounter id',
        responseBody,
        envelope: response,
      });
    }
    const firstAction = entryPayload?.first_action;
    // The route runs the creatures that won initiative before it answers (#2658);
    // when that drain already ended the fight, no first action may fire into it
    // (the browser's `preflightNpcTurns` rule in `dm-actions-handler`).
    const npcEndedCombat = entryPayload?.npcTurns?.combatEnded === true;
    return {
      ...response,
      combat_entry: {
        entered: true,
        encounterId,
        trigger: pending.trigger,
        detail: pending.detail,
        sceneSpecSynthesized: pending.sceneSpecSynthesized,
      },
      // Consumed by the seat — the initiative d20 above, and the attack the declaration
      // already named. Left in the narrative queue they would be rolled as ordinary
      // rolls and sent back as chat text, which seats nothing: the #913 loop.
      roll_requests: (response.roll_requests || []).filter((request) => {
        const type = (request as { type?: unknown } | null)?.type;
        return type !== 'attack' && type !== 'initiative';
      }),
      // A successful seat replaces the model's own batch on every path: the derived
      // opening action when `/enter` produced a usable one, and nothing when the
      // derivation was refused, absent, or the opening NPC drain ended the fight.
      // The model's batch was authored against a fight that had not seated yet.
      combat_actions: (!npcEndedCombat && firstAction?.combat_action
        ? [firstAction.combat_action]
        : []) as unknown as AIResponse['combat_actions'],
    };
  }

  roll(request = this.pending[0]): HeadlessRollOutcome {
    if (!request) throw new Error('No roll is pending');
    const formula = resolveFormulaForCharacter(
      request.formula,
      this.character,
      request.purpose,
      request.type,
    );
    this.pending = this.pending.filter((entry) => entry !== request);
    if (!formula) {
      return {
        skipped: true,
        request,
        error: new ContractViolationError(
          `Cannot auto-roll unresolved formula: ${request.formula}`,
        ),
      };
    }
    const result = DiceEngine.roll(formula, {
      advantage: request.advantage,
      disadvantage: request.disadvantage,
      purpose: request.purpose,
    });
    return { skipped: false, request, result };
  }

  /**
   * A turn that fails *after* the LLM answered still consumed a provider call. Attaching the
   * telemetry to the error is what lets the auto-play loop attribute failed turns to a
   * provider/model instead of losing them from the totals entirely.
   */
  private withTelemetry<T extends object>(error: T, provider?: string, model?: string): T {
    return Object.assign(error, provider ? { provider, model } : {});
  }

  private rollContext(diceRoll: { request: RollRequest; result: DiceRollResult }) {
    return {
      formula: diceRoll.result.expression,
      total: diceRoll.result.total,
      naturalRoll: diceRoll.result.naturalRoll,
      results: diceRoll.result.rolls.map((roll) => roll.value),
      keptResults: diceRoll.result.rolls
        .filter((roll) => roll.useInTotal !== false)
        .map((roll) => roll.value),
      advantage: !!diceRoll.result.advantage,
      disadvantage: !!diceRoll.result.disadvantage,
    };
  }

  private formatRoll({
    request,
    result,
  }: {
    request: RollRequest;
    result: DiceRollResult;
  }): string {
    let formatted = `${request.purpose}: ${result.total}`;
    if (
      result.naturalRoll !== undefined &&
      (result.modifiers !== 0 || result.naturalRoll !== result.total)
    ) {
      formatted += ` (nat ${result.naturalRoll}${result.modifiers >= 0 ? '+' : ''}${result.modifiers})`;
    }
    if (result.advantage) formatted += ' [ADV]';
    if (result.disadvantage) formatted += ' [DIS]';
    // #2609: the ✓/✗ verdict suffix is retired. No reader needs it — the
    // roll-outcome gate opens from the dice-UI flag, not message text — and it
    // is the same glyph-in-DM-text hazard #1807 removed from the live formatter.
    if (request.type === 'attack' && result.naturalRoll === 20) formatted += ' CRITICAL HIT!';
    if (request.type === 'attack' && result.naturalRoll === 1) formatted += ' Critical Miss';
    return formatted;
  }

  async move(entityId: string, x: number, y: number): Promise<unknown> {
    const { encounterId } = await this.combatSnapshot();
    if (!encounterId) throw new Error('Move failed: no active combat encounter');
    return executeAuthoritativeCombatIntent(
      encounterId,
      { type: 'move', actorId: entityId, x, y },
      'player',
      Date.now(),
      'action_bar',
    );
  }

  /** The whole order, monsters included; an unavailable encounter degrades to an empty list. */
  async getInitiativeOrder(): Promise<InitiativeOrderEntry[]> {
    return (await this.combatSnapshot()).initiativeOrder;
  }

  /**
   * Who is acting and in which encounter. Both are needed before a turn can be played: the
   * encounter id is where combat actions are sent, and the current participant is whose
   * perspective the tactical context is built from.
   */
  private async combatSnapshot(): Promise<{
    encounterId: string | null;
    currentParticipantId: string | null;
    initiativeOrder: InitiativeOrderEntry[];
  }> {
    const empty = { encounterId: null, currentParticipantId: null, initiativeOrder: [] };
    try {
      const response = await userDataApi.getActiveCombat(this.sessionId);
      if (!response.ok) return empty;
      const payload = (await response.json()) as {
        initiativeOrder?: InitiativeOrderEntry[];
        combat?: { encounter?: { id?: string } };
      };
      const initiativeOrder = payload.initiativeOrder ?? [];
      return {
        encounterId: payload.combat?.encounter?.id ?? null,
        currentParticipantId: initiativeOrder.find((entry) => entry.isCurrent)?.id ?? null,
        initiativeOrder,
      };
    } catch {
      // Turn order is reporting, never gameplay: a lookup failure must not lose the turn.
      return empty;
    }
  }

  /**
   * The tactical context the server builds for this turn: the board, the digest, and —
   * critically — `<engine_resolved_outcomes>` and the stall directive.
   *
   * The CLI never fetched this. That single omission is why runs 5-9 could not have worked
   * whatever the model emitted: with no `<tactical_context>` block in the prompt there is no
   * digest, and with no digest the legacy-attack translator, the prose-intent floor, and the
   * spatial contract all return null on their first line. It is also why the feedback loop
   * "never once fired in prod" — the endpoint that emits engine outcomes was never called.
   */
  private async loadTacticalContext(
    currentParticipantId: string,
  ): Promise<{ context: string; deliveryToken?: string } | null> {
    try {
      const response = await userDataApi.getTacticalMapContext(
        this.sessionId,
        currentParticipantId,
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        tacticalContext?: string;
        deliveryToken?: string;
      };
      if (!payload.tacticalContext) return null;
      return { context: payload.tacticalContext, deliveryToken: payload.deliveryToken };
    } catch {
      // Context is an enrichment, not a precondition: a failed fetch must not lose the turn.
      return null;
    }
  }

  /**
   * Sends the declared action to the engine and ends the actor's turn, which is what makes
   * initiative advance. Once either boundary is crossed, trailing actions are discarded so they
   * cannot target a board that has already advanced or dissolved. Nothing here decides whether
   * the action is legal or how far the attacker must walk — the engine owns all of that.
   */
  private async resolveCombatActions(
    encounterId: string,
    actions: readonly StructuredCombatAction[],
  ): Promise<void> {
    for (const action of actions) {
      const execution = await executeStructuredCombatActionWithBoundary(encounterId, action);
      // Do not send the synthesized turn boundary after a killing blow, and do not send any
      // trailing action after either kind of combat boundary. The next DM turn must re-plan from
      // the new board rather than address the dissolved one.
      if (execution.boundary) return;
      const turn = await executeAuthoritativeCombatIntent(
        encounterId,
        { type: 'end_turn', actorId: action.actor_id },
        'dm',
      );
      if (combatBoundaryFromResult(turn)) return;
      // The synthesized end_turn is itself a turn boundary. Drop the rest of this DM batch.
      return;
    }
  }

  async getMap(): Promise<unknown | null> {
    const response = await fetchWithAuth(
      `/v1/sessions/${encodeURIComponent(this.sessionId)}/tactical-map`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Tactical map failed (${response.status})`);
    const payload = (await response.json()) as unknown;
    if (payload && typeof payload === 'object' && 'map' in payload) {
      return (payload as { map?: unknown | null }).map ?? null;
    }
    return payload;
  }
}
