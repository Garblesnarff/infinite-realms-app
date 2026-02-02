-- Blog Digest System Tables
-- Tracks commits for daily digest generation and baseline screenshots for before/after comparison

-- Track commits for daily digest
CREATE TABLE IF NOT EXISTS public.blog_digest_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commit_hash TEXT NOT NULL UNIQUE,
    commit_message TEXT NOT NULL,
    author TEXT,
    files_changed TEXT[],
    pr_number INTEGER,
    pr_title TEXT,
    committed_at TIMESTAMPTZ NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    digest_post_id UUID REFERENCES public.blog_posts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_digest_queue_processed
    ON public.blog_digest_queue(processed);

CREATE INDEX IF NOT EXISTS idx_blog_digest_queue_committed_at
    ON public.blog_digest_queue(committed_at DESC);

COMMENT ON TABLE public.blog_digest_queue IS 'Queued commits awaiting daily digest processing';

-- Store baseline screenshots for before/after comparison
CREATE TABLE IF NOT EXISTS public.blog_baseline_screenshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_key TEXT NOT NULL UNIQUE,  -- e.g., 'landing', 'character-sheet', 'combat-ui'
    page_url TEXT NOT NULL,
    screenshot_path TEXT NOT NULL,  -- Supabase storage path
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    commit_hash TEXT,  -- Which commit this baseline represents
    metadata JSONB DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.blog_baseline_screenshots IS 'Baseline screenshots for detecting UI changes between digests';

-- Track generated digest posts
CREATE TABLE IF NOT EXISTS public.blog_digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.blog_posts(id) ON DELETE SET NULL,
    digest_date DATE NOT NULL UNIQUE,  -- The date this digest covers
    commit_count INTEGER NOT NULL DEFAULT 0,
    commits_included UUID[],  -- References to blog_digest_queue.id
    hero_image_prompt TEXT,  -- The prompt used to generate the hero image
    hero_image_path TEXT,  -- Storage path for generated image
    screenshots_included JSONB DEFAULT '[]'::jsonb,  -- Array of screenshot paths used
    major_feature_detected BOOLEAN DEFAULT FALSE,
    standalone_post_id UUID REFERENCES public.blog_posts(id) ON DELETE SET NULL,  -- If major feature triggered separate post
    ai_analysis JSONB DEFAULT '{}'::jsonb,  -- Store AI's categorization and analysis
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_digests_date
    ON public.blog_digests(digest_date DESC);

COMMENT ON TABLE public.blog_digests IS 'Metadata for generated daily digest posts';

-- Function to get unprocessed commits for digest
CREATE OR REPLACE FUNCTION public.get_pending_digest_commits(
    p_since TIMESTAMPTZ DEFAULT NOW() - INTERVAL '24 hours'
)
RETURNS SETOF public.blog_digest_queue
LANGUAGE sql
STABLE
AS $$
    SELECT *
    FROM public.blog_digest_queue
    WHERE processed = FALSE
      AND committed_at >= p_since
    ORDER BY committed_at ASC;
$$;

-- Function to mark commits as processed
CREATE OR REPLACE FUNCTION public.mark_digest_commits_processed(
    p_commit_ids UUID[],
    p_digest_post_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.blog_digest_queue
    SET processed = TRUE,
        digest_post_id = p_digest_post_id
    WHERE id = ANY(p_commit_ids);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Enable RLS on new tables
ALTER TABLE public.blog_digest_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_baseline_screenshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_digests ENABLE ROW LEVEL SECURITY;

-- RLS policies - service role can do everything, public read for digests
CREATE POLICY "Service role manages digest queue" ON public.blog_digest_queue
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role manages baseline screenshots" ON public.blog_baseline_screenshots
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role manages digests" ON public.blog_digests
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Public can read digests (for analytics/display)
CREATE POLICY "Public can read digests" ON public.blog_digests
    FOR SELECT USING (TRUE);
