# Deep test audit — #793

Baseline: `dff923b19e47813be84d971d0bfcb28b7acf8b50` (fresh origin/main, 2026-10-17).

## Outcome

Removed 14 production-unreachable client modules and the 11 suites that only exercised those APIs (25 files). Removed 159 obsolete cases, including 13 legacy-only cases in a mixed suite. Preserved all 74 live cases in the focused baseline, including the mixed suite's 17 parser/dice/roll-state tests and the source-wide broken-barrel guard. No failing test was deleted to obtain a green run: the complete baseline was green before retirement. No existing test was newly skipped, and no only marker was added.

Fixed actual runner bugs instead of retiring their tests: Bun discovery now includes `.test.tsx`, empty or early-exiting children fail, and concurrent children retain process-local mocks. The discovery summary names its known-unrun suite and reason instead of claiming complete execution. The restored blog suite has three canonical URL assertions. The new runner harness has seven integration cases, including negative controls and intentionally skipped no-database fixtures.

Added explicit CI ownership for six otherwise unregistered Bun suites: security lint, headless authentication, bounded integers, and three offline Jev Pilot suites. Corrected the pilot's obsolete assertion that the current narration checker is absent; it now checks an actual engine contradiction, clean narration, and a separate empty-checkout fixture. No network/model request is required.

## Evidence before retirement

[Per-module proof and assertion disposition](retirement-proof.md), [complete reference matches](references-before.txt), [exact retired cases](retired-test-cases.txt), [independent AST import graph](reachability-before.json).

The AST graph independently scans 2,688 tracked TS/JS modules and reaches 1,357 from seven runtime roots: app, blog, landing, both workers, server and CLI. It includes type imports, reexports, literal dynamic imports/require, Vite aliases and worker URL edges. None of the 25 deleted files is reached. Every inbound source edge belongs to the retired island; remaining incoming edges are the obsolete tests or removed blocks in mixed suites. Cross-repository symbol/filename searches supplement the graph. The retained server `CombatStatus` type and `getCharacterCombatStatus` APIs are distinct active code.

To reproduce with an unmodified baseline checkout that has TypeScript installed:

```sh
node docs/audits/793-deep-tests/trace-imports.cjs /path/to/baseline-checkout /path/to/candidate-checkout
```

The candidate diff is computed against the baseline SHA, so the command also works after committing. The script is an audit artifact, not a new application tool. Arbitrary computed imports cannot be statically resolved. The only nonliteral production import found is the offline pilot's `import(filePath)`; its fixed target is the retained narration checker. Test-only `import.meta.glob` source scans are not runtime reachability. Unresolved imports are recorded rather than silently called dead.

| Retired island                                                                                                                                      | Inbound callers before removal                                                        | Active behavior retained                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/utils/context/{builder,contextDefaults,contextEnhancement,contextValidation}.ts`                                                               | Only two obsolete suites, the removed smoke assertion, and members of this island     | `ai-service.ts` → `services/ai/context-builder.ts` and prompt tests                       |
| `src/components/combat/CombatStatus.tsx`                                                                                                            | Its six-case suite; two unused mock declarations                                      | `CombatTurnBarLive`, `CompactCharacterHeader`, real turn/status/HP tests                  |
| `CombatSequenceValidator`, `CombatActionTracker`, `CombatTurnManager`, `CombatResponseValidator`, `dm-response-patterns`, `services/combat-audit/*` | Their own suites, each other, and two removed describes in `combat-roll-flow.test.ts` | Existing server initiative/attack/HP/security contracts and all live roll-flow assertions |

These were tests of an unused implementation, not duplicate assertions removed merely because another test passed. Active behavior is exercised through the retained production implementations. The stale ESLint exceptions for the two deleted validators were removed.

## Validation

All commands run from `ai-adventure-scribe-main` unless stated otherwise. Locked dependencies were required: an initial borrowed tree lacked fast-check and had an older Ajv type; installing the existing lockfile resolved both without changing manifests/locks. Baseline comparisons below use that corrected tree in an unmodified detached checkout.

| Check                                                              | Clean baseline                                                             | Candidate                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Full frontend `vitest run --testTimeout=20000 --hookTimeout=20000` | 750 passed files, 2 skipped; 7,801 pass, 72 skip                           | 739 passed files, 2 skipped; 7,642 pass, 72 skip                  |
| Server native `ISOLATED_TEST_CONCURRENCY=4 bun run test`           | 279 files; 2,192 pass, 637 skip, 0 fail/error                              | 281 files; 2,202 pass, 637 skip, 0 fail/error                     |
| Server `bun run test:vitest`                                       | 26 files / 262 pass                                                        | 26 files / 262 pass                                               |
| Explicit CI guard/shared/pilot command                             | Original four guards: 46 pass; pilot separately: 20 pass / 1 stale failure | 90 pass / 10 files; all six newly owned suites pass               |
| Server typecheck gate                                              | 0 errors, no quarantine                                                    | 0 errors, no quarantine                                           |
| Actual client `tsc --noEmit -p tsconfig.app.json`                  | 18 diagnostics                                                             | Identical 18 diagnostics, byte-for-byte                           |
| Full ESLint                                                        | 0 errors, 3,078 warnings                                                   | 0 errors, 3,054 warnings                                          |
| Production build + client secret check                             | Pass                                                                       | Pass                                                              |
| Focused survivor/replacement tests                                 | 16 files / 233 cases before retirement                                     | 12 files / 168 cases (74 survivors + 94 existing live-path cases) |

Negative controls before the runner fix: the new fixture harness had three failures (TSX omitted, empty file accepted, successful early exit accepted); corresponding guard tests had four failures. After the fix they pass. The pilot's stale absence expectation failed before its correction. Both installed YAML parsers accept the updated workflow; its folded command was independently executed. No actionlint installation was available.

## Kept and unresolved

- No server/shared source deletion was justified. Deprecated facade methods without direct callsites were retained because their classes still have runtime consumers; lack of a direct call is insufficient proof of an obsolete public API. Mounted retired HTTP routes still require auth/410 compatibility coverage. `retired-client-hp-contracts.vitest.ts` tests live HP, immunity, unconsciousness, death-save reset and write-error behavior and stays.
- Real-DB tests were not run locally: no listener at `127.0.0.1:55432`, Docker daemon unavailable. The 637 native skips are not database proof. The unchanged real-DB runner still owns no-skip/nonempty scratch-DB checks in hosted CI. `solo-survivability.real-db.test.ts` remains explicitly excluded for its tracked behavior failures.
- Actual client tsc's 18 existing errors remain in `combat-resolution-step.ts`, `use-ai-response.ts`, `sheet-option-filter.test.ts`, and `character-converter.ts`. Their files overlap unrelated open PRs (#552 / #650), so this audit does not edit them. The root solution `tsc --noEmit` checks no client program; the existing frontend gate is still unwired pending #664. No claim of a green client typecheck is made.
- The standalone `node scripts/ci/check-real-db-test-list.mjs` entrypoint still expects a literal workflow list replaced by glob discovery and throws. Its collector/comparison helpers remain live in the real-DB runner, discovery guard and tests; deleting the module or its tests would be wrong. Use the current discovery guard/real-DB runner while this obsolete entrypoint is repaired separately.
- Five integration, two performance, one summary suite and `character-creation-atomic.test.ts` remain explicitly excluded; three E2E specs are intentionally CI-disabled. They have not been proved obsolete. Enabled spell component/accessibility suites now render the real component (the historical finding is fixed); the excluded integration spell suite still renders an 850-line local replacement UI. Restore meaningful real-component coverage before considering retirement.
- `VoicePlayerControls`/`VoiceStatusAlerts` appear unreachable, but the voice store promises fallback notices. Leave them intact pending investigation of the absent live notice path; do not erase evidence of potentially missing behavior.
- `lore-keeper-mcp-server/test/database.test.ts` lacks CI ownership and local dependencies. Its obsolescence is unproved. Other package owners (lore ingest and companion MCP) already have explicit CI jobs.
- No file touched by an unrelated open PR was edited. Collision checks use full path sets, not abbreviated stats. Existing feature work and deployment configuration were left alone.

## Friction / simplification

The discovery guard omitted TSX from its input inventory while claiming complete coverage, and the native runner treated successful process termination as test execution. Executable negative controls now cover both. The standalone real-DB-list CLI still documents an abandoned workflow list; a single supported entrypoint would prevent misleading failures. A root solution typecheck that checks no files still obscures the actual client diagnostics.
