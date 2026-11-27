/**
 * Hook for fetching starter campaigns
 *
 * Provides access to published, complete starter campaigns for the launch page
 * and campaign detail views.
 */

import { useCallback, useEffect, useState, useMemo } from 'react';

import { supabase } from '@/integrations/supabase/client';

export interface StarterCampaign {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  genre: string[];
  tone: string[];
  difficulty: string;
  levelRange: string | null;
  estimatedSessions: string | null;
  premise: string;
  creativeBrief: string | null;
  overview: string | null;
  isComplete: boolean;
  isPublished: boolean;
  isFeatured: boolean;
  coverImageUrl: string | null;
  bannerImageUrl: string | null;
}

interface UseStarterCampaignsResult {
  campaigns: StarterCampaign[];
  featuredCampaigns: StarterCampaign[];
  isLoading: boolean;
  error: Error | null;
  /** Runs the load again, for a Retry button after an error. */
  retry: () => void;
}

interface UseStarterCampaignResult {
  campaign: StarterCampaign | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Map database row to StarterCampaign interface
 */
function mapCampaignRow(row: Record<string, unknown>): StarterCampaign {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    tagline: row.tagline as string | null,
    genre: (row.genre as string[]) || [],
    tone: (row.tone as string[]) || [],
    difficulty: row.difficulty as string,
    levelRange: row.level_range as string | null,
    estimatedSessions: row.estimated_sessions as string | null,
    premise: row.premise as string,
    creativeBrief: row.creative_brief as string | null,
    overview: row.overview as string | null,
    isComplete: row.is_complete as boolean,
    isPublished: row.is_published as boolean,
    isFeatured: row.is_featured as boolean,
    coverImageUrl: row.cover_image_url as string | null,
    bannerImageUrl: row.banner_image_url as string | null,
  };
}

/** Each attempt gives up after this long, so a stalled connection cannot hang the list (#1776). */
export const STARTER_CAMPAIGNS_ATTEMPT_MS = 4_000;
/** Two attempts: the worst case ends in an error after about 8 s. */
export const STARTER_CAMPAIGNS_ATTEMPTS = 2;

/** One bounded request for the published starter campaigns. Throws on timeout or error. */
async function requestStarterCampaignRows(timeoutMs: number): Promise<Record<string, unknown>[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { data, error: queryError } = await supabase
      .from('starter_campaigns')
      .select(
        'id, slug, title, tagline, genre, tone, difficulty, level_range, estimated_sessions, premise, is_complete, is_published, is_featured, cover_image_url, banner_image_url',
      )
      .eq('is_published', true)
      .eq('is_complete', true)
      .order('title')
      .abortSignal(controller.signal);
    if (queryError) {
      throw new Error(queryError.message);
    }
    return (data || []) as Record<string, unknown>[];
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('The campaign list took too long to load');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch all published starter campaigns. Each attempt is bounded, and a failed load is
 * retried once; after that `error` is set and `retry` runs the load again (#1776).
 */
export function useStarterCampaigns(): UseStarterCampaignsResult {
  const [campaigns, setCampaigns] = useState<StarterCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    async function loadCampaigns(): Promise<void> {
      let lastError: Error = new Error('Failed to fetch campaigns');
      for (let i = 0; i < STARTER_CAMPAIGNS_ATTEMPTS; i++) {
        try {
          const rows = await requestStarterCampaignRows(STARTER_CAMPAIGNS_ATTEMPT_MS);
          if (live) {
            setCampaigns(rows.map(mapCampaignRow));
            setError(null);
            setIsLoading(false);
          }
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Failed to fetch campaigns');
        }
      }
      if (live) {
        setError(lastError);
        setIsLoading(false);
      }
    }

    setIsLoading(true);
    setError(null);
    void loadCampaigns();
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const featuredCampaigns = useMemo(() => campaigns.filter((c) => c.isFeatured), [campaigns]);

  return useMemo(
    () => ({ campaigns, featuredCampaigns, isLoading, error, retry }),
    [campaigns, featuredCampaigns, isLoading, error, retry],
  );
}

/**
 * Fetch a single starter campaign by slug
 */
export function useStarterCampaign(slug: string | undefined): UseStarterCampaignResult {
  const [campaign, setCampaign] = useState<StarterCampaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!slug) {
      setIsLoading(false);
      return;
    }
    const slugValue = slug;

    async function fetchCampaign(): Promise<void> {
      try {
        const { data, error: queryError } = await supabase
          .from('starter_campaigns')
          .select(
            'id, slug, title, tagline, genre, tone, difficulty, level_range, estimated_sessions, premise, creative_brief, overview, is_complete, is_published, is_featured, cover_image_url, banner_image_url',
          )
          .eq('slug', slugValue)
          .eq('is_published', true)
          .eq('is_complete', true)
          .single();

        if (queryError) {
          if (queryError.code === 'PGRST116') {
            // Not found
            setCampaign(null);
          } else {
            throw new Error(queryError.message);
          }
        } else {
          setCampaign(mapCampaignRow(data));
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch campaign'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchCampaign();
  }, [slug]);

  return useMemo(() => ({ campaign, isLoading, error }), [campaign, isLoading, error]);
}
