import { CombatEncounterService } from './combat-encounter-service.js';
import { vitalStateOf, type VitalsInput } from './death-saves-service.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { entitySlug, resolveEntityRef, slugify } from '../../tactical/identity.js';

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
      return (
        `${isCurrent ? '→' : ' '} ${index + 1}. ${slug} | ${participant.name} | ` +
        `${currentHp}/${participant.maxHp} HP | ${action}${bonus}` +
        `${isCurrent ? ' | CURRENT TURN' : ''}${detail}`
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
