import { CombatEncounterService } from './combat-encounter-service.js';
import { vitalStateOf, type VitalsInput } from './death-saves-service.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import {
  displayNameFromRoster,
  rosterEntryForParticipant,
  type EngineRosterEntry,
} from '../../../../shared/engine-display-name';
import { entitySlug, resolveEntityRef, slugify } from '../../tactical/identity.js';

import type { TacticalMap } from '../../tactical/types.js';

/**
 * The initiative order as a sequence, not a set: round number, every combatant in turn order,
 * the current actor marked, and each one's slug, hit points, and remaining action economy.
 *
 * The board digest already carries an `ACTIVE <slug>` line, so the DM has never been blind to
 * whose turn it is -- but "who is active" and "where in the order that sits, and who has
 * already spent what" are different questions, and only the first was answerable. On
 * 2026-08-10 the DM declared a second attack for `the-seeker`, whose action was already spent,
 * while `sentient-glaze` held the turn; the engine refused it 422 and the player saw a raw
 * error. Nothing in the prompt had stated the ordering or the action economy that made the
 * refusal correct.
 *
 * Slugs, not names, are the addressable token: they are what `combat_actions` must echo back,
 * and `<combatant_status>` used to print names only -- so the one block that knew about hit
 * points spoke a vocabulary the action schema could not consume.
 *
 * Built here rather than in `buildTacticalPrompt` because the tactical map is deliberately
 * database-free geometry, while hit points and turn order live in `combat_participants` /
 * `combat_participant_status`. Degrades to an empty string on any failure: this is an
 * enrichment, and losing it must never cost the DM the board it is appended to.
 */
export async function buildTurnOrderBlock(sessionId: string, userId: string): Promise<string> {
  try {
    const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
    if (!encounter) return '';
    const [state, map] = await Promise.all([
      CombatEncounterService.getCombatState(encounter.id, userId),
      loadActiveTacticalMap(sessionId),
    ]);
    const currentId = state.currentParticipant?.id ?? null;
    const ordered = state.participants
      .filter((participant) => participant.isActive)
      .slice()
      .sort(
        (a, b) =>
          Number((a as { turnOrder?: number }).turnOrder ?? 0) -
          Number((b as { turnOrder?: number }).turnOrder ?? 0),
      );
    const lines = ordered.map((participant, index) => {
      const hydrated = participant as unknown as VitalsInput & {
        name: string;
        participantType?: string;
        disposition?: string | null;
        actionUsed?: boolean | null;
        bonusActionUsed?: boolean | null;
      };
      const currentHp = hydrated.status?.currentHp ?? participant.maxHp;
      const vital = vitalStateOf(hydrated);
      const detail =
        vital === 'dying'
          ? ` UNCONSCIOUS and DYING (${hydrated.status?.deathSavesSuccesses ?? 0} death save ` +
            `successes, ${hydrated.status?.deathSavesFailures ?? 0} failures) — not dead`
          : vital === 'stabilized'
            ? ' UNCONSCIOUS but STABILISED — no longer dying, cannot act'
            : vital === 'dead'
              ? ' DEAD'
              : '';
      // The board is the source of the slug, because the board is what the DM was shown. A
      // participant with no token on the map falls back to its name slugified the same way.
      const entity = map ? resolveEntityRef(map.entities, participant.id) : null;
      const slug = entity ? entitySlug(entity) : slugify(participant.name ?? participant.id);
      const isCurrent = currentId !== null && participant.id === currentId;
      const action = hydrated.actionUsed ? 'action:SPENT' : 'action:available';
      const bonus = hydrated.bonusActionUsed ? ' bonus:SPENT' : '';
      // The end-of-combat guard reads this block at generation time (#2563): without a
      // role marker it cannot tell the player or an ally from a hostile, and a standing
      // ally would block every DM scene end. The role is engine truth (participant type
      // and authored disposition), stated here rather than inferred from prose.
      const role =
        hydrated.participantType === 'player'
          ? 'role:player'
          : /ally|friend/i.test(hydrated.disposition ?? '')
            ? 'role:ally'
            : 'role:hostile';
      return (
        `${isCurrent ? '→' : ' '} ${index + 1}. ${slug} | ${participant.name} | ` +
        `${currentHp}/${participant.maxHp} HP | ${action}${bonus}` +
        `${isCurrent ? ' | CURRENT TURN' : ''}${detail} | ${role}`
      );
    });
    if (!lines.length) return '';
    return (
      `\n\n<turn_order round="${state.encounter.currentRound}">\n${lines.join('\n')}\n` +
      `</turn_order>`
    );
  } catch {
    return '';
  }
}

/**
 * Structured sibling of the CURRENT TURN marker inside `buildTurnOrderBlock`, for the
 * narration contract (#2236). Run M4's DM wrote "It is not your turn yet" while the
 * tracker showed the player's turn (initiative 19 vs 7) — the contract needs the
 * current actor and whether it is the player as data, not prose, so the client
 * post-check can reject turn-contradicting narration deterministically.
 *
 * Degrades to null on any failure: the contract is an enrichment, and losing it must
 * never cost the DM the board it is appended to.
 */
export type CurrentTurnInfo = {
  slug: string;
  label: string;
  isPlayer: boolean;
  round: number;
};

type NamedParticipant = { id: string; name?: string | null; monsterAttack?: unknown };

/** Roster the player-facing label reads. Slugs stay on the turn-order lines. */
function rosterFor(
  participants: readonly NamedParticipant[],
  map: TacticalMap | null,
): EngineRosterEntry[] {
  return participants.map((participant) => {
    const entity = map ? resolveEntityRef(map.entities, participant.id) : null;
    return {
      ...rosterEntryForParticipant(participant),
      entityName: entity?.name ?? null,
      slug: entity ? entitySlug(entity) : slugify(participant.name ?? ''),
    };
  });
}

export async function getCurrentTurnInfo(
  sessionId: string,
  userId: string,
): Promise<CurrentTurnInfo | null> {
  try {
    const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
    if (!encounter) return null;
    const [state, map] = await Promise.all([
      CombatEncounterService.getCombatState(encounter.id, userId),
      loadActiveTacticalMap(sessionId),
    ]);
    const current = state.currentParticipant;
    if (!current) return null;
    const participant = state.participants.find((p) => p.id === current.id) as
      | { id?: string; name?: string; participantType?: string }
      | undefined;
    // The board is the source of the slug, because the board is what the DM was shown —
    // same rule as buildTurnOrderBlock above. The label is a display name, never the id.
    const entity = map ? resolveEntityRef(map.entities, current.id) : null;
    const slug = entity ? entitySlug(entity) : slugify(participant?.name ?? current.id);
    const roster = rosterFor(state.participants as NamedParticipant[], map);
    if (!roster.some((row) => row.id === current.id)) {
      roster.push({
        id: current.id,
        name: participant?.name ?? null,
        entityName: entity?.name ?? null,
        slug,
      });
    }
    return {
      slug,
      label: displayNameFromRoster(current.id, roster),
      isPlayer: participant?.participantType === 'player',
      round: state.encounter.currentRound,
    };
  } catch {
    return null;
  }
}
