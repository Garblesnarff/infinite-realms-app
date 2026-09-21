import { basename } from 'node:path';

/** macOS AppleDouble sidecars (`._foo.test.ts`) match nested `*.test.ts` globs. */
export function isAppleDoubleSidecar(file: string): boolean {
  return basename(file).startsWith('._');
}
