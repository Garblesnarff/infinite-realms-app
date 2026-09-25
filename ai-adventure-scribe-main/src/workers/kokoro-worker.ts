/**
 * Kokoro TTS Web Worker
 *
 * Runs the Kokoro-82M model off the main thread. Created lazily by
 * src/services/voice/kokoro-provider.ts the first time the Standard voice is
 * needed; the model download starts on LOAD, not on import.
 *
 * @module workers/kokoro-worker
 */

import type { KokoroTTS } from 'kokoro-js';

import {
  type KokoroDevice,
  type KokoroProgress,
  loadKokoro,
  pickKokoroDevice,
  synthesize,
} from '@/services/voice/kokoro-engine';

export type KokoroWorkerMessage =
  | { type: 'LOAD' }
  | { type: 'GENERATE'; requestId: string; text: string; voice: string };

export type KokoroWorkerResponse =
  | ({ type: 'PROGRESS' } & KokoroProgress)
  | { type: 'READY'; device: KokoroDevice }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'AUDIO'; requestId: string; wav: ArrayBuffer; durationSec: number }
  | { type: 'ERROR'; requestId: string; error: string };

const ctx = self as unknown as {
  postMessage(message: KokoroWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<KokoroWorkerMessage>) => void) | null;
};

let ttsPromise: Promise<KokoroTTS> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function load(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = loadKokoro(pickKokoroDevice(self.navigator), (progress) =>
      ctx.postMessage({ type: 'PROGRESS', ...progress }),
    ).then(({ tts, device }) => {
      ctx.postMessage({ type: 'READY', device });
      return tts;
    });
    ttsPromise.catch((error) => {
      ttsPromise = null;
      ctx.postMessage({ type: 'LOAD_ERROR', error: errorMessage(error) });
    });
  }
  return ttsPromise;
}

ctx.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'LOAD') {
    void load().catch(() => undefined);
    return;
  }

  try {
    const tts = await load();
    const { wav, durationSec } = await synthesize(tts, message.text, message.voice);
    ctx.postMessage({ type: 'AUDIO', requestId: message.requestId, wav, durationSec }, [wav]);
  } catch (error) {
    ctx.postMessage({ type: 'ERROR', requestId: message.requestId, error: errorMessage(error) });
  }
};
