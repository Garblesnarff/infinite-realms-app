/**
 * The narration contract: engine-authoritative facts the combat narration step must not
 * exceed, plus the machine-readable envelope the client post-check validates against.
 *
 * Recorded failures this exists to prevent (issues #2230 run 10, #2231 run M4):
 * - run 10: one NPC attack roll (13 + 3 = 16, MISS) narrated as "a flurry of strikes" / "blows".
 * - run 10: a natural-2 miss narrated as "Your longsword swings true".
 * - run 10: the scene drifted from a rope over a chasm to "stone floor", "small space",
 *   "chamber", "halls".
 * - run M4: the DM narrated "You dash across the room" when no Dash was declared or resolved.
 * - run M4: the DM wrote "It is not your turn yet" while the tracker showed the player's turn
 *   (initiative 19 vs 7).
 */
import { getDistance } from '../../tactical/engine.js';
import { entitySlug, resolveEntityRef } from '../../tactical/identity.js';

import type { DmFactAction, TacticalMap } from '../../tactical/types.js';

/**
 * The engine's discrete action types. `move` is included because the contract lists the
 * actions resolved this turn; ordinary prose verbs ("steps", "lunges") are the narration's
 * own vocabulary and are not validated against this list by the client post-check.
 */
export type ContractActionKind = DmFactAction['kind'];

export type ContractResolvedAction = Omit<DmFactAction, 'timestamp'>;

export type ContractCurrentTurn = {
  slug: string;
  label: string;
  isPlayer: boolean;
  round: number;
};

export type NarrationContractInput = {
  currentTurn: ContractCurrentTurn | null;
  actions: ContractResolvedAction[];
  /**
   * Engine-known position anchor for the current actor, e.g.
   * "the-veteran@(12,4) mv30/30; vitruvian-spider 15ft LoS".
   * Null when no tactical map is loaded.
   */
  sceneAnchor: string | null;
  /**
   * The map's semantic scene description, e.g. "hanging from a rope over a chasm".
   * Geometry alone cannot preserve this (#2230 run 10 drifted to "stone floor" /
   * "chamber" / "halls"); the client post-check validates setting nouns against it.
   */
  sceneDescription?: string | null;
};

export type AggregatedContractAction = {
  kind: ContractActionKind;
  count: number;
  actorSlugs: string[];
  /** True when every resolved instance succeeded, false when every one failed. */
  hit: boolean | undefined;
  /** True when instances disagree (some hit, some missed). */
  mixed: boolean;
};

/** Group resolved actions by kind, keeping per-kind counts and hit/miss agreement. */
export function aggregateContractActions(
  actions: ContractResolvedAction[],
): AggregatedContractAction[] {
  const byKind = new Map<ContractActionKind, ContractResolvedAction[]>();
  for (const action of actions) {
    const list = byKind.get(action.kind);
    if (list) list.push(action);
    else byKind.set(action.kind, [action]);
  }
  return [...byKind.entries()].map(([kind, list]) => {
    const hits = list.map((action) => action.hit).filter((hit) => hit !== undefined);
    const allHit = hits.length > 0 && hits.every(Boolean);
    const allMiss = hits.length > 0 && hits.every((hit) => !hit);
    return {
      kind,
      count: list.length,
      actorSlugs: [...new Set(list.map((action) => action.actorSlug))],
      hit: allHit ? true : allMiss ? false : undefined,
      mixed: hits.length > 1 && !allHit && !allMiss,
    };
  });
}

/**
 * A compact position anchor for one actor, derived from the loaded tactical map:
 * the actor's cell, remaining movement, and distance/LoS to each living enemy.
 * This is the engine's ground truth for "where the fight is"; the narration may not
 * relocate the fight to a setting this anchor does not name.
 */
export function sceneAnchorForActor(map: TacticalMap, actorRef: string): string | null {
  const actor = resolveEntityRef(map.entities, actorRef);
  if (!actor) return null;
  const slug = entitySlug(actor);
  const parts = [`${slug}@(${actor.x},${actor.y}) mv${actor.movementRemaining}/${actor.speedFeet}`];
  for (const other of map.entities) {
    if (other.isLiving === false || other.id === actor.id) continue;
    parts.push(`${entitySlug(other)} ${getDistance(actor, other)}ft`);
  }
  return parts.join('; ');
}

const KIND_LABEL: Record<ContractActionKind, string> = {
  attack: 'attack',
  spell: 'spell',
  move: 'move',
  dash: 'dash',
  dodge: 'dodge',
  disengage: 'disengage',
  death_save: 'death save',
};

const outcomeLabel = (action: AggregatedContractAction): string => {
  if (action.hit === true) return 'HIT';
  if (action.hit === false) return 'MISS';
  if (action.mixed) return 'mixed hit/miss';
  return 'resolved';
};

/**
 * Render the `<narration_contract>` block the context route appends to the tactical
 * context. The block has two halves: hard rules for the model, and a `<contract_json>`
 * envelope the client post-check parses and validates the narration against. The
 * envelope duplicates the human-readable facts so validation is deterministic, not
 * prompt archaeology.
 */
export function buildNarrationContract(input: NarrationContractInput): string {
  const { currentTurn, sceneAnchor, sceneDescription } = input;
  const aggregated = aggregateContractActions(input.actions);
  const lines: string[] = ['<narration_contract>'];
  lines.push(
    "<!-- ENGINE-AUTHORITATIVE. These facts are the engine's ground truth for this turn. -->",
  );
  if (currentTurn) {
    lines.push(
      `Turn: ${currentTurn.label} (${currentTurn.slug}) — ` +
        (currentTurn.isPlayer ? "it IS the player's turn" : 'an NPC/monster turn') +
        `, round ${currentTurn.round}.`,
    );
  } else {
    lines.push('Turn: unknown — do not assert whose turn it is.');
  }
  if (aggregated.length > 0) {
    lines.push('Resolved actions this turn (the ONLY actions you may narrate as happening):');
    for (const action of aggregated) {
      lines.push(
        `- ${KIND_LABEL[action.kind]} x${action.count} (${outcomeLabel(action)}) ` +
          `by ${action.actorSlugs.join(', ')}.`,
      );
    }
  } else {
    lines.push(
      'Resolved actions this turn: none. Narrate no attack, spell, dash, dodge, or disengage.',
    );
  }
  if (sceneAnchor) {
    lines.push(`Scene anchor (engine geometry — the fight is HERE): ${sceneAnchor}.`);
  }
  if (sceneDescription) {
    lines.push(
      `Scene setting (the semantic scene — do not relocate the fight): ${sceneDescription}.`,
    );
  }
  lines.push('RULES:');
  lines.push(
    '1. Narrate ONLY the resolved actions above. Never name an action type ' +
      '(dash, dodge, disengage, attack, spell) the list does not contain.',
  );
  if (currentTurn?.isPlayer) {
    lines.push(
      '2. It IS the player\'s turn. Never write "not your turn", "wait your turn", ' +
        '"you cannot act yet", or anything that denies the player their turn.',
    );
  } else {
    lines.push('2. Do not hand the turn to anyone the Turn line above does not name.');
  }
  if (aggregated.some((action) => action.hit === false || action.mixed)) {
    lines.push(
      '3. A MISS is a miss: describe the swing going wide, the spell fizzling or glancing ' +
        'off. Never use success language for a miss: no "swings true", "lands", "connects", ' +
        '"finds its mark", "bites deep", "flurry of strikes", or "blows" that land.',
    );
  } else {
    lines.push(
      '3. Describe each outcome exactly as the engine resolved it: HIT means it landed, MISS means it did not.',
    );
  }
  lines.push(
    '4. Keep the setting. The scene anchor above and the scene state are the only setting ' +
      'you may describe. Do not relocate the fight: no stone floors, chambers, halls, or ' +
      'rooms the anchor does not name.',
  );
  lines.push(
    '5. Never leak engine or authoring notes into prose (no "carries no contractions", ' +
      'no stat-block jargon, no doubled articles).',
  );
  const envelope = {
    currentTurn: currentTurn
      ? {
          slug: currentTurn.slug,
          label: currentTurn.label,
          isPlayer: currentTurn.isPlayer,
          round: currentTurn.round,
        }
      : null,
    actions: aggregated.map((action) => ({
      kind: action.kind,
      count: action.count,
      actors: action.actorSlugs,
      hit: action.hit,
      mixed: action.mixed,
    })),
    sceneDescription: sceneDescription ?? null,
  };
  lines.push(`<contract_json>${JSON.stringify(envelope)}</contract_json>`);
  lines.push('</narration_contract>');
  return lines.join('\n');
}
