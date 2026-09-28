/**
 * The same build identifier is embedded in the running bundle and index.html.
 * Vite defines __APP_BUILD_VERSION__ during a build; the fallback keeps tests and
 * non-Vite consumers deterministic.
 */
export const APP_BUILD_VERSION =
  (typeof __APP_BUILD_VERSION__ === 'string' && __APP_BUILD_VERSION__.trim()) ||
  String(import.meta.env.VITE_RELEASE || import.meta.env.VITE_APP_VERSION || 'dev');

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
