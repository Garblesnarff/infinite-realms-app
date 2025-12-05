-- Lore Keeper Tables Migration
-- Date: 2025-12-05
-- Creates the canonical campaign lore system for starter campaigns
-- These are READ-ONLY templates that Franz (AI DM) queries via RAG

BEGIN;

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE campaign_difficulty AS ENUM (
    'easy',
    'low-medium',
    'medium',
    'medium-hard',
    'hard',
    'deadly'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE chunk_type AS ENUM (
    'creative_brief',
    'world_building',
    'faction',
    'npc_tier1',
    'npc_tier2',
    'npc_tier3',
    'location',
    'quest_main',
    'quest_side',
    'mechanic',
    'item',
    'encounter',
    'session_outline'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE rule_type AS ENUM ('causality', 'mechanic', 'world_law');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE playstyle AS ENUM (
    'roleplay-heavy',
    'combat-focused',
    'balanced',
    'exploration',
    'puzzle-solving'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- STARTER CAMPAIGNS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS starter_campaigns (
  -- Identity - matches directory name from repo (e.g., "a_midsummer_nights_chaos")
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  tagline TEXT, -- Short hook for cards

  -- Classification
  genre TEXT[] NOT NULL, -- ["fae", "comedy", "romance"]
  sub_genre TEXT[], -- ["shakespearean", "farce"]
  tone TEXT[] NOT NULL, -- ["fae mischief", "love gone wrong"]
  difficulty campaign_difficulty NOT NULL,
  level_range TEXT, -- "1-8"
  estimated_sessions TEXT, -- "8-10"

  -- Content (full text for display, NOT for RAG)
  premise TEXT NOT NULL, -- 2-3 sentence hook
  creative_brief TEXT, -- Full art/voice/music direction
  overview TEXT, -- Full campaign summary

  -- Status & Release
  is_complete BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  release_date TIMESTAMPTZ,
  release_event TEXT, -- "Launch", "Halloween 2025", etc.

  -- Versioning
  current_version INTEGER NOT NULL DEFAULT 1,

  -- Assets (pre-generated)
  cover_image_url TEXT,
  banner_image_url TEXT,
  gallery_images JSONB, -- [{url, caption, location}]

  -- Stats (future use)
  play_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for starter_campaigns
CREATE INDEX IF NOT EXISTS idx_starter_campaigns_slug ON starter_campaigns(slug);
CREATE INDEX IF NOT EXISTS idx_starter_campaigns_genre ON starter_campaigns USING GIN(genre);
CREATE INDEX IF NOT EXISTS idx_starter_campaigns_difficulty ON starter_campaigns(difficulty);
CREATE INDEX IF NOT EXISTS idx_starter_campaigns_published ON starter_campaigns(is_published, is_complete);
CREATE INDEX IF NOT EXISTS idx_starter_campaigns_featured ON starter_campaigns(is_featured) WHERE is_featured = true;

COMMENT ON TABLE starter_campaigns IS 'Canonical campaign templates - READ-ONLY, queried by Franz via Lore Keeper MCP';
COMMENT ON COLUMN starter_campaigns.id IS 'Matches directory name from campaign-ideas repo';
COMMENT ON COLUMN starter_campaigns.current_version IS 'Incremented when lore is updated - sessions lock to version at start';

-- =============================================================================
-- CAMPAIGN CHUNKS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS campaign_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL REFERENCES starter_campaigns(id) ON DELETE CASCADE,

  -- Classification
  chunk_type chunk_type NOT NULL,
  entity_name TEXT, -- "Puck", "Titania's Bower"
  parent_entity TEXT, -- "Court of Stolen Breath" for faction members

  -- Content
  content TEXT NOT NULL,
  summary TEXT, -- One-line summary for quick display

  -- Vector embedding for semantic search (1536 dimensions for text-embedding-3-small)
  embedding vector(1536),

  -- Metadata
  metadata JSONB DEFAULT '{}', -- tier, zone, quest_type, etc.
  source_file TEXT, -- "campaign_bible.md"
  source_section TEXT, -- "## NPCs > Tier 1"

  -- Ordering (for session outlines, quest beats)
  sequence_order INTEGER,

  -- Versioning - matches campaign version when created
  version INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for campaign_chunks
CREATE INDEX IF NOT EXISTS idx_campaign_chunks_campaign_id ON campaign_chunks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_chunks_type ON campaign_chunks(campaign_id, chunk_type);
CREATE INDEX IF NOT EXISTS idx_campaign_chunks_entity ON campaign_chunks(campaign_id, entity_name);
CREATE INDEX IF NOT EXISTS idx_campaign_chunks_sequence ON campaign_chunks(campaign_id, chunk_type, sequence_order)
  WHERE sequence_order IS NOT NULL;

-- IVFFlat index for vector similarity search
-- Using 100 lists is good for up to ~100k chunks
CREATE INDEX IF NOT EXISTS idx_campaign_chunks_embedding ON campaign_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON TABLE campaign_chunks IS 'Chunked lore for RAG retrieval - atomic, queryable pieces';
COMMENT ON COLUMN campaign_chunks.embedding IS 'OpenAI text-embedding-3-small vector (1536 dimensions)';
COMMENT ON COLUMN campaign_chunks.entity_name IS 'Primary entity this chunk describes (for direct lookups)';
COMMENT ON COLUMN campaign_chunks.parent_entity IS 'Parent entity for hierarchical relationships (e.g., NPC belonging to faction)';

-- =============================================================================
-- CAMPAIGN RULES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS campaign_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL REFERENCES starter_campaigns(id) ON DELETE CASCADE,

  -- Classification
  rule_type rule_type NOT NULL,

  -- The rule itself
  condition TEXT NOT NULL, -- "Oberon and Titania remain at war"
  effect TEXT NOT NULL, -- "seasons fail and nature suffers"

  -- Metadata
  reversible BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for campaign_rules
CREATE INDEX IF NOT EXISTS idx_campaign_rules_campaign_id ON campaign_rules(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_rules_type ON campaign_rules(campaign_id, rule_type);
CREATE INDEX IF NOT EXISTS idx_campaign_rules_priority ON campaign_rules(campaign_id, priority DESC);

COMMENT ON TABLE campaign_rules IS 'Causality/IF-THEN rules - governs world consequences';
COMMENT ON COLUMN campaign_rules.condition IS 'The IF part of the rule';
COMMENT ON COLUMN campaign_rules.effect IS 'The THEN part of the rule';
COMMENT ON COLUMN campaign_rules.priority IS 'Higher priority rules take precedence (1-10)';

-- =============================================================================
-- CAMPAIGN PARTIES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS campaign_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL REFERENCES starter_campaigns(id) ON DELETE CASCADE,

  -- Identity
  party_name TEXT NOT NULL, -- "The Star-Crossed Nobles"
  party_concept TEXT NOT NULL, -- 2-3 sentences on who they are
  party_hook TEXT NOT NULL, -- Why they're entering this story

  -- Classification
  playstyle playstyle NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false, -- Show this one first

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for campaign_parties
CREATE INDEX IF NOT EXISTS idx_campaign_parties_campaign_id ON campaign_parties(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_parties_default ON campaign_parties(campaign_id, is_default)
  WHERE is_default = true;

COMMENT ON TABLE campaign_parties IS 'Pre-built party options for starter campaigns';
COMMENT ON COLUMN campaign_parties.is_default IS 'If true, this party is shown first in selection UI';

-- =============================================================================
-- PARTY CHARACTERS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS party_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES campaign_parties(id) ON DELETE CASCADE,

  -- Identity
  character_name TEXT NOT NULL,
  race TEXT NOT NULL,
  class TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 20),

  -- Narrative
  backstory TEXT NOT NULL, -- 2-3 sentences
  personality TEXT NOT NULL, -- Traits, flaws, bonds
  campaign_hook TEXT NOT NULL, -- Personal stake in THIS story
  party_relationship TEXT, -- Connection to other party members

  -- Stats - Universal/abstract format for multi-ruleset support
  -- Translation to specific rulesets happens at runtime
  stats JSONB NOT NULL,
  /*
    Example stats format:
    {
      "attributes": {
        "strength": 16,
        "dexterity": 14,
        "constitution": 15,
        "intelligence": 10,
        "wisdom": 12,
        "charisma": 8
      },
      "archetype": "warrior-tank",
      "combat_style": "melee-defensive",
      "special_abilities": ["shield_bash", "taunt"],
      "proficiencies": ["heavy_armor", "shields", "martial_weapons"]
    }
  */

  -- Art (for future image generation)
  portrait_prompt TEXT,
  portrait_url TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for party_characters
CREATE INDEX IF NOT EXISTS idx_party_characters_party_id ON party_characters(party_id);
CREATE INDEX IF NOT EXISTS idx_party_characters_name ON party_characters(character_name);

COMMENT ON TABLE party_characters IS 'Pre-built characters for starter campaign parties';
COMMENT ON COLUMN party_characters.stats IS 'Universal stats format - translated to specific ruleset at runtime';

-- =============================================================================
-- RPC FUNCTIONS
-- =============================================================================

-- Semantic search for campaign lore
CREATE OR REPLACE FUNCTION search_campaign_lore(
  p_campaign_id TEXT,
  p_query_embedding vector(1536),
  p_chunk_types chunk_type[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 5,
  p_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  campaign_id TEXT,
  chunk_type chunk_type,
  entity_name TEXT,
  parent_entity TEXT,
  content TEXT,
  summary TEXT,
  metadata JSONB,
  source_file TEXT,
  source_section TEXT,
  sequence_order INTEGER,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.campaign_id,
    c.chunk_type,
    c.entity_name,
    c.parent_entity,
    c.content,
    c.summary,
    c.metadata,
    c.source_file,
    c.source_section,
    c.sequence_order,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM campaign_chunks c
  WHERE c.campaign_id = p_campaign_id
    AND c.embedding IS NOT NULL
    AND (p_chunk_types IS NULL OR c.chunk_type = ANY(p_chunk_types))
    AND 1 - (c.embedding <=> p_query_embedding) > p_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_campaign_lore IS 'Semantic search for campaign lore using vector similarity';

-- Direct entity lookup (faster than embedding search when name is known)
CREATE OR REPLACE FUNCTION get_campaign_entity(
  p_campaign_id TEXT,
  p_entity_name TEXT,
  p_chunk_type chunk_type DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  campaign_id TEXT,
  chunk_type chunk_type,
  entity_name TEXT,
  parent_entity TEXT,
  content TEXT,
  summary TEXT,
  metadata JSONB,
  source_file TEXT,
  source_section TEXT,
  sequence_order INTEGER
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.campaign_id,
    c.chunk_type,
    c.entity_name,
    c.parent_entity,
    c.content,
    c.summary,
    c.metadata,
    c.source_file,
    c.source_section,
    c.sequence_order
  FROM campaign_chunks c
  WHERE c.campaign_id = p_campaign_id
    AND LOWER(c.entity_name) = LOWER(p_entity_name)
    AND (p_chunk_type IS NULL OR c.chunk_type = p_chunk_type)
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_campaign_entity IS 'Direct entity lookup by name (case-insensitive)';

-- Get all chunks of a specific type for a campaign
CREATE OR REPLACE FUNCTION get_campaign_chunks_by_type(
  p_campaign_id TEXT,
  p_chunk_type chunk_type
)
RETURNS TABLE (
  id UUID,
  campaign_id TEXT,
  chunk_type chunk_type,
  entity_name TEXT,
  parent_entity TEXT,
  content TEXT,
  summary TEXT,
  metadata JSONB,
  sequence_order INTEGER
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.campaign_id,
    c.chunk_type,
    c.entity_name,
    c.parent_entity,
    c.content,
    c.summary,
    c.metadata,
    c.sequence_order
  FROM campaign_chunks c
  WHERE c.campaign_id = p_campaign_id
    AND c.chunk_type = p_chunk_type
  ORDER BY c.sequence_order NULLS LAST, c.entity_name;
$$;

COMMENT ON FUNCTION get_campaign_chunks_by_type IS 'Get all chunks of a specific type for a campaign';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE starter_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_characters ENABLE ROW LEVEL SECURITY;

-- Starter campaigns: Published campaigns are readable by everyone
DROP POLICY IF EXISTS "Published starter campaigns are public" ON starter_campaigns;
CREATE POLICY "Published starter campaigns are public"
  ON starter_campaigns
  FOR SELECT
  USING (
    is_published = true
    AND is_complete = true
  );

-- Service role can do everything (for ingestion)
DROP POLICY IF EXISTS "Service role full access to starter campaigns" ON starter_campaigns;
CREATE POLICY "Service role full access to starter campaigns"
  ON starter_campaigns
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Campaign chunks: Readable if parent campaign is published
DROP POLICY IF EXISTS "Chunks readable if campaign published" ON campaign_chunks;
CREATE POLICY "Chunks readable if campaign published"
  ON campaign_chunks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM starter_campaigns sc
      WHERE sc.id = campaign_chunks.campaign_id
        AND sc.is_published = true
        AND sc.is_complete = true
    )
  );

DROP POLICY IF EXISTS "Service role full access to campaign chunks" ON campaign_chunks;
CREATE POLICY "Service role full access to campaign chunks"
  ON campaign_chunks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Campaign rules: Readable if parent campaign is published
DROP POLICY IF EXISTS "Rules readable if campaign published" ON campaign_rules;
CREATE POLICY "Rules readable if campaign published"
  ON campaign_rules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM starter_campaigns sc
      WHERE sc.id = campaign_rules.campaign_id
        AND sc.is_published = true
        AND sc.is_complete = true
    )
  );

DROP POLICY IF EXISTS "Service role full access to campaign rules" ON campaign_rules;
CREATE POLICY "Service role full access to campaign rules"
  ON campaign_rules
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Campaign parties: Readable if parent campaign is published
DROP POLICY IF EXISTS "Parties readable if campaign published" ON campaign_parties;
CREATE POLICY "Parties readable if campaign published"
  ON campaign_parties
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM starter_campaigns sc
      WHERE sc.id = campaign_parties.campaign_id
        AND sc.is_published = true
        AND sc.is_complete = true
    )
  );

DROP POLICY IF EXISTS "Service role full access to campaign parties" ON campaign_parties;
CREATE POLICY "Service role full access to campaign parties"
  ON campaign_parties
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Party characters: Readable if parent party's campaign is published
DROP POLICY IF EXISTS "Characters readable if campaign published" ON party_characters;
CREATE POLICY "Characters readable if campaign published"
  ON party_characters
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaign_parties cp
      JOIN starter_campaigns sc ON sc.id = cp.campaign_id
      WHERE cp.id = party_characters.party_id
        AND sc.is_published = true
        AND sc.is_complete = true
    )
  );

DROP POLICY IF EXISTS "Service role full access to party characters" ON party_characters;
CREATE POLICY "Service role full access to party characters"
  ON party_characters
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =============================================================================
-- EXTEND GAME SESSIONS FOR STARTER CAMPAIGNS
-- =============================================================================

-- Add fields to track starter campaign usage in sessions
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS starter_campaign_id TEXT REFERENCES starter_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_version INTEGER,
  ADD COLUMN IF NOT EXISTS ruleset TEXT DEFAULT '5e';

CREATE INDEX IF NOT EXISTS idx_game_sessions_starter_campaign
  ON game_sessions(starter_campaign_id)
  WHERE starter_campaign_id IS NOT NULL;

COMMENT ON COLUMN game_sessions.starter_campaign_id IS 'Reference to starter campaign if this is a starter playthrough';
COMMENT ON COLUMN game_sessions.campaign_version IS 'Locked version of campaign lore at session start';
COMMENT ON COLUMN game_sessions.ruleset IS 'Game system used for this session (5e, OSE, Pathfinder, etc.)';

COMMIT;
