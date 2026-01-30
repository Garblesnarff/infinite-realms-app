## 2025-01-29 - [Combat Interface Extraction]
**Challenge:** Encountered build-breaking syntax errors in unrelated files (`context-builder.ts` and `asset-processor.ts`) that were truncated in the source. This prevented verification of the refactor.
**Learning:** Always verify the build state *before* starting a refactor to distinguish between existing issues and new ones. Backticks in template literals must be carefully escaped when editing files via search-and-replace tools.
**Pattern:** Extracting a large set of handlers and state into a custom hook effectively reduced a 1000-line component to under 350 lines, improving readability without changing UI structure.
