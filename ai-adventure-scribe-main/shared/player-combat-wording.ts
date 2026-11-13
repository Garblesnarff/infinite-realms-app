/**
 * One table from an engine key to the words a player reads (#764).
 *
 * End reasons, condition names, health tiers, and refusal keys live here. Chat, notices, and
 * the combat-end line read this table. They do not keep a second map.
 */

/** CombatEndReason, plus the legacy death-save key the end line still covers. */
export const END_REASON_KEYS = [
  'last_hostile_defeated',
  'party_defeated',
  'death_save_failed',
  'player_down_stable',
  'dm_ended_scene',
  'ended_by_request',
  'abandoned',
  'player_surrendered',
  'ended_idle',
] as const;

/** ConditionName values. They are already player words; the table keeps them in one place. */
export const CONDITION_KEYS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'exhaustion',
  'surprised',
] as const;

const END_PHRASES: Record<(typeof END_REASON_KEYS)[number], string> = {
  last_hostile_defeated: 'the last hostile was defeated',
  party_defeated: 'the party was defeated',
  death_save_failed: 'a death save ended the fight',
  player_down_stable: 'the party was knocked out but stable',
  dm_ended_scene: 'the fight ended as the scene moved on',
  ended_by_request: 'you ended the fight',
  abandoned: 'the party broke off and left the fight',
  player_surrendered: 'you yielded',
  ended_idle: 'the fight was left idle and closed',
};

const REFUSAL_PHRASES: Record<string, string> = {
  weapon_not_equipped: 'that weapon is not in your hand',
  weapon_not_on_sheet: 'that weapon is not on your sheet',
  declared_weapon_not_equipped: 'that weapon is not in your hand',
  no_ammunition: 'you are out of ammunition',
  actor_unconscious: 'that creature is unconscious',
  actor_mismatch: 'that action is for someone else',
  feature_not_on_sheet: 'that feature is not on your sheet',
  feature_uses_exhausted: 'that feature has no uses left',
  feature_refused: 'that feature cannot be used now',
  death_save_required: 'a death save is required first',
  death_save_conflict: 'a death save is already in progress',
  death_save_not_owed: 'no death save is owed',
  declared_after_turn_ended: 'that action was declared after the turn ended',
  spell_not_known: 'that spell is not on your sheet',
  declared_spell_not_known: 'that spell is not on your sheet',
  declared_spell_unknown: 'that spell is not known',
  declared_spell_unsupported: 'that spell cannot be cast this way',
  unknown_spell: 'that spell is not known',
  unresolved_spell: 'that spell could not be resolved',
  unsupported_spell: 'that spell cannot be resolved',
  unsupported_spell_resolution: 'that spell cannot be resolved',
  missing_spell_slot_level: 'name the spell slot',
  no_line_of_sight: 'you have no line of sight',
  out_of_range: 'that target is out of range',
  total_cover: 'that target has total cover',
  no_target: 'no target selected',
  no_target_selected: 'no target selected',
  invalid_target: 'that is not a valid target',
  player_action_without_input: 'name the action you want to take',
  already_full_health: 'you are already at full health',
  action_surge_already_armed: 'Action Surge is already ready',
  not_grappled: 'you are not grappled',
  no_stat_block: 'that creature has no stat block',
  hex_single_target: 'hex needs one target',
  bless_no_target: 'bless needs a target',
  bless_too_many_targets: 'bless has too many targets',
  out_of_reach_after_full_movement: 'you cannot reach them with your remaining movement',
  move_refused: 'that move was refused',
  movement_exhausted: 'you have no movement left',
  insufficient_movement: 'you do not have enough movement',
  no_geometry: 'the map has no distances yet',
  no_active_map: 'there is no battle map',
  no_active_encounter: 'there is no fight',
  combat_entry_pending: 'combat has not started yet',
  encounter_ended: 'the fight is already over',
  no_cell: 'there is no open space',
  invalid_cell: 'that space is not on the map',
  no_reachable_adjacent_cell: 'there is no open space next to them',
};

const HEALTH_PHRASES: Record<string, string> = {
  unharmed: 'unharmed',
  wounded: 'wounded',
  bloodied: 'bloodied',
  'near death': 'near death',
};

export const PLAYER_COMBAT_WORDING: Record<string, string> = {
  ...END_PHRASES,
  ...Object.fromEntries(CONDITION_KEYS.map((key) => [key, key])),
  ...HEALTH_PHRASES,
  ...REFUSAL_PHRASES,
};

const END_REASON_SET = new Set<string>(END_REASON_KEYS);

const SNAKE_CASE = /\b[a-z]+(?:_[a-z0-9]+)+\b/g;

const UNDERSCORE_KEYS = Object.keys(PLAYER_COMBAT_WORDING)
  .filter((key) => key.includes('_'))
  .sort((a, b) => b.length - a.length);

/** The end-line phrase for a CombatEndReason. Any other key stays off the line. */
export function combatEndPhrase(reason: string): string {
  if (!END_REASON_SET.has(reason)) return 'the fight is over';
  return PLAYER_COMBAT_WORDING[reason] ?? 'the fight is over';
}

/**
 * Replace engine keys in player-facing text. Known underscore keys use the table.
 * A leftover snake_case token becomes a plain phrase so the key itself is never shown.
 * Single words such as "bloodied" and "prone" are left as written.
 */
export function renderPlayerCombatWording(text: string): string {
  let rendered = text;
  for (const key of UNDERSCORE_KEYS) {
    const phrase = PLAYER_COMBAT_WORDING[key];
    if (!phrase) continue;
    rendered = rendered.replace(new RegExp(`\\b${key}\\b`, 'g'), phrase);
  }
  return rendered.replace(SNAKE_CASE, 'a rules result');
}
