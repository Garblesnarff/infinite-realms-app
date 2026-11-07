/**
 * Landing "Voice" sample player (Table 12, Landing board).
 *
 * Plays one narration sample that was generated once with the app's own TTS and shipped as a
 * static file under public/. The control reads the real audio element's time and state; it does
 * not run a timer. Reduced motion stops the bar animation.
 */

import { Pause, Play } from 'lucide-react';
import React, { useRef, useState } from 'react';

type SampleState = 'idle' | 'playing' | 'paused' | 'ended' | 'error';

const BAR_COUNT = 36;
const BARS = Array.from(
  { length: BAR_COUNT },
  (_, i): number => 10 + Math.round(Math.abs(Math.sin(i * 1.3)) * 26) + ((i * 7) % 5),
);

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export const LandingVoiceSample: React.FC<{ src: string; transcript: string }> = ({
  src,
  transcript,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<SampleState>('idle');
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch((err: unknown) => {
        // A pause before the file loads rejects play() with AbortError; that is not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState('error');
      });
    } else {
      audio.pause();
    }
  };

  const playing = state === 'playing';
  const statusText =
    state === 'error'
      ? 'The voice sample could not be played.'
      : playing
        ? 'Playing…'
        : state === 'ended'
          ? 'Finished. Press Play to hear it again.'
          : 'Voice sample · press Play';

  return (
    <div className="rounded-2xl bg-[#0c1220] p-6 shadow-[0_0_0_1px_rgba(213,176,112,0.3),0_20px_44px_rgba(0,0,0,0.5)] sm:p-7">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause the voice sample' : 'Play the voice sample'}
          disabled={state === 'error'}
          className="flex h-16 w-16 flex-none items-center justify-center rounded-full border border-[#f3deb0] bg-gradient-to-b from-[#f6e3b8] via-[#d5b070] to-[#a9823f] text-[#1a1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_14px_rgba(0,0,0,0.45)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#f3deb0] disabled:opacity-50"
        >
          {playing ? (
            <Pause className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Play className="h-6 w-6" aria-hidden="true" />
          )}
        </button>
        <div
          className={`flex h-11 flex-1 items-end gap-[3px] ${playing ? 'motion-safe:[&>span]:animate-pulse' : ''}`}
          aria-hidden="true"
        >
          {BARS.map((h, i) => (
            <span key={i} className="flex-1 rounded-sm bg-[#4fb6c4]" style={{ height: `${h}px` }} />
          ))}
        </div>
        <div className="w-24 flex-none text-right text-[15px] text-[#aab3cc] tabular-nums">
          {formatTime(current)} / {formatTime(duration)}
        </div>
      </div>
      <p
        className="mt-4 text-xl italic leading-relaxed text-[#eaeefa]"
        style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
      >
        “{transcript}”
      </p>
      <div className="mt-2 text-sm text-[#aab3cc]" role="status">
        {statusText}
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setState('playing')}
        onPause={() => setState((s) => (s === 'ended' ? s : 'paused'))}
        onEnded={() => setState('ended')}
        onError={() => setState('error')}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
};

export default LandingVoiceSample;
