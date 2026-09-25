/**
 * Standard voice: Kokoro-82M in a module Web Worker (src/workers/kokoro-worker.ts).
 *
 * Nothing loads at import time. The worker (and the ~90 MB model download) is
 * created on the first resolveStandardEngine() call: when the player picks
 * Standard voice, or when premium falls back. Download progress goes to the
 * voice mode store for VoiceStatusAlerts.
 *
 * Device check: on first use one short sentence is timed. If generating it
 * takes longer than playing it (real-time factor > 1), the device uses
 * window.speechSynthesis instead, and that result is remembered.
 */

import { hasSpeechSynthesis } from './speech-synthesis-voice';
import { getKokoroVoiceForCategory } from './voice-constants-kokoro';
import {
  type StandardEngine,
  getVoiceModeStatus,
  setStandardEngine,
  setStandardVoiceDownload,
} from './voice-mode-store';
import { type VoiceProvider } from './voice-provider';

import type { KokoroWorkerMessage, KokoroWorkerResponse } from '@/workers/kokoro-worker';

import logger from '@/lib/logger';

export const DEVICE_CHECK_SENTENCE = 'The torchlight flickers across the old stone walls.';
const WARMUP_TEXT = 'Ready.';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((event: MessageEvent<KokoroWorkerResponse>) => void) | null;
};

function createKokoroWorker(): WorkerLike {
  return new Worker(new URL('../../workers/kokoro-worker.ts', import.meta.url), {
    type: 'module',
  });
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError');
}

interface SynthesisResult {
  wav: ArrayBuffer;
  durationSec: number;
}

export class KokoroWorkerClient {
  private worker: WorkerLike | null = null;
  private loadPromise: Promise<void> | null = null;
  private pending = new Map<
    string,
    { resolve: (value: SynthesisResult) => void; reject: (error: Error) => void }
  >();
  private loadWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
  // kokoro-js runs one ONNX session; generations are serialized, never concurrent.
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(private readonly createWorker: () => WorkerLike = createKokoroWorker) {}

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = new Promise<void>((resolve, reject) => {
      this.loadWaiter = { resolve, reject };
      setStandardVoiceDownload({ state: 'loading', loaded: 0, total: 0 });
      this.ensureWorker().postMessage({ type: 'LOAD' } satisfies KokoroWorkerMessage);
    });
    this.loadPromise.catch(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  generate(text: string, voice: string, signal?: AbortSignal): Promise<SynthesisResult> {
    if (signal?.aborted) return Promise.reject(abortError());

    const run = async (): Promise<SynthesisResult> => {
      if (signal?.aborted) throw abortError();
      await this.load();
      const requestId = `kokoro_${++this.seq}`;
      return new Promise<SynthesisResult>((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject });
        this.ensureWorker().postMessage({
          type: 'GENERATE',
          requestId,
          text,
          voice,
        } satisfies KokoroWorkerMessage);
      });
    };

    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);

    if (!signal) return result;
    // The worker cannot stop mid-sentence; an abort just stops waiting for it.
    return new Promise<SynthesisResult>((resolve, reject) => {
      const onAbort = (): void => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      result.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: KokoroWorkerResponse): void {
    switch (message.type) {
      case 'PROGRESS':
        setStandardVoiceDownload({
          state: 'loading',
          loaded: message.loaded,
          total: message.total,
        });
        return;
      case 'READY': {
        const { download } = getVoiceModeStatus();
        setStandardVoiceDownload({ ...download, state: 'ready' });
        logger.info(`🗣️ Standard voice ready (${message.device})`);
        this.loadWaiter?.resolve();
        this.loadWaiter = null;
        return;
      }
      case 'LOAD_ERROR':
        setStandardVoiceDownload({ state: 'error', loaded: 0, total: 0 });
        this.loadWaiter?.reject(new Error(`Standard voice failed to load: ${message.error}`));
        this.loadWaiter = null;
        return;
      case 'AUDIO':
        this.pending.get(message.requestId)?.resolve({
          wav: message.wav,
          durationSec: message.durationSec,
        });
        this.pending.delete(message.requestId);
        return;
      case 'ERROR':
        this.pending.get(message.requestId)?.reject(new Error(message.error));
        this.pending.delete(message.requestId);
        return;
    }
  }
}

let client = new KokoroWorkerClient();
let enginePromise: Promise<StandardEngine> | null = null;

/** Real-time factor of one short sentence: seconds to generate / seconds of audio. */
export async function measureRealTimeFactor(workerClient: KokoroWorkerClient): Promise<number> {
  // First inference compiles WebGPU shaders / warms wasm; timing it would
  // mark fast devices as slow for good.
  await workerClient.generate(WARMUP_TEXT, getKokoroVoiceForCategory('narrator'));
  const startedAt = performance.now();
  const { durationSec } = await workerClient.generate(
    DEVICE_CHECK_SENTENCE,
    getKokoroVoiceForCategory('narrator'),
  );
  const elapsedSec = (performance.now() - startedAt) / 1000;
  return durationSec > 0 ? elapsedSec / durationSec : Number.POSITIVE_INFINITY;
}

async function decideEngine(): Promise<StandardEngine> {
  try {
    await client.load();
  } catch (error) {
    if (!hasSpeechSynthesis()) throw error;
    // Not remembered: a network failure says nothing about the device.
    logger.warn(
      '⚠️ Standard voice model failed to load; using speechSynthesis this session',
      error,
    );
    return 'speech-synthesis';
  }

  if (getVoiceModeStatus().standardEngine === 'kokoro') return 'kokoro';

  const rtf = await measureRealTimeFactor(client);
  const engine: StandardEngine = rtf > 1 && hasSpeechSynthesis() ? 'speech-synthesis' : 'kokoro';
  logger.info(`🗣️ Standard voice device check: real-time factor ${rtf.toFixed(2)} -> ${engine}`);
  setStandardEngine(engine);
  return engine;
}

/**
 * Which engine the Standard voice uses on this device. The first call starts
 * the worker, the model download and the device check; later calls share it.
 */
export function resolveStandardEngine(): Promise<StandardEngine> {
  if (getVoiceModeStatus().standardEngine === 'speech-synthesis' && hasSpeechSynthesis()) {
    return Promise.resolve('speech-synthesis');
  }
  if (!enginePromise) {
    enginePromise = decideEngine();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

/** Start the download early, e.g. as soon as the player selects Standard voice. */
export function prepareStandardVoice(): void {
  resolveStandardEngine().catch((error) => {
    logger.error('❌ Standard voice could not start:', error);
  });
}

export const KokoroProvider: VoiceProvider = {
  id: 'kokoro',

  resolveVoiceId(voice) {
    return getKokoroVoiceForCategory(voice.category);
  },

  async generateAudio(text, voice, _settings, signal) {
    const { wav } = await client.generate(text, getKokoroVoiceForCategory(voice.category), signal);
    const audioBlob = new Blob([wav], { type: 'audio/wav' });
    return { audioBlob, audioUrl: URL.createObjectURL(audioBlob) };
  },
};

/** Test seam: swap the worker factory and forget the memoized engine. */
export function resetKokoroForTesting(createWorker?: () => WorkerLike): void {
  client = new KokoroWorkerClient(createWorker);
  enginePromise = null;
}
