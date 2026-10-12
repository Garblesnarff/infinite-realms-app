declare module 'howler' {
  export interface HowlerOptions {
    src: string | string[];
    volume?: number;
    html5?: boolean;
    loop?: boolean;
    preload?: boolean;
    autoplay?: boolean;
    mute?: boolean;
    sprite?: Record<string, [number, number]>;
    rate?: number;
    pool?: number;
    format?: string[];
    onload?: () => void;
    onloaderror?: (id: number, error: unknown) => void;
    onplayerror?: (id: number, error: unknown) => void;
    onplay?: (id: number) => void;
    onend?: (id: number) => void;
    onpause?: (id: number) => void;
    onstop?: (id: number) => void;
    onmute?: () => void;
    onvolume?: () => void;
    onrate?: () => void;
    onseek?: () => void;
    onunload?: () => void;
  }

  export class Howl {
    constructor(options: HowlerOptions);
    play(spriteOrId?: string | number): number;
    pause(id?: number): this;
    stop(id?: number): this;
    mute(muted?: boolean): this;
    volume(volume?: number): this;
    rate(rate?: number): this;
    seek(seek?: number, id?: number): this;
    playing(id?: number): boolean;
    duration(id?: number): number;
    state(): 'unloaded' | 'loading' | 'loaded';
    load(): this;
    unload(): this;
    on(event: string, callback: (...args: unknown[]) => void, id?: number): this;
    off(event: string, callback?: (...args: unknown[]) => void, id?: number): this;
  }

  export class Howler {
    static mute(muted: boolean): void;
    static volume(volume?: number): number;
    static stop(): void;
    static unload(): void;
    static codecs(ext: string): boolean;
  }

  const HowlerGlobal: {
    Howl: typeof Howl;
    Howler: typeof Howler;
  };

  export default HowlerGlobal;
}
