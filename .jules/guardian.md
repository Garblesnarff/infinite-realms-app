# Guardian Journal 🧪

## Learnings
- **D&D 5e Combat Logic**: Resistance reduces damage by half (floored). Vulnerability doubles damage. Resistance and Vulnerability stack; if both apply to one instance, calculate resistance first (floored), then apply vulnerability.
- **Testing Supabase**: Mocking the Supabase client requires careful attention to the chainable methods (`from`, `select`, `update`, `eq`, `single`). Each method in the chain should be mocked to return the appropriate next link (usually `this` or a Promise).
- **Vitest Configuration**: In this project, `vitest.config.ts` uses an explicit `include` list. New tests must be added manually to this list and to `coverage.include` for proper tracking.
- **Linting**: Strict import ordering and file length limits (200 lines) are enforced. Use `eslint-disable` sparingly for test files with complex mock setups.
- **Combat Validation**: The `CombatSequenceValidator` ensures D&D 5e rule compliance. Testing it requires covering various DM message patterns and state transitions (e.g., initiative -> turn order -> attack -> damage).
- **Test Discovery**: In this project, new tests MUST be manually added to `vitest.config.ts`'s `include` array and `coverage.include` to be picked up by the CI and coverage reporter.

## 2025-05-15 - [Character Calculations Bug Fixes]
**Learning:** Found that `calculateHitPoints` was missing the D&D 5e "minimum 1 HP per level" rule, and `calculateArmorClass` was ignoring shields and Monk shield restrictions.
**Action:** Always test D&D math utilities with extreme edge cases (like score 1, modifier -5) and negative class-specific interactions (like Monk + Shield). Centralized math utilities are prone to growing beyond 200 lines; use `eslint-disable max-lines` if refactoring isn't immediate.

## 2025-05-16 - [NPC Auto-Roller Test Coverage]
**Learning:** The `npc-auto-roller.ts` service handles critical "behind the screen" DM logic. Testing it revealed that it correctly separates NPC rolls from player rolls but needed verification for edge cases like critical hits/misses and formatting for various roll types (attack, damage, save, initiative).
**Action:** When testing services that interface with the `DiceEngine`, mock the engine to return specific `naturalRoll` values (1, 20, etc.) to verify critical logic and formatting in the calling service. Always check that the `autoExecute` flag is enforced to prevent accidental auto-rolling of player requests.

## 2025-05-20 - [Rest Mechanics Bug Found]
**Learning:** Found a bug in `rollHitDice` and `processShortRestCombat` where hit dice were under-rolled. The loop condition `i < Math.min(numDice, remainingDice)` was re-evaluated as `remainingDice` was decremented, causing the loop to terminate early (approximately half the requested dice were rolled).
**Action:** Always capture loop limits in a local variable before starting a loop if the variables in the limit expression are modified within the loop.

## 2025-05-24 - [Condition Effects Logic Fixes]
**Learning:** Found that `getConditionModifiers` in `src/utils/conditionEffects.ts` had incorrect logic for several conditions (like `blinded`) because it relied on `participantType === 'player'` instead of the `rollType`. This meant players never received the correct defensive penalties for being blinded.
**Action:** Always use `rollType` (e.g., 'attack', 'defense', 'save') to determine which side of a condition's effect to apply. When testing situational advantage/disadvantage, call `getConditionModifiers` on the participant *possessing* the condition with the appropriate `rollType` (e.g., 'defense' if they are being targeted).

## 2025-05-28 - [Grapple Mechanics Coverage]
**Learning:** The grapple system in `src/utils/grappleUtils.ts` uses a simplified DC-based approach (8 + prof + STR) instead of contested checks. It correctly enforces state-based restrictions (incapacitated) and equipment restrictions (two-handed weapons).
**Action:** When testing grapple mechanics, ensure to cover the transition from healthy to incapacitated states and verify that weapon properties (especially `twoHanded`) correctly prevent grapple attempts. Always test for missing optional fields like `level` to ensure the `|| 1` fallback logic is covered.

## 2025-05-29 - [Exhaustion System Coverage]
**Learning:** The exhaustion system in `src/utils/exhaustionUtils.ts` handles cumulative penalties across 6 levels. Testing it confirmed correct D&D 5e behavior, specifically the rounding down (floor) of hit point maximums when halved at level 4.
**Action:** Always include both the test file and the module under test in the `vitest.config.ts` explicit `include` and `coverage.include` arrays to ensure visibility in reports. Use the AAA pattern and clear mock participants to test cumulative state changes.

## 2026-02-06 - [Fighting Style Mechanics Coverage]
**Learning:** The fighting style system in `src/utils/fightingStyles.ts` handles various combat bonuses (AC, attack, damage rerolls). Some conditions (like Protection and Dueling) have complex requirements (wielding one hand, no other weapons, shield equipped). Simplified implementations in the code (e.g., hardcoded `true` for range checks) can lead to unreachable code branches in tests.
**Action:** When testing combat utilities, verify that each style's specific requirement (one-handed vs two-handed, ranged vs melee) is correctly enforced. Use `eslint-disable max-lines` if the test file or config file exceeds the 200-line limit.

## 2026-02-06 - [Hook Testing & Mock Path Sensitivity]
**Learning:** When testing hooks like `useCharacterData`, all dependencies (Supabase, Auth, Toast, etc.) must be mocked using `vi.mock()` BEFORE importing the module under test. Vitest is sensitive to the import path; if the source uses a relative path like `../lib/logger`, the mock in the test file should ideally match or use a correctly resolving path.
**Action:** Always place `vi.mock()` calls at the top of the test file, immediately after importing testing utilities but before project-specific imports. Ensure `vitest.config.ts` is updated in both `include` and `coverage.include` for new hook tests.

## 2025-05-30 - [Environmental Hazards Bug Fixes]
**Learning:** Found two bugs in `environmentalHazards.ts`: 1) Incorrect proficiency bonus calculation at level 4 (was +3, should be +2). 2) Shallow copy mutation in `applyHazardEffects` where nested `hitPoints` object was being modified directly.
**Action:** Always use `Math.floor((level - 1) / 4) + 2` for D&D 5e proficiency bonus. Ensure deep copies or nested spread operators when updating character state in utility functions to avoid side effects in React.

## 2025-06-10 - [Racial Utilities Coverage & Bug Fix]
**Learning:** Found that `applyRacialBonuses` only applied bonuses to abilities already present in the `baseScores` object because it used `Object.keys(baseScores)`. This could lead to missing bonuses if the character object was partial. Also learned that `vitest.config.ts` is strictly limited to 200 lines and requires `/* eslint-disable max-lines */` if it grows, and that `import()` type annotations are forbidden by lint rules.
**Action:** Always iterate over an exhaustive list of known ability names when applying bonuses to ensure completeness. Use top-level `import type` instead of inline `import()` for TypeScript types.

## 2025-05-31 - [Reaction System Coverage & Flaky Test Fix]
**Learning:** Found that `reactionSystem.ts` was completely untested despite containing critical D&D 5e mechanics. Also discovered a flaky test in `fightingStyles.test.ts` where `applyGreatWeaponFighting` relied on `Math.random()` without mocking, causing intermittent failures if the reroll result was the same as the original.
**Action:** When testing features that involve randomness (like damage rerolls), always mock `Math.random()` or the underlying dice engine to ensure deterministic results. Comprehensive testing of reaction triggers requires careful mocking of the `CombatEncounter` state, especially participant conditions and resources.

## 2024-05-24 - [Character Save Coverage & Supabase Mocks]
**Learning:** `useCharacterSave` manages complex persistence via Supabase RPC and standard table updates. Testing revealed that forgetting to mock `.upsert()` or `.select()` in the `from()` chain causes tests to fail with "not a function" errors. Also, async background image generation (not awaited in the hook) requires `waitFor` in tests to verify side effects like toasts.
**Action:** Always provide a robust mock for the Supabase client that includes all used chainable methods (`upsert`, `select`, `rpc`, etc.). Use `.tsx` for hook tests that require a `QueryClientProvider` and use `waitFor` to verify async side effects that are fire-and-forget in the source code.

## 2024-05-24 - [Downtime Utilities & Truthy Bugs]
**Learning:** Found that `downtimeActivities.ts` was completely untested and contained several truthy bugs where `0` gold or `0` experience would cause logic skips. Also discovered a bug in the `use-downtime-activities.ts` hook where materials were being added to gold instead of subtracted.
**Action:** Always use explicit nullish checks (`!== undefined`) for numeric fields in D&D logic. Ensure that resource deduction in hooks accurately reflects whether a value is a cost or a gain. Use `eslint --fix` to resolve complex `import/order` issues and add large utility files to the `max-lines` override section in `eslint.config.js`.

## 2026-02-10 - [Local Storage Hooks Coverage]
**Learning:** `useLocalStorage` handles booleans by storing them as "1" or "0" strings, which needs specific test cases. Cross-tab synchronization via `StorageEvent` and SSR safety are critical logic paths for these hooks.
**Action:** When testing storage hooks, mock `Storage.prototype.setItem` and `getItem` to simulate errors (like quota exceeded) and verify that the hook state remains consistent even if persistence fails. Always add new hooks to both `include` and `coverage.include` in `vitest.config.ts`.

## 2024-05-24 - [Death Saves Coverage]
**Learning:** Found that `deathSaves.ts` was completely untested despite containing critical combat state machine logic. Discovered strict `import/order` lint rules in tests that require local modules to be imported before aliased type definitions.
**Action:** When adding new combat utility tests, ensure the source file is registered in both `include` and `coverage.include` in `vitest.config.ts`. Use `npx eslint --fix` to resolve complex import ordering issues automatically.

## 2024-05-24 - [Combat Detection Coverage & Bug Fixes]
**Learning:** Found that `combatDetection.ts` was completely untested and contained two critical bugs: 1) Fractional Challenge Ratings (e.g., "1/4") as strings caused `NaN` in initiative modifier calculations. 2) The generic "damage" keyword was missing from the matching list, causing detection to fail on simple phrases like "You take 10 damage".
**Action:** Always implement robust string-to-number parsing that handles fractions when dealing with D&D stats. When testing keyword-based detection, include variations that split keywords with numbers or other words to verify the matching logic's flexibility. Ensure new tests and modules are added to `vitest.config.ts`'s explicit `include` and `coverage.include` arrays.

## 2025-06-15 - [Magic Item Effects Coverage & Bug Fixes]
**Learning:** Found that `magicItemEffects.ts` was completely untested. Discovered several bugs: 1) `getMagicAttackBonus` and others would ignore items with `magicBonus: 0` even if specific effects were present. 2) Attunement logic allowed characters with missing fields (e.g. no class) to bypass restrictions. 3) Generic `magicBonus` fallback was too aggressive, applying to all bonus types regardless of item type.
**Action:** When testing magic items, ensure coverage for multiple simultaneous requirements (race + class). Implement smarter fallback logic for generic `magicBonus` based on `magicItemType`. Always verify that new tests and modules are added to `vitest.config.ts`'s explicit `include` and `coverage.include` arrays. Use `/* eslint-disable max-lines */` for test files that exceed the 200-line project limit.

## 2025-06-20 - [Mass Combat Utilities Coverage]
**Learning:** `src/utils/massCombat.ts` contains critical army management and battle resolution logic but had zero test coverage. The logic includes complex dice parsing and morale calculations that benefit from deterministic mocking.
**Action:** Mock `rollDice` to test hit/miss and damage scenarios. Ensure edge cases like out-of-bounds movement and zero-unit armies are covered.

## 2024-05-24 - [Class Features Coverage & Scaling Logic]
**Learning:** `src/utils/classFeatures.ts` contains complex ternary-based scaling logic for class features (e.g., Barbarian Rage uses, Bardic Inspiration dice) that can be easily misread. Testing revealed that coverage tools are sensitive to branch coverage even when all lines are executed, requiring specific tests for each threshold.
**Action:** When testing level-based scaling, always include test cases for the exact threshold levels (e.g., if logic is `level < 3 ? 2 : 3`, test levels 2 and 3). Ensure that large utility files and their tests are added to the `max-lines` override list in `eslint.config.js` to maintain lint compliance while allowing comprehensive suites.

## 2025-06-25 - [Message Hook Coverage & Vitest JSX]
**Learning:** The `useMessages` hook manages chat history with pagination and deduplication. Testing revealed that `vitest.config.ts` requires explicit registration of both the test file and the source file for coverage to work. Also discovered that tests using JSX (like `QueryClientProvider`) must use the `.tsx` extension, or they will fail with a syntax error during SWC transformation.
**Action:** When testing hooks that use React Query, wrap them in a `QueryClientProvider` and use `.tsx` for the test file. Ensure that overlapping message IDs are tested to verify deduplication logic in the hook's `useEffect`.

## 2026-02-12 - [Combat Actions Hook Coverage & Concentration Mocking]
**Learning:** The `useCombatActions` hook orchestrates complex combat state transitions and integrates with multiple other hooks (AI, Mechanics, Session). Testing revealed that `checkConcentration` from `@/utils/spell-management` must be explicitly mocked to return `true` in general damage tests, as a default mock returning `undefined` causes `!undefined` to evaluate to `true`, resulting in unintended concentration loss.
**Action:** When testing hooks that manage concentration, always provide a default successful return value for `checkConcentration` in the `beforeEach` block. Use fake timers to test turn advancement in `handleEnemyAttack` as it uses `setTimeout`. Always verify both `include` and `coverage.include` arrays in `vitest.config.ts` are updated for new hook tests.

## 2026-02-12 - [Area-of-Effect Template Calculations Coverage]
**Learning:** `src/utils/template-calculations.ts` contains critical D&D 5e math for spell templates (cones, spheres, etc.) and grid-based distance rules. Testing it revealed that coordinate generation for shapes like cones and spheres requires precise math (direction corrections, arc steps) to match battle map grid square selection.
**Action:** Always test AoE utilities with both pixel-perfect coordinate checks and grid-square occupancy checks (`getAffectedGridSquares`). Ensure new tests and source files are registered in BOTH `include` and `coverage.include` arrays in `vitest.config.ts`.

## 2026-02-12 - [Magic Item Attunement Hook Coverage]
**Learning:** The `useMagicItemAttunement` hook manages the state of magic item attunement for a character. Testing revealed that it correctly enforces D&D 5e RAW for the 3-item attunement limit and requirement validation (class, race, alignment) via the `magicItemEffects` utility.
**Action:** When testing hooks that manage character state, always provide a mock `onCharacterUpdate` callback and verify it is called with the expected deep-copied and updated character object. Ensure new hook tests are registered in BOTH `include` and `coverage.include` arrays in `vitest.config.ts`.

## 2026-02-19 - [Session Utilities Coverage & Strict Predicates]
**Learning:** Found that `isValidSession` was returning `null` instead of `false` when passed `null`, due to the behavior of the `&&` operator in JavaScript. While technically falsy, this violated the expected boolean return type of the predicate.
**Action:** Use the double-bang operator (`!!`) for type predicates that rely on logical AND chains to ensure a strict boolean return. Always verify hook and utility coverage by adding both the test file and source file to `vitest.config.ts`.

## 2026-02-20 - [Message Queue Hook Coverage & Retry Bug Detection]
**Learning:** The `useMessageQueue` hook manages complex message persistence with exponential backoff and batching. Testing revealed a potential bug where a failure in batch processing after a successful single message insertion could cause the original message to be retried, potentially leading to primary key violations in Supabase.
**Action:** Always use `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync()` to test hooks with retry logic and exponential backoff. Ensure that mocks for chainable services like Supabase return stable objects or use `vi.hoisted` to avoid mismatched mock instances. Add new hook tests to both `include` and `coverage.include` in `vitest.config.ts`.

## 2026-02-20 - [Pending Rolls Hook Coverage & Parser Fixes]
**Learning:** Found that `usePendingRolls` was completely untested. Testing revealed a bug in `parseRollRequests` where simple DC mentions in parentheses like "(DC 15)" were being incorrectly captured as dice formulas (resulting in "1d20"). Also found that the deduplication logic in the parser was keeping the first match regardless of confidence, which could lead to lower-quality results being returned.
**Action:** Use negative lookahead in regex to exclude DC-only patterns from formula capture. Sort by confidence before applying unique filters in the parser. Always verify hook coverage by adding both the test and the source file to `vitest.config.ts`.
