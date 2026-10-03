/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';

// Silence noisy logs in test runs and filter React act() warnings
const originalError = console.error;
vi.spyOn(console, 'debug').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const msg = args[0];
  if (typeof msg === 'string' && msg.includes('not wrapped in act')) return;
  // Forward other errors
  originalError.apply(console, args as any);
});
