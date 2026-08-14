import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

vi.mock('@/lib/logger', () => ({
  default: { warn: mocks.warn },
}));

import {
  createMalformedPeerFrameReportState,
  MALFORMED_PEER_FRAME_REPORT_INTERVAL_MS,
  reportMalformedPeerFrame,
} from '../websocket-observability';

describe('reportMalformedPeerFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns and reports the first malformed frame with its count', () => {
    const state = createMalformedPeerFrameReportState();

    reportMalformedPeerFrame(
      state,
      { channel: 'session-story', sessionId: 'session-1', error: new Error('bad JSON') },
      1_000,
    );

    expect(mocks.warn).toHaveBeenCalledWith('[WebSocket] Ignoring malformed peer frame', {
      channel: 'session-story',
      count: 1,
      error: 'bad JSON',
    });
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'malformed_ws_frame',
      'session-1',
      'channel=session-story; count=1; bad JSON',
    );
  });

  it('batches frames inside the interval and reports the accumulated count later', () => {
    const state = createMalformedPeerFrameReportState();

    reportMalformedPeerFrame(state, { channel: 'scene', error: 'first' }, 1_000);
    reportMalformedPeerFrame(state, { channel: 'scene', error: 'second' }, 1_001);
    reportMalformedPeerFrame(state, { channel: 'scene', error: 'third' }, 1_002);

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);

    reportMalformedPeerFrame(
      state,
      { channel: 'scene', error: 'after interval' },
      1_000 + MALFORMED_PEER_FRAME_REPORT_INTERVAL_MS,
    );

    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenLastCalledWith('[WebSocket] Ignoring malformed peer frame', {
      channel: 'scene',
      count: 3,
      error: 'after interval',
    });
    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(2);
    expect(mocks.reportClientFailure).toHaveBeenLastCalledWith(
      'malformed_ws_frame',
      undefined,
      'channel=scene; count=3; after interval',
    );
  });
});
