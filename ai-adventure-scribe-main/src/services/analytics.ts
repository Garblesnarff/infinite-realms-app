import { featureFlags } from '@/config/featureFlags';
import { logger } from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';

// Minimal type for analytics payloads
export type AnalyticsPayload = Record<string, unknown>;

// Third-party analytics globals, neither of which is guaranteed to be loaded
interface AnalyticsGlobal {
  gtag?: (...args: unknown[]) => void;
  posthog?: { capture: (...args: unknown[]) => void };
}

// Utility to safely access window-bound analytics without failing in SSR/tests
function getGlobal(): AnalyticsGlobal {
  return typeof window !== 'undefined' ? (window as unknown as AnalyticsGlobal) : {};
}

function basePayload(extra?: AnalyticsPayload): AnalyticsPayload {
  const flags = { ...featureFlags };
  return {
    timestamp: new Date().toISOString(),
    featureFlags: flags,
    ...extra,
  };
}

function detectArtStyle(input?: {
  characterTheme?: string | null | undefined;
  campaignGenre?: string | null | undefined;
}): string {
  if (!input) return 'unknown';
  if (input.characterTheme && String(input.characterTheme).trim())
    return String(input.characterTheme);
  if (input.campaignGenre && String(input.campaignGenre).trim()) return String(input.campaignGenre);
  return 'unknown';
}

export const analytics = {
  track(event: string, payload?: AnalyticsPayload): void {
    const data = basePayload(payload);
    const g = getGlobal();

    try {
      if (g.gtag && typeof g.gtag === 'function') {
        g.gtag('event', event, data);
      }
    } catch {
      // Ignore gtag errors
    }

    try {
      if (g.posthog && typeof g.posthog.capture === 'function') {
        g.posthog.capture(event, data);
      }
    } catch {
      // Ignore posthog errors
    }
  },

  campaignTabViewed(tab: string, info: { campaignId?: string; artStyle?: string } = {}): void {
    this.track('campaign_hub_tab_viewed', {
      tab,
      campaignId: info.campaignId || 'unknown',
      art_style: info.artStyle || 'unknown',
    });
  },

  characterCreationStarted(info: { campaignId?: string; artStyle?: string } = {}): void {
    this.track('campaign_character_creation_started', {
      campaignId: info.campaignId || 'unknown',
      art_style: info.artStyle || 'unknown',
    });
  },

  characterCreationCompleted(info: { campaignId?: string; artStyle?: string } = {}): void {
    this.track('campaign_character_creation_completed', {
      campaignId: info.campaignId || 'unknown',
      art_style: info.artStyle || 'unknown',
    });
  },

  aiRegenerateClicked(
    kind: 'description' | 'avatar' | 'design_sheet',
    info: { campaignId?: string; artStyle?: string } = {},
  ): void {
    this.track('ai_regenerate_clicked', {
      kind,
      campaignId: info.campaignId || 'unknown',
      art_style: info.artStyle || 'unknown',
    });
  },

  /**
   * Track which character creation flow is being used
   * @param flow - 'legacy' for direct character creation, 'new' for campaign-based flow
   * @param info - Additional context (campaignId, userId)
   */
  async trackCharacterCreationFlow(
    flow: 'legacy' | 'new',
    info: { campaignId?: string; userId?: string } = {},
  ): Promise<void> {
    // Track to analytics providers
    this.track('character_creation_flow', {
      flow,
      campaignId: info.campaignId || 'none',
      timestamp: new Date().toISOString(),
    });

    // Track to the authenticated server route for metrics.
    try {
      await issue1784Api.recordCharacterCreationFlow({
        flow,
        campaign_id: info.campaignId || null,
      });
    } catch (error) {
      // Silently fail - analytics should not break the app
      logger.warn('Failed to track character creation flow to database', { error });
    }
  },

  detectArtStyle,
};
