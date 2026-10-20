## Day 3 triage — before dependency edits

Inspected main `3d0636518f4a07d8d21f5942fde2bf383cd2abbb`, current source, lockfiles, installed dependency source, and refreshed advisory queries on 2026-10-20. App `bun audit --json`: 28 names / 73 affected ranges (same as F05); `--production` still reports build-only peers, so it is **not** a runtime reachability proof. Lore npm audit: 12 nodes (7 high, 1 critical); ingest: 5 nodes (3 high). No live model calls, remote application requests, production DB access, or exploit against a running service.

### App high/critical packages

| Package / locked version | Runtime entry and vulnerable-path assessment |
|---|---|
| drizzle-orm 0.44.7 | Server DB queries are live. [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) requires untrusted SQL identifiers/aliases; no production `sql.identifier` call found, and `.as()` aliases in session-message-service are literal `total_count`. Static schema objects / parameterized values do not reach that sink. No SQL injection established. |
| fast-uri 3.1.2 | Ajv 8.20.0 in `server-bun/src/services/llm-provider-service.ts:233,262` compiles response schemas. URI parsing is live; no Ajv `loadSchema` or network schema resolver is configured. Host normalization/serialize bugs are affected, but a URL authorization + fetch chain is not established. **First bounded group proposed: refresh this compatible transitive parser only, with actual provider + LLM HTTP/schema regression tests.** This is defense in depth, not a claim of an SSRF exploit. |
| mathjs 14.9.1 | Client `src/services/dice/DiceEngine.ts:1,62` -> rpg-dice-roller 5.5.1 -> mathjs evaluate. Player formulas reach a PEG dice grammar first. The reported object-property setter APIs are not imported/called directly; arbitrary assignments/property setters are outside that grammar. Runtime evaluator is reachable; vulnerable setter reachability is unproven. A major mathjs/roller change needs its own bounded follow-up, not a blind transitive major override. [advisory](https://github.com/advisories/GHSA-29qv-4j9f-fjw5) |
| sharp 0.34.5 | kokoro-js -> transformers dependency. Only client voice worker/engine imports kokoro; this feature performs text-to-speech, not untrusted image decoding. Transformers' image utility imports sharp, but no app server sharp/image-decoder entry was found. Native decoder advisories are not shown reachable by this TTS path; browser build still must be kept separate from Node package installation. |
| form-data 4.0.5 | App tree chain is openai -> @types/node-fetch -> form-data. No production app import of OpenAI SDK, FormData package, or attacker-selected multipart field/filename was found; provider uses fetch JSON. The vulnerable multipart header construction is not demonstrated. [advisory](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) |
| postcss 8.5.15 | Server markdown sanitizer imports sanitize-html, which imports PostCSS. Its installed style parser explicitly calls `postcssParse(..., { map: false })`; app sanitizer also excludes style attributes. Thus previous-source-map auto-loading is blocked at this seam, while build tooling also uses PostCSS. [advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| source-map-js 1.2.1 | Transitive PostCSS source-map consumer. No app ingestion of untrusted indexed source maps found; sanitizer's map:false blocks that source. Build-time source maps remain tooling exposure. [advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| nanoid 3.3.12 | Through PostCSS. No app use of non-secure/custom generators or attacker-controlled size. The separate 5.1.16 copy is not affected by the locked 3.x ranges. Negative/zero-size vulnerable call not established. [advisory](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) |
| braces 3.0.3 | Tailwind/micromatch/chokidar peer chain appears under --production because tailwindcss-animate has a Tailwind peer. It is build/watch tooling here, not a server/client request API. Untrusted deeply nested glob patterns would be a build/developer exposure. |

sanitize-html 2.17.4 and react-router-dom 6.30.4 were examples in F05, not high/critical names in this app advisory response. Their lower-severity advisories remain recorded; this report does not silently equate “not high/critical” with “fixed.”

### Separate deployment domains

Lore MCP is `StdioServerTransport` (`lore-keeper-mcp-server/src/server.ts:9`), with tool handlers, not a shared HTTP/SSE transport. `@modelcontextprotocol/sdk` advisories about cross-client HTTP transport reuse and OAuth client credential forwarding are not that deployed code path; URI-template ReDoS needs a separately demonstrated resource/template input (this server exposes tools, not resource templates). SDK's transitive `hono`, `@hono/node-server`, `path-to-regexp`, and `proxy-addr` HTTP/static/auth middleware are not imported by this stdio entry. Do not label it an internet-facing Hono auth bypass.

Lore `fast-uri` is through SDK/Ajv; again no custom remote schema fetching configured. Lore/ingest `form-data` sits below the OpenAI SDK; lore calls embeddings with JSON and ingest uses native fetch JSON, not caller-selected multipart fields/filenames. Ingest `js-yaml` is below declared gray-matter, but no gray-matter/YAML parser import exists in its current source. These vulnerable APIs are not demonstrated reachable.

Both lore and ingest include Supabase -> realtime -> `ws`. They use Supabase DB HTTP calls; no `.channel()` / realtime subscription found in these source trees. A WebSocket frame parser would be reachable if realtime were connected, and the SDK dependency remains affected; provider-controlled WebSocket traffic is a distinct trust boundary. No inbound public WebSocket server was found. Treat this as a separate ws package-group follow-up, not an app route defect.

Repository-root package dependencies are a separate lock domain (knip/tsx tooling plus Supabase). The app server runs from the app workspace lock, not that root tooling lock. Its advisories must not be added to the app count as disjoint vulnerabilities. Companion's clean audit does not cover these other domains.

### Development / CI-only high and critical list

App names: brace-expansion, braces (above peer caveat), browserslist, js-yaml, shell-quote, tinypool, vite, vitest; plus build-only uses of postcss/source-map-js/nanoid. Critical entries are shell-quote object-op quoting, two tinypool worker-option gadgets, and exposed Vitest UI. No production import or Vitest UI listener was found. CI runs tests, so prototype pollution/untrusted config and developer-server exposure still matter; they are not waived as harmless. Upgrade these in a tooling group, with baseline test compatibility, not in the runtime parser patch.

### Scope and ownership

One #843 PR will contain this report and the compatible fast-uri transitive patch, if its resolution stays bounded. `ai-adventure-scribe-main/package.json` is owned by open release PR #461, so it will not be edited. Mathjs major changes and other package groups are follow-ups; no blanket “audit fixed” claim. No workflow file will be edited without Rob's new typed line; exact proposed gate diff follows separately.

Friction / simplification: `bun audit --production` includes peer-induced build packages, and npm counts affected dependency nodes while Bun reports advisory ranges. Counts without dependency chains would conflate three different things. An allowlist must key package + advisory + lock domain with an owner, reason and expiry.

### Bounded patch and verification

The app lock now resolves fast-uri 3.1.9, staying within Ajv's ^3.0.1 range. No manifest changed (release PR #461 owns the app manifest); all other lock records are byte-identical. Frozen install succeeds. Other lock domains are unchanged. Raw advisory metadata is retained in dependency-triage-843-evidence.json.

Before: 28 names / 73 ranges (41 high, 4 critical, 24 moderate, 4 low). After: 27 names / 65 ranges (34 high, 4 critical, 23 moderate, 4 low); fast-uri is absent from the new app query. This is not a clean-all-dependencies claim.

Parser regressions: same test against locked old 3.1.2 gives 1 pass / 2 fail; 3.1.9 gives 3 pass / 0 fail. Literal-backslash authority reports an error; a delimiter-bearing port throws; ordinary JSON-schema reference resolution stays unchanged. These are upstream parser behaviors, not application exploit proof.

Real POST /v1/llm/generate streaming and non-streaming paths use the actual provider against recorded SSE/JSON fixtures: 2 pass / 28 assertions. Real provider full-schema validation: 4 pass / 15 assertions. No live model call. Server type gate PASS, zero errors. Hosted CI is the full integration gate.

CI proposal only: see dependency-audit-ci-proposal-843.md and issue #843. No workflow, repo setting, production config or data was changed.
