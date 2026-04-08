import type { Tables, TablesInsert, TablesUpdate } from './common';

export type Character = Tables<'characters'>;
export type CharacterInsert = TablesInsert<'characters'>;
export type CharacterUpdate = TablesUpdate<'characters'>;

export type CharacterStats = Tables<'character_stats'>;
export type CharacterStatsInsert = TablesInsert<'character_stats'>;
export type CharacterStatsUpdate = TablesUpdate<'character_stats'>;

export type CharacterEquipment = Tables<'character_equipment'>;
export type CharacterEquipmentInsert = TablesInsert<'character_equipment'>;
export type CharacterEquipmentUpdate = TablesUpdate<'character_equipment'>;
