/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { processTableEvent } from '../event-processor';

import type { TableSubscription } from '../types';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('event-processor', () => {
  let mockSubscription: TableSubscription;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscription = {
      channel: null,
      recordCallbacks: new Map(),
      eventCallbacks: new Map(),
      retryCount: 0,
      isConnected: true,
      isConnecting: false,
      lastRetry: 0,
      connectionTimeoutId: null,
      cleanupTimeoutId: null,
      disabled: false,
    };
  });

  describe('processTableEvent - Record Callbacks', () => {
    it('should trigger callback when image field changes', () => {
      const callback = vi.fn();
      mockSubscription.recordCallbacks.set('test-sub', {
        id: 'sub-1',
        recordId: '123',
        imageField: 'avatar_url',
        callback,
      });

      const payload: any = {
        new: { id: '123', avatar_url: 'http://new-image.jpg' },
        old: { id: '123', avatar_url: 'http://old-image.jpg' },
      };

      processTableEvent('characters', payload, mockSubscription);

      expect(callback).toHaveBeenCalledWith('http://new-image.jpg');
    });

    it('should not trigger callback when image field is same', () => {
      const callback = vi.fn();
      mockSubscription.recordCallbacks.set('test-sub', {
        id: 'sub-1',
        recordId: '123',
        imageField: 'avatar_url',
        callback,
      });

      const payload: any = {
        new: { id: '123', avatar_url: 'http://same-image.jpg' },
        old: { id: '123', avatar_url: 'http://same-image.jpg' },
      };

      processTableEvent('characters', payload, mockSubscription);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should trigger callback when new image is null', () => {
      const callback = vi.fn();
      mockSubscription.recordCallbacks.set('test-sub', {
        id: 'sub-1',
        recordId: '123',
        imageField: 'avatar_url',
        callback,
      });

      const payload: any = {
        new: { id: '123', avatar_url: null },
        old: { id: '123', avatar_url: 'http://old-image.jpg' },
      };

      processTableEvent('characters', payload, mockSubscription);

      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should handle numeric record IDs', () => {
        const callback = vi.fn();
        mockSubscription.recordCallbacks.set('test-sub', {
          id: 'sub-1',
          recordId: '123',
          imageField: 'avatar_url',
          callback,
        });

        const payload: any = {
          new: { id: 123, avatar_url: 'http://new-image.jpg' },
          old: { id: 123, avatar_url: 'http://old-image.jpg' },
        };

        processTableEvent('characters', payload, mockSubscription);

        expect(callback).toHaveBeenCalledWith('http://new-image.jpg');
      });

    it('should not trigger callback for different record ID', () => {
      const callback = vi.fn();
      mockSubscription.recordCallbacks.set('test-sub', {
        id: 'sub-1',
        recordId: '123',
        imageField: 'avatar_url',
        callback,
      });

      const payload: any = {
        new: { id: '456', avatar_url: 'http://new-image.jpg' },
        old: { id: '456', avatar_url: 'http://old-image.jpg' },
      };

      processTableEvent('characters', payload, mockSubscription);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should use ID from oldPayload if missing in newPayload', () => {
        const callback = vi.fn();
        mockSubscription.recordCallbacks.set('test-sub', {
          id: 'sub-1',
          recordId: '123',
          imageField: 'avatar_url',
          callback,
        });

        const payload: any = {
          new: { avatar_url: 'http://new-image.jpg' }, // missing id
          old: { id: '123', avatar_url: 'http://old-image.jpg' },
        };

        processTableEvent('characters', payload, mockSubscription);
        expect(callback).toHaveBeenCalledWith('http://new-image.jpg');
    });

    it('should handle null payloads', () => {
        const callback = vi.fn();
        mockSubscription.recordCallbacks.set('test-sub', {
          id: 'sub-1',
          recordId: '123',
          imageField: 'avatar_url',
          callback,
        });

        // DELETE event often has null new payload
        const payload: any = {
          new: null,
          old: { id: '123', avatar_url: 'http://old-image.jpg' },
        };

        processTableEvent('characters', payload, mockSubscription);
        expect(callback).toHaveBeenCalledWith(null);
    });

    it('should ignore if record ID is missing in both payloads', () => {
        const callback = vi.fn();
        mockSubscription.recordCallbacks.set('test-sub', {
          id: 'sub-1',
          recordId: '123',
          imageField: 'avatar_url',
          callback,
        });

        const payload: any = {
          new: { avatar_url: 'http://new-image.jpg' },
          old: { avatar_url: 'http://old-image.jpg' },
        };

        processTableEvent('characters', payload, mockSubscription);
        expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('processTableEvent - Event Callbacks', () => {
    it('should trigger event callback for matching event types', () => {
      const callback = vi.fn();
      mockSubscription.eventCallbacks.set('test-event-sub', {
        id: 'event-sub-1',
        events: ['INSERT', 'UPDATE'],
        callback,
      });

      const payload: any = {
        eventType: 'INSERT',
        new: { id: '456', name: 'New Character' },
      };

      processTableEvent('characters', payload, mockSubscription);

      expect(callback).toHaveBeenCalledWith(payload);
    });

    it('should not trigger event callback for non-matching event types', () => {
      const callback = vi.fn();
      mockSubscription.eventCallbacks.set('test-event-sub', {
        id: 'event-sub-1',
        events: ['INSERT'],
        callback,
      });

      const payload: any = {
        eventType: 'UPDATE',
        new: { id: '456', name: 'Updated Character' },
      };

      processTableEvent('characters', payload, mockSubscription);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should respect filter in event callback', () => {
      const callback = vi.fn();
      const filter = (p: any) => p.new.name === 'Target';

      mockSubscription.eventCallbacks.set('test-event-sub', {
        id: 'event-sub-1',
        events: ['INSERT'],
        filter,
        callback,
      });

      // Doesn't match filter
      processTableEvent('characters', {
        eventType: 'INSERT',
        new: { id: '1', name: 'Other' },
      } as any, mockSubscription);
      expect(callback).not.toHaveBeenCalled();

      // Matches filter
      const matchingPayload = {
        eventType: 'INSERT',
        new: { id: '2', name: 'Target' },
      };
      processTableEvent('characters', matchingPayload as any, mockSubscription);
      expect(callback).toHaveBeenCalledWith(matchingPayload);
    });

    it('should handle errors in callbacks gracefully', () => {
        const callback = vi.fn(() => { throw new Error('Callback failed'); });
        mockSubscription.eventCallbacks.set('test-event-sub', {
          id: 'event-sub-1',
          events: ['INSERT'],
          callback,
        });

        const payload: any = {
          eventType: 'INSERT',
          new: { id: '456' },
        };

        // Should not throw
        expect(() => processTableEvent('characters', payload, mockSubscription)).not.toThrow();
    });

    it('should ignore events with missing eventType', () => {
        const callback = vi.fn();
        mockSubscription.eventCallbacks.set('test-event-sub', {
          id: 'event-sub-1',
          events: ['INSERT'],
          callback,
        });

        const payload: any = {
          new: { id: '456' },
        };

        processTableEvent('characters', payload, mockSubscription);
        expect(callback).not.toHaveBeenCalled();
    });
  });
});
