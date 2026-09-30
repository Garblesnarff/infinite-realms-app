/**
 * The player combat spells from issue #2085 (plus Burning Hands, #2233), classified by how the client asks
 * the player to participate. Resolution still belongs to the engine.
 */

export type PlayerCombatSpellKind = 'attack' | 'save' | 'auto-hit';

export interface PlayerCombatSpell {
  id: string;
  name: string;
  kind: PlayerCombatSpellKind;
  saveAbility?: 'DEX';
  /** Names one creature. Burning Hands is a save spell too, but a cone: its targets come from the map. */
  singleTarget?: true;
}

const PLAYER_COMBAT_SPELLS: readonly PlayerCombatSpell[] = [
  { id: 'fire-bolt', name: 'Fire Bolt', kind: 'attack' },
  { id: 'ray-of-frost', name: 'Ray of Frost', kind: 'attack' },
  { id: 'chill-touch', name: 'Chill Touch', kind: 'attack' },
  { id: 'eldritch-blast', name: 'Eldritch Blast', kind: 'attack' },
  { id: 'acid-splash', name: 'Acid Splash', kind: 'save', saveAbility: 'DEX', singleTarget: true },
  {
    id: 'sacred-flame',
    name: 'Sacred Flame',
    kind: 'save',
    saveAbility: 'DEX',
    singleTarget: true,
  },
  { id: 'magic-missile', name: 'Magic Missile', kind: 'auto-hit' },
  // #2233: the premade Wizard's and Sorcerer's leveled damage spell; the engine rolls the saves.
  { id: 'burning-hands', name: 'Burning Hands', kind: 'save', saveAbility: 'DEX' },
];

const byId = new Map(PLAYER_COMBAT_SPELLS.map((spell) => [spell.id, spell]));
const byName = new Map(PLAYER_COMBAT_SPELLS.map((spell) => [spell.name.toLowerCase(), spell]));

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Resolve a scoped combat spell from a model/engine id or display name. */
export function resolvePlayerCombatSpell(
  spellId?: string | null,
  spellName?: string | null,
): PlayerCombatSpell | null {
  const id = typeof spellId === 'string' ? normalize(spellId) : '';
  if (id && byId.has(id)) return byId.get(id) ?? null;
  const name = typeof spellName === 'string' ? spellName.trim().toLowerCase() : '';
  if (name && byName.has(name)) return byName.get(name) ?? null;
  if (id && byName.has(id.replace(/-/g, ' '))) return byName.get(id.replace(/-/g, ' ')) ?? null;
  return null;
}

const titleCase = (value: string): string =>
  value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export function playerCombatSpellLabel(spellId?: string | null, spellName?: string | null): string {
  const resolved = resolvePlayerCombatSpell(spellId, spellName);
  if (resolved) return resolved.name;
  const raw = (spellName || spellId || '').trim();
  if (!raw) return 'unknown spell';
  return /[A-Z]/.test(raw) ? raw : titleCase(raw);
}
