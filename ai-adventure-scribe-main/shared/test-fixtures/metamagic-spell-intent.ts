/**
 * The body a Metamagic cast puts on the wire (#1233). The spell chip sends a `spell` intent through
 * executeStructuredCombatAction (source `dm`, the dialect every player cast uses), with the armed
 * option as `metamagic`. The client hook test asserts the posted body contains this fixture; the
 * real-route suite posts it through the intent route. `dmStartedAt` is a clock value, so the
 * fixture omits it.
 */
export const metamagicMagicMissileBody = (
  actorId: string,
  targetId: string,
  metamagic: string = 'quickened',
) => ({
  source: 'dm' as const,
  intent: {
    type: 'spell' as const,
    actorId,
    targetIds: [targetId],
    spellId: 'magic-missile',
    spellName: 'Magic Missile',
    slotLevel: 1,
    metamagic,
  },
  origin: 'action_bar' as const,
});
