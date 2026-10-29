import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { getSpellById } from '@/utils/spell-lookup';

interface LegalActionLike {
  type?: string;
  spellId?: string;
  narrated?: boolean;
}

/**
 * Whether the actor's legal-action menu still offers something that costs only the bonus
 * action: Second Wind, or a live bonus-action spell chip (#1185). The server gates both on the
 * bonus action being unspent, so an offered chip is a usable bonus action.
 *
 * A failed read, or a menu for another actor, is `false`: the turn then settles on movement
 * alone, as it did before this check.
 */
export async function actorHasUsableBonusAction(
  encounterId: string,
  actorId: string,
): Promise<boolean> {
  try {
    const response = await fetchWithAuth(
      `/v1/combat/${encodeURIComponent(encounterId)}/legal-actions`,
    );
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      actorId?: string;
      actions?: LegalActionLike[];
    } | null;
    if (!payload || payload.actorId !== actorId) return false;
    return (payload.actions ?? []).some((action) => {
      if (action.narrated) return false;
      if (action.type === 'second_wind') return true;
      if (action.type !== 'spell' || !action.spellId) return false;
      const castingTime = getSpellById(action.spellId, false)?.casting_time ?? '';
      return castingTime.toLowerCase().includes('bonus action');
    });
  } catch {
    return false;
  }
}
