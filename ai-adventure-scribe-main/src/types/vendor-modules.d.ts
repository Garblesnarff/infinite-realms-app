/**
 * Minimal ambient declarations for untyped vendor modules.
 *
 * Only the exports actually imported by `src/**` are declared here.
 * Do not expand into a full @types/* replacement.
 */

declare module 'uuid' {
  export function v4(): string;
}

declare module 'howler' {
  export class Howl {
    constructor(options: { src: string[]; volume?: number; onloaderror?: () => void });
    play(): number;
    unload(): void;
  }
}
