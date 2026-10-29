/**
 * #1227: the exact bodies the ActionBar sends when a save, auto-hit or area spell chip is
 * pressed. The chip commits to the engine with its slot and target instead of sending its
 * label to the DM. The client test asserts the hook sends exactly these; the server test posts
 * them through the real routes and checks the named slot is spent.
 */

/** Magic Missile at 1st level on the chip's target: the intent route commit (no player die). */
export const magicMissileChipIntent = (actorId: string, targetId: string) => ({
  type: 'spell' as const,
  actorId,
  targetIds: [targetId],
  spellId: 'magic-missile',
  spellName: 'Magic Missile',
  slotLevel: 1,
});

/**
 * Burning Hands upcast with a 2nd-level slot, aimed at the chip's target cell: the area route
 * body `executeAoECombatAction` posts (phase 'propose'; the route resolves a Self-range player
 * cast at once).
 */
export const burningHandsChipAoECast = (actorId: string, aim: { x: number; y: number }) => ({
  phase: 'propose' as const,
  actorId,
  spellId: 'burning-hands',
  origin: aim,
  direction: null,
  slotLevel: 2,
  actionOrigin: 'action_bar' as const,
});
