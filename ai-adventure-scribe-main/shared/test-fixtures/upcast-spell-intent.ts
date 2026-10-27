/**
 * #1206: the commit intent the ActionBar sends for an upcast attack-spell chip. The chip names
 * the slot it spends (`slotLevel` 3 for an Acid Arrow when no 2nd-level slot remains), and the
 * bar sends that level. The client test asserts the hook sends exactly this intent; the server
 * test posts it through the real intent route and checks a 3rd-level slot is spent.
 */
export const upcastAcidArrowIntent = (actorId: string, targetId: string, d20: number) => ({
  type: 'spell' as const,
  actorId,
  targetIds: [targetId],
  spellId: 'acid-arrow',
  spellName: 'Acid Arrow',
  slotLevel: 3,
  d20,
});
