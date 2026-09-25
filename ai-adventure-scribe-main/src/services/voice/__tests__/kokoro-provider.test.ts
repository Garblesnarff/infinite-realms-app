import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEVICE_CHECK_SENTENCE,
  KokoroProvider,
  KokoroWorkerClient,
  resetKokoroForTesting,
  resolveStandardEngine,
} from '../kokoro-provider';
import { getVoiceModeStatus, reloadVoiceModeStatus } from '../voice-mode-store';

import type { KokoroWorkerMessage, KokoroWorkerResponse } from '@/workers/kokoro-worker';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * Stands in for src/workers/kokoro-worker.ts. `secondsPerAudioSecond` sets the
 * simulated real-time factor by advancing performance.now().
 */
class FakeKokoroWorker {
  onmessage: ((event: MessageEvent<KokoroWorkerResponse>) => void) | null = null;
  messages: KokoroWorkerMessage[] = [];
  inFlight = 0;
  maxInFlight = 0;
  now = 0;

  constructor(
    private readonly secondsPerAudioSecond: number,
    private readonly failLoad = false,
  ) {}

  postMessage(message: KokoroWorkerMessage): void {
    this.messages.push(message);
    queueMicrotask(() => this.respond(message));
  }

  terminate(): void {}

  private emit(response: KokoroWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<KokoroWorkerResponse>);
  }

  private respond(message: KokoroWorkerMessage): void {
    if (message.type === 'LOAD') {
      if (this.failLoad) {
        this.emit({ type: 'LOAD_ERROR', error: 'offline' });
        return;
      }
      this.emit({ type: 'PROGRESS', loaded: 45, total: 90 });
      this.emit({ type: 'READY', device: 'wasm' });
      return;
    }
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const durationSec = 2;
    this.now += durationSec * this.secondsPerAudioSecond * 1000;
    setTimeout(() => {
      this.inFlight -= 1;
      this.emit({
        type: 'AUDIO',
        requestId: message.requestId,
        wav: new ArrayBuffer(8),
        durationSec,
      });
    }, 0);
  }
}

function useFakeWorker(worker: FakeKokoroWorker): void {
  vi.spyOn(performance, 'now').mockImplementation(() => worker.now);
  resetKokoroForTesting(() => worker);
}

describe('Standard voice engine resolution (device check)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    reloadVoiceModeStatus();
    // jsdom has no speechSynthesis; the fallback needs one to pick it.
    Object.assign(window, {
      speechSynthesis: { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() },
      SpeechSynthesisUtterance: function SpeechSynthesisUtterance() {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
    delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
    window.localStorage.clear();
  });

  it('keeps Kokoro when generation is faster than playback, and remembers it', async () => {
    const worker = new FakeKokoroWorker(0.3);
    useFakeWorker(worker);

    await expect(resolveStandardEngine()).resolves.toBe('kokoro');

    const generated = worker.messages.filter((m) => m.type === 'GENERATE');
    expect(generated).toHaveLength(2); // warm-up + timed sentence
    expect(generated[1]).toMatchObject({ text: DEVICE_CHECK_SENTENCE });
    expect(getVoiceModeStatus().standardEngine).toBe('kokoro');
    expect(window.localStorage.getItem('progressive-voice-standard-engine')).toBe('"kokoro"');
    expect(getVoiceModeStatus().download.state).toBe('ready');
  });

  it('switches to speechSynthesis when real-time factor > 1, and remembers it', async () => {
    const worker = new FakeKokoroWorker(1.5);
    useFakeWorker(worker);

    await expect(resolveStandardEngine()).resolves.toBe('speech-synthesis');
    expect(window.localStorage.getItem('progressive-voice-standard-engine')).toBe(
      '"speech-synthesis"',
    );
  });

  it('does not download the model again once speechSynthesis was remembered', async () => {
    window.localStorage.setItem('progressive-voice-standard-engine', '"speech-synthesis"');
    reloadVoiceModeStatus();
    const createWorker = vi.fn(() => new FakeKokoroWorker(0.3));
    resetKokoroForTesting(createWorker);

    await expect(resolveStandardEngine()).resolves.toBe('speech-synthesis');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('skips the timing run when Kokoro was already chosen on this device', async () => {
    window.localStorage.setItem('progressive-voice-standard-engine', '"kokoro"');
    reloadVoiceModeStatus();
    const worker = new FakeKokoroWorker(5);
    useFakeWorker(worker);

    await expect(resolveStandardEngine()).resolves.toBe('kokoro');
    expect(worker.messages.filter((m) => m.type === 'GENERATE')).toHaveLength(0);
  });

  it('uses speechSynthesis for the session (not remembered) when the model fails to load', async () => {
    useFakeWorker(new FakeKokoroWorker(0.3, true));

    await expect(resolveStandardEngine()).resolves.toBe('speech-synthesis');
    expect(window.localStorage.getItem('progressive-voice-standard-engine')).toBeNull();
    expect(getVoiceModeStatus().download.state).toBe('error');
  });
});

describe('KokoroWorkerClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is lazy: no worker exists until the first load or generate', () => {
    const createWorker = vi.fn(() => new FakeKokoroWorker(0.3));
    new KokoroWorkerClient(createWorker);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('serializes generations (one ONNX session)', async () => {
    const worker = new FakeKokoroWorker(0.3);
    const client = new KokoroWorkerClient(() => worker);

    await Promise.all([
      client.generate('one', 'bm_fable'),
      client.generate('two', 'am_puck'),
      client.generate('three', 'af_heart'),
    ]);

    expect(worker.maxInFlight).toBe(1);
    expect(worker.messages.filter((m) => m.type === 'GENERATE')).toHaveLength(3);
  });

  it('rejects an aborted request without sending it', async () => {
    const worker = new FakeKokoroWorker(0.3);
    const client = new KokoroWorkerClient(() => worker);
    const controller = new AbortController();
    controller.abort();

    await expect(client.generate('x', 'bm_fable', controller.signal)).rejects.toThrow('Aborted');
    expect(worker.messages.filter((m) => m.type === 'GENERATE')).toHaveLength(0);
  });

  it('KokoroProvider returns a WAV blob in the category voice', async () => {
    const worker = new FakeKokoroWorker(0.3);
    resetKokoroForTesting(() => worker);
    global.URL.createObjectURL = vi.fn(() => 'blob:kokoro');

    const result = await KokoroProvider.generateAudio(
      'Hello',
      { category: 'goblin', voiceId: 'ignored' },
      { stability: 0.5, similarity_boost: 0.75 },
    );

    expect(result.audioBlob.type).toBe('audio/wav');
    expect(result.audioUrl).toBe('blob:kokoro');
    expect(worker.messages.at(-1)).toMatchObject({ type: 'GENERATE', voice: 'am_puck' });
  });
});
