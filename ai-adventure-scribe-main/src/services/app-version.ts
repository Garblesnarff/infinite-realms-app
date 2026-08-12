/**
 * The same build identifier is embedded in the running bundle and index.html.
 * Vite defines __APP_BUILD_VERSION__ during a build; the fallback keeps tests and
 * non-Vite consumers deterministic.
 */
export const APP_BUILD_VERSION =
  (typeof __APP_BUILD_VERSION__ === 'string' && __APP_BUILD_VERSION__.trim()) ||
  String(import.meta.env.VITE_RELEASE || import.meta.env.VITE_APP_VERSION || 'dev');

/** Extract the version stamp from the served HTML entry point. */
export function extractServedAppVersion(html: string): string | null {
  const metaTag = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) =>
    /\bname\s*=\s*(["'])app-version\1/i.test(tag),
  );
  if (!metaTag) return null;

  const content = metaTag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
  return content || null;
}
