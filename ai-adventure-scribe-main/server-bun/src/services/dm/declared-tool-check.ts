/** Preserve the explicitly declared tool when a model substitutes Sleight of Hand. */
export function preserveDeclaredToolCheck(
  envelope: Record<string, unknown> | null,
  playerInput: string,
): void {
  if (
    !envelope ||
    !/^i\s+(?:try to\s+)?pick\s+(?:the\s+)?lock\s+with\s+my\s+thieves['’]?\s+tools[.!]?$/i.test(
      playerInput.trim(),
    )
  )
    return;
  if (!Array.isArray(envelope.roll_requests)) return;
  for (const roll of envelope.roll_requests) {
    if (!roll || typeof roll !== 'object') continue;
    if (!['check', 'skill_check'].includes(roll.type) || typeof roll.purpose !== 'string') continue;
    if (!/sleight of hand/i.test(roll.purpose) || !/lock/i.test(roll.purpose)) continue;
    roll.type = 'check';
    roll.purpose = "Thieves' Tools check to pick the lock";
  }
}
