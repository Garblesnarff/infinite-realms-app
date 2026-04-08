import type { Tables, TablesInsert, TablesUpdate } from './common';

export type GameSession = Tables<'game_sessions'>;
export type GameSessionInsert = TablesInsert<'game_sessions'>;
export type GameSessionUpdate = TablesUpdate<'game_sessions'>;

export type DialogueHistory = Tables<'dialogue_history'>;
export type DialogueHistoryInsert = TablesInsert<'dialogue_history'>;
export type DialogueHistoryUpdate = TablesUpdate<'dialogue_history'>;
