/**
 * Kokoro engine: model load + synthesis. Runs inside src/workers/kokoro-worker.ts;
 * kept separate so it can be unit-tested with kokoro-js mocked.
 *
 * kokoro-js is imported dynamically so it (and onnxruntime-web) only load in
 * the worker chunk, and only when the player first needs the Standard voice.
 */

import type { KokoroTTS } from 'kokoro-js';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// q8 ≈ 90 MB. kokoro-js's README recommends fp32 for webgpu; q8 is used on both
// per issue #2162 to keep the download small. The manual WebGPU check decides.
export const KOKORO_DTYPE = 'q8';

export type KokoroDevice = 'webgpu' | 'wasm';

export interface KokoroProgress {
  loaded: number;
  total: number;
}

export function pickKokoroDevice(nav: unknown): KokoroDevice {
  return nav && typeof nav === 'object' && 'gpu' in nav && nav.gpu ? 'webgpu' : 'wasm';
}

interface FileProgressInfo {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

/** Sum per-file transformers.js progress events into one loaded/total pair. */
export function createProgressAggregator(
  onProgress: (progress: KokoroProgress) => void,
): (info: FileProgressInfo) => void {
  const files = new Map<string, { loaded: number; total: number }>();
  return (info) => {
    if (info.status !== 'progress' || !info.file) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    let loaded = 0;
    let total = 0;
    files.forEach((file) => {
      loaded += file.loaded;
      total += file.total;
    });
    onProgress({ loaded, total });
  };
}

export async function loadKokoro(
  device: KokoroDevice,
  onProgress: (progress: KokoroProgress) => void,
): Promise<{ tts: KokoroTTS; device: KokoroDevice }> {
  const { KokoroTTS } = await import('kokoro-js');
  const progress_callback = createProgressAggregator(onProgress);
  try {
    const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: KOKORO_DTYPE,
      device,
      progress_callback,
    });
    return { tts, device };
  } catch (error) {
    // navigator.gpu can exist without a usable adapter; wasm always works.
    if (device !== 'webgpu') throw error;
    const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: KOKORO_DTYPE,
      device: 'wasm',
      progress_callback,
    });
    return { tts, device: 'wasm' };
  }
}

export async function synthesize(
  tts: Pick<KokoroTTS, 'generate'>,
  text: string,
  voice: string,
): Promise<{ wav: ArrayBuffer; durationSec: number }> {
  const audio = await tts.generate(text, { voice: voice as never });
  return {
    wav: audio.toWav(),
    durationSec: audio.audio.length / audio.sampling_rate,
  };
}
