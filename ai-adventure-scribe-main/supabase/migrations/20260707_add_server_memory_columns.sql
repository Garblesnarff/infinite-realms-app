-- Align memory storage with the fields queried by server-bun.
-- This intentionally does not replace the existing flexible memory type values.

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS narrative_weight integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS story_arc text,
  ADD COLUMN IF NOT EXISTS prose_quality boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS chapter_marker boolean DEFAULT false;

ALTER TABLE public.memories
  DROP CONSTRAINT IF EXISTS memories_narrative_weight_check;

ALTER TABLE public.memories
  ADD CONSTRAINT memories_narrative_weight_check
  CHECK (narrative_weight BETWEEN 1 AND 10);
