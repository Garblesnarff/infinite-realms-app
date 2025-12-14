-- Migration: Add missing foreign key indexes
-- Created: 2025-12-14
-- Purpose: Improve JOIN and cascade delete performance for foreign keys that lacked indexes

-- quests.location_id -> locations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quests_location_id
ON quests(location_id);

-- character_creation_metrics.character_id -> characters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_character_creation_metrics_character_id
ON character_creation_metrics(character_id);

-- combat_damage_log.source_participant_id -> combat_participants
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_combat_damage_log_source_participant_id
ON combat_damage_log(source_participant_id);

-- combat_participant_conditions.condition_id -> conditions_library
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_combat_participant_conditions_condition_id
ON combat_participant_conditions(condition_id);
