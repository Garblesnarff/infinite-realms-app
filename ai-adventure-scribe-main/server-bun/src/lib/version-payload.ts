import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Body of GET /version (#2293). Public on purpose: it names the deployed commit and the live
 * client bundle so a tester can check what prod is running before turn 1, and the post-deploy
 * smoke can check the deploy actually took. It carries no env values, paths or secrets.
 */
export interface VersionPayload {
  /** Full SHA of the commit the server process is running, or "unknown". */
  commit: string;
  /** First 8 characters of `commit` (the client's "build <short>" uses the same length). */
  short: string;
  /**
   * ISO time this build went live. The server has no build step (bun runs the TypeScript), so
   * this is `BUILD_TIME` if the deploy sets it, else the time this process started — which, under
   * auto-deploy, is the `pm2 restart` right after the build.
   */
  builtAt: string;
  /** The client entry chunk nginx is serving (e.g. "main-DMthKkaE.js"), or null. */
  bundle: string | null;
  /** The commit stamp baked into that bundle (index.html's app-version meta), or null. */
  clientBuild: string | null;
}

export const UNKNOWN_COMMIT = 'unknown';
const SHA = /^[0-9a-f]{7,40}$/i;

export interface VersionSources {
  env?: Record<string, string | undefined>;
  /** Returns `git rev-parse HEAD` in the server's checkout; throws if git can't answer. */
  gitHead?: () => string;
  /** Returns the served index.html; throws if it can't be read. */
  readClientIndex?: () => string;
  startedAt?: Date;
}

function defaultGitHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2000,
  }).trim();
}

/** pm2 runs the server from `<app>/server-bun`; nginx serves `<app>/dist`. */
function defaultReadClientIndex(): string {
  const file =
    process.env.CLIENT_INDEX_HTML || path.resolve(process.cwd(), '..', 'dist', 'index.html');
  return readFileSync(file, 'utf8');
}

/**
 * The commit is resolved once per process: auto-deploy runs `git reset --hard` and then
 * `pm2 restart`, so HEAD at startup is the deployed commit, and a later `git` change on the box
 * without a restart must not make /version claim code that isn't running.
 */
export function resolveCommit(sources: VersionSources = {}): string {
  const env = sources.env ?? process.env;
  const fromEnv = env.GIT_COMMIT?.trim();
  if (fromEnv && SHA.test(fromEnv)) return fromEnv.toLowerCase();
  try {
    const head = (sources.gitHead ?? defaultGitHead)();
    if (SHA.test(head)) return head.toLowerCase();
  } catch {
    // Not a git checkout, or git missing: fall through. /version must never fail.
  }
  return UNKNOWN_COMMIT;
}

/** Entry chunk and baked-in build stamp from the served index.html. Never throws. */
export function readClientBuild(readIndex: () => string = defaultReadClientIndex): {
  bundle: string | null;
  clientBuild: string | null;
} {
  let html: string;
  try {
    html = readIndex();
  } catch {
    return { bundle: null, clientBuild: null };
  }
  const bundle = html.match(/\/assets\/(main-[A-Za-z0-9_-]+\.js)/)?.[1] ?? null;
  const meta = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) =>
    /\bname\s*=\s*(["'])app-version\1/i.test(tag),
  );
  const stamp = meta?.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
  // Only a SHA-shaped stamp is echoed back, so this can never reflect arbitrary text.
  return { bundle, clientBuild: stamp && SHA.test(stamp) ? stamp.toLowerCase() : null };
}

export function createVersionPayloadBuilder(sources: VersionSources = {}): () => VersionPayload {
  const env = sources.env ?? process.env;
  const commit = resolveCommit(sources);
  const startedAt = sources.startedAt ?? new Date(Date.now() - process.uptime() * 1000);
  const buildTime = env.BUILD_TIME?.trim();
  const builtAt =
    buildTime && !Number.isNaN(Date.parse(buildTime))
      ? new Date(buildTime).toISOString()
      : startedAt.toISOString();

  return () => ({
    commit,
    short: commit === UNKNOWN_COMMIT ? UNKNOWN_COMMIT : commit.slice(0, 8),
    builtAt,
    // Read per request: the client bundle is published after the restart, so a value cached at
    // startup would name the previous bundle for the rest of the process's life.
    ...readClientBuild(sources.readClientIndex),
  });
}
