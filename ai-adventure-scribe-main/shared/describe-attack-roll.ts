/**
 * The words the attack-die popup shows, shared between the client and the server's
 * narration repair (#467). Pure text in, text out; no imports, so both the React hook
 * that opens the popup (`use-player-roll-host.ts`, which re-exports these) and
 * server-bun tests can use it. The repair's roll_result descriptions must be the real
 * producer's output — a handwritten copy drifts, and a drifted description is a fixture
 * that proves nothing (#2349).
 */

/** The fields describeAttackRoll reads. Mirrors PlayerAttackRollSpec (player-roll-bridge). */
export interface AttackRollDescriptionSpec {
  /** Slug or name of the attacker, for the popup's label. */
  actorLabel: string;
  weaponName: string;
  targetLabel: string;
  /** Added to the die by the engine after it arrives; shown so the die is not a bare number. */
  attackBonus: number;
  bless?: boolean;
  targetAc: number;
  advantage: boolean;
  disadvantage: boolean;
  /** Short player-facing reasons for the advantage state the engine proposed (#603). */
  advantageSources?: string[];
  /** Short player-facing reasons for the disadvantage state the engine proposed (#603). */
  disadvantageSources?: string[];
  /** Spell attacks reuse this popup but must not claim a weapon AC line. */
  kind?: 'weapon' | 'spell-attack';
  /** #1086 (e): the part of `targetAc` that is cover (+2 half, +5 three-quarters). */
  coverBonus?: number;
}

/**
 * The edge label beside the formula, with the engine's reasons when it named any (#603).
 * A flat "(disadvantage)" with no reason is what made a ranged-in-melee penalty read as a bug.
 */
function edgeLabel(kind: 'advantage' | 'disadvantage', sources: string[] | undefined): string {
  const reason = sources?.filter((source) => source.length > 0).join('; ');
  return reason ? ` (${kind}: ${reason})` : ` (${kind})`;
}

/** 'AC 14', or 'AC 12 +2 half cover' when the engine's AC includes cover (#1086 (e)). */
export function targetAcLabel(targetAc: number, coverBonus?: number): string {
  if (typeof coverBonus !== 'number' || coverBonus <= 0) {
    return `AC ${targetAc}`;
  }
  return `AC ${targetAc - coverBonus} +${coverBonus} ${coverBonus >= 5 ? 'three-quarters' : 'half'} cover`;
}

/**
 * "Longsword attack vs Sentient Glaze — 1d20+7 vs AC 15 (advantage)"
 *
 * When target numbers are hidden (Hard/Deadly, or the player turned them off), the
 * "vs AC N" clause is dropped entirely — never rendered as "(hidden)" or "?" —
 * so the dialog agrees with the engine line (#2513, #2573).
 */
export function describeAttackRoll(
  spec: AttackRollDescriptionSpec,
  showTargetNumbers = true,
): string {
  const edge = spec.advantage
    ? edgeLabel('advantage', spec.advantageSources)
    : spec.disadvantage
      ? edgeLabel('disadvantage', spec.disadvantageSources)
      : '';
  if (spec.kind === 'spell-attack') {
    return `${spec.weaponName} spell attack vs ${spec.targetLabel}${spec.bless ? ' (+1d4 Bless)' : ''}${edge}`;
  }
  const modifier = attackModifierForRoll(spec);
  const sign = modifier >= 0 ? '+' : '';
  const target = showTargetNumbers ? ` vs ${targetAcLabel(spec.targetAc, spec.coverBonus)}` : '';
  return (
    `${spec.weaponName} attack vs ${spec.targetLabel} — ` +
    `1d20${sign}${modifier}${spec.bless ? '+1d4' : ''}${target}${edge}`
  );
}

/** The popup text and displayed total must use the exact modifier sent to the roll queue. */
export function attackModifierForRoll(
  spec: Pick<AttackRollDescriptionSpec, 'attackBonus'>,
): number {
  return spec.attackBonus;
}
