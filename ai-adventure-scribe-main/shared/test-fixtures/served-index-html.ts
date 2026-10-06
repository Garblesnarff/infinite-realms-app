/**
 * The index.html the client build serves: the `app-version` meta tag Vite's build fills with
 * __APP_BUILD_VERSION__ (vite.config.ts) and the hashed entry bundle.
 *
 * Shared so GET /version's test and the two client tests that show "build <short>" read one
 * stamp (AGENTS.md §4). The stamp is 12 characters on purpose: the client cuts it to 8 with
 * shortBuildVersion, the server reports the same 8 as `short`, so a wrong cut shows in both.
 */
export const servedIndexHtml =
  '<html><head><meta name="app-version" content="3fa7eefe0c1d">' +
  '<script type="module" crossorigin src="/assets/main-DMthKkaE.js"></script></head></html>';
