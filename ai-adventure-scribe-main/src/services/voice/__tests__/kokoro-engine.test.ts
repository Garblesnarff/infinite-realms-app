import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KOKORO_MODEL_ID,
  createProgressAggregator,
  loadKokoro,
  pickKokoroDevice,
  synthesize,
} from '../kokoro-engine';

const { fromPretrained } = vi.hoisted(() => ({ fromPretrained: vi.fn() }));

// kokoro-js is always mocked: CI never downloads the model.
vi.mock('kokoro-js', () => ({
  KokoroTTS: { from_pretrained: fromPretrained },
}));

describe('kokoro-engine', () => {
  beforeEach(() => {
    fromPretrained.mockReset();
  });

  it('picks webgpu only when navigator.gpu exists', () => {
    expect(pickKokoroDevice({ gpu: {} })).toBe('webgpu');
    expect(pickKokoroDevice({})).toBe('wasm');
    expect(pickKokoroDevice(undefined)).toBe('wasm');
  });

  it('loads the q8 Kokoro-82M model on the requested device', async () => {
    const tts = { generate: vi.fn() };
    fromPretrained.mockResolvedValue(tts);

    const result = await loadKokoro('webgpu', vi.fn());

    expect(fromPretrained).toHaveBeenCalledWith(
      KOKORO_MODEL_ID,
      expect.objectContaining({ dtype: 'q8', device: 'webgpu' }),
    );
    expect(KOKORO_MODEL_ID).toBe('onnx-community/Kokoro-82M-v1.0-ONNX');
    expect(result).toEqual({ tts, device: 'webgpu' });
  });

  it('retries on wasm when webgpu fails to load', async () => {
    const tts = { generate: vi.fn() };
    fromPretrained.mockRejectedValueOnce(new Error('no adapter')).mockResolvedValueOnce(tts);

    const result = await loadKokoro('webgpu', vi.fn());

    expect(fromPretrained).toHaveBeenLastCalledWith(
      KOKORO_MODEL_ID,
      expect.objectContaining({ device: 'wasm' }),
    );
    expect(result.device).toBe('wasm');
  });

  it('does not retry when wasm itself fails', async () => {
    fromPretrained.mockRejectedValue(new Error('offline'));

    await expect(loadKokoro('wasm', vi.fn())).rejects.toThrow('offline');
    expect(fromPretrained).toHaveBeenCalledTimes(1);
  });

  it('sums per-file download progress', () => {
    const onProgress = vi.fn();
    const aggregate = createProgressAggregator(onProgress);

    aggregate({ status: 'initiate', file: 'config.json' });
    aggregate({ status: 'progress', file: 'model.onnx', loaded: 10, total: 90 });
    aggregate({ status: 'progress', file: 'tokenizer.json', loaded: 5, total: 10 });
    aggregate({ status: 'progress', file: 'model.onnx', loaded: 90, total: 90 });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: 95, total: 100 });
  });

  it('returns a WAV buffer and the audio duration', async () => {
    const wav = new ArrayBuffer(16);
    const tts = {
      generate: vi.fn().mockResolvedValue({
        audio: new Float32Array(48000),
        sampling_rate: 24000,
        toWav: () => wav,
      }),
    };

    const result = await synthesize(tts as never, 'Hello', 'bm_fable');

    expect(tts.generate).toHaveBeenCalledWith('Hello', { voice: 'bm_fable' });
    expect(result).toEqual({ wav, durationSec: 2 });
  });
});
