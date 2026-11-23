/** #1635: the exact body a menu Grapple/Shove/Hide chip sends through the DM dialect.
 * The same intent the typed check sends (runDeclaredCombatCheck), origin action_bar;
 * dmStartedAt is undefined on this path so JSON drops it. */
export const CHECK_MENU_ACTOR_ID = '7b1635aa-0c4e-4d2a-9a11-0000000c0001';
export const CHECK_MENU_TARGET_ID = '7b1635aa-0c4e-4d2a-9a11-0000000c0002';
export const CHECK_MENU_GIANT_ID = '7b1635aa-0c4e-4d2a-9a11-0000000c0003';
export const CHECK_MENU_FAR_ID = '7b1635aa-0c4e-4d2a-9a11-0000000c0004';

export const combatCheckMenuIntentBody = (
  checkKind: 'grapple' | 'shove' | 'hide',
  options: {
    actorId?: string;
    targetId?: string;
    d20?: number;
    shoveOutcome?: 'prone' | 'push';
  } = {},
) => ({
  intent: {
    type: 'check' as const,
    actorId: options.actorId ?? CHECK_MENU_ACTOR_ID,
    checkKind,
    ...(options.targetId ? { targetId: options.targetId } : {}),
    ...(options.d20 !== undefined ? { d20: options.d20 } : {}),
    ...(options.shoveOutcome ? { shoveOutcome: options.shoveOutcome } : {}),
  },
  source: 'dm' as const,
  origin: 'action_bar' as const,
});
