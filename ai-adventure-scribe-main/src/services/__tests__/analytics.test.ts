/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { analytics } from '../analytics';

// Mock feature flags
vi.mock('@/config/featureFlags', () => ({
  featureFlags: {
    worldBuilder: false,
    campaignCharacterFlow: true,
    multiplayerInvites: false,
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Supabase
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn().mockReturnValue({
  insert: mockInsert,
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
  },
}));

describe('analytics service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-05-24T12:00:00Z'));

    // Mock window global objects
    (window as any).gtag = vi.fn();
    (window as any).posthog = {
      capture: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).gtag;
    delete (window as any).posthog;
  });

  describe('detectArtStyle', () => {
    it('should return unknown for no input', () => {
      expect(analytics.detectArtStyle()).toBe('unknown');
    });

    it('should prioritize characterTheme', () => {
      expect(analytics.detectArtStyle({
        characterTheme: 'grimdark',
        campaignGenre: 'high fantasy'
      })).toBe('grimdark');
    });

    it('should use campaignGenre if characterTheme is missing', () => {
      expect(analytics.detectArtStyle({
        campaignGenre: 'cyberpunk'
      })).toBe('cyberpunk');
    });

    it('should return unknown if both are empty/whitespace', () => {
      expect(analytics.detectArtStyle({
        characterTheme: '  ',
        campaignGenre: ''
      })).toBe('unknown');
    });

    it('should handle non-string inputs gracefully', () => {
      expect(analytics.detectArtStyle({
        characterTheme: 123 as any,
      })).toBe('123');
    });
  });

  describe('track', () => {
    it('should call gtag and posthog with correct data', () => {
      analytics.track('test_event', { foo: 'bar' });

      const expectedPayload = {
        timestamp: '2024-05-24T12:00:00.000Z',
        featureFlags: {
          worldBuilder: false,
          campaignCharacterFlow: true,
          multiplayerInvites: false,
        },
        foo: 'bar',
      };

      expect(window.gtag).toHaveBeenCalledWith('event', 'test_event', expectedPayload);
      expect((window as any).posthog.capture).toHaveBeenCalledWith('test_event', expectedPayload);
    });

    it('should handle missing gtag or posthog gracefully', () => {
      delete (window as any).gtag;
      delete (window as any).posthog;

      expect(() => analytics.track('test_event')).not.toThrow();
    });

    it('should handle non-function gtag or posthog gracefully', () => {
      (window as any).gtag = 'not a function';
      (window as any).posthog = { capture: 'not a function' };

      expect(() => analytics.track('test_event')).not.toThrow();
    });

    it('should handle throwing gtag or posthog gracefully', () => {
      (window as any).gtag = vi.fn().mockImplementation(() => {
        throw new Error('gtag fail');
      });
      (window as any).posthog = {
        capture: vi.fn().mockImplementation(() => {
          throw new Error('posthog fail');
        }),
      };

      expect(() => analytics.track('test_event')).not.toThrow();
      expect(window.gtag).toHaveBeenCalled();
      expect((window as any).posthog.capture).toHaveBeenCalled();
    });
  });

  describe('specialized tracking methods', () => {
    it('campaignTabViewed should track correctly', () => {
      const spy = vi.spyOn(analytics, 'track');
      analytics.campaignTabViewed('map', { campaignId: 'c1', artStyle: 'fantasy' });

      expect(spy).toHaveBeenCalledWith('campaign_hub_tab_viewed', {
        tab: 'map',
        campaignId: 'c1',
        art_style: 'fantasy',
      });
    });

    it('campaignTabViewed should use defaults', () => {
      const spy = vi.spyOn(analytics, 'track');
      analytics.campaignTabViewed('map');

      expect(spy).toHaveBeenCalledWith('campaign_hub_tab_viewed', {
        tab: 'map',
        campaignId: 'unknown',
        art_style: 'unknown',
      });
    });

    it('characterCreationStarted should track correctly', () => {
      const spy = vi.spyOn(analytics, 'track');
      analytics.characterCreationStarted({ campaignId: 'c1' });

      expect(spy).toHaveBeenCalledWith('campaign_character_creation_started', {
        campaignId: 'c1',
        art_style: 'unknown',
      });
    });

    it('characterCreationStarted should use defaults', () => {
      const spy = vi.spyOn(analytics, 'track');
      analytics.characterCreationStarted();

      expect(spy).toHaveBeenCalledWith('campaign_character_creation_started', {
        campaignId: 'unknown',
        art_style: 'unknown',
      });
    });

    it('characterCreationCompleted should track correctly', () => {
      const spy = vi.spyOn(analytics, 'track');
      analytics.characterCreationCompleted();

      expect(spy).toHaveBeenCalledWith('campaign_character_creation_completed', {
        campaignId: 'unknown',
        art_style: 'unknown',
      });
    });

    it('aiRegenerateClicked should use defaults', () => {
      const spy = vi.spyOn(analytics, 'track');
      analytics.aiRegenerateClicked('avatar');

      expect(spy).toHaveBeenCalledWith('ai_regenerate_clicked', {
        kind: 'avatar',
        campaignId: 'unknown',
        art_style: 'unknown',
      });
    });

    it('aiRegenerateClicked should track correctly', () => {
      const spy = vi.spyOn(analytics, 'track');
      analytics.aiRegenerateClicked('avatar', { campaignId: 'c1' });

      expect(spy).toHaveBeenCalledWith('ai_regenerate_clicked', {
        kind: 'avatar',
        campaignId: 'c1',
        art_style: 'unknown',
      });
    });
  });

  describe('trackCharacterCreationFlow', () => {
    it('should track to analytics and Supabase', async () => {
      const trackSpy = vi.spyOn(analytics, 'track');

      await analytics.trackCharacterCreationFlow('new', { campaignId: 'c1', userId: 'u1' });

      expect(trackSpy).toHaveBeenCalledWith('character_creation_flow', expect.objectContaining({
        flow: 'new',
        campaignId: 'c1',
      }));

      expect(mockFrom).toHaveBeenCalledWith('character_creation_metrics');
      expect(mockInsert).toHaveBeenCalledWith({
        flow: 'new',
        campaign_id: 'c1',
        user_id: 'u1',
      });
    });

    it('should handle Supabase errors gracefully', async () => {
      const { logger } = await import('@/lib/logger');
      mockInsert.mockRejectedValueOnce(new Error('DB Error'));

      await analytics.trackCharacterCreationFlow('legacy');

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to track character creation flow to database',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });
});
