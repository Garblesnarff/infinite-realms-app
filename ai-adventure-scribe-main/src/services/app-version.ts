export function resolveAppBuildVersion(): string {
  if (typeof document !== 'undefined') {
    const metaTag = document.querySelector('meta[name="app-version"]');
    const content = metaTag?.getAttribute('content')?.trim();
    if (content && content !== '__APP_BUILD_VERSION__') {
      return content;
    }
  }
  return String(import.meta.env.VITE_RELEASE || import.meta.env.VITE_APP_VERSION || 'dev');
}

/**
 * The same build identifier is embedded in index.html and read by the app at runtime.
 */
export const APP_BUILD_VERSION = resolveAppBuildVersion();

/** The release number from package.json at build time, e.g. "0.33.0" (#227). */
export const APP_RELEASE_VERSION =
  (typeof __APP_RELEASE_VERSION__ === 'string' && __APP_RELEASE_VERSION__.trim()) || 'dev';

/**
 * The first 8 characters of a build stamp, as the app shows it ("build 3fa7eefe") and as
 * GET /version reports `short` (#2293), so a tester can compare the two at a glance.
 */
export function shortBuildVersion(version: string): string {
  return version.trim().slice(0, 8);
}

export const APP_BUILD_SHORT = shortBuildVersion(APP_BUILD_VERSION);

/** Extract the version stamp from the served HTML entry point. */
export function extractServedAppVersion(html: string): string | null {
  const metaTag = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) =>
    /\bname\s*=\s*(["'])app-version\1/i.test(tag),
  );
  if (!metaTag) return null;

  const content = metaTag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
  return content || null;
}
