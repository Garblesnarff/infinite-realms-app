import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoiceStatusAlerts } from '../VoiceStatusAlerts';

import {
  activatePremiumFallback,
  reloadVoiceModeStatus,
  setStandardVoiceDownload,
} from '@/services/voice/voice-mode-store';

function renderAlerts(): ReturnType<typeof render> {
  return render(
    <VoiceStatusAlerts
      isProcessing={false}
      hasUserInteracted
      isPlaying={false}
      handleRetry={() => undefined}
    />,
  );
}

describe('VoiceStatusAlerts voice mode notices', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    reloadVoiceModeStatus();
  });

  it('tells the player once when premium quota runs out', () => {
    renderAlerts();
    act(() => {
      activatePremiumFallback('quota');
    });

    expect(
      screen.getByText(/Premium voice is used up for now — using Standard voice/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(/Premium voice is used up/)).not.toBeInTheDocument();

    // A second 429 in the same session does not re-announce.
    act(() => {
      activatePremiumFallback('quota');
    });
    expect(screen.queryByText(/Premium voice is used up/)).not.toBeInTheDocument();
  });

  it('words an outage differently from a quota', () => {
    renderAlerts();
    act(() => {
      activatePremiumFallback('unavailable');
    });

    expect(screen.getByText(/Premium voice is unavailable right now/)).toBeInTheDocument();
  });

  it('shows Standard voice download progress', () => {
    renderAlerts();
    act(() => {
      setStandardVoiceDownload({ state: 'loading', loaded: 45, total: 90 });
    });

    expect(screen.getByText(/Downloading Standard voice.*50%/)).toBeInTheDocument();
    expect(screen.getByLabelText('Standard voice download progress')).toBeInTheDocument();

    act(() => {
      setStandardVoiceDownload({ state: 'ready', loaded: 90, total: 90 });
    });
    expect(screen.queryByText(/Downloading Standard voice/)).not.toBeInTheDocument();
  });
});
