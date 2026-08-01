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
**Action:** When testing storage hooks, mock `Storage.prototype.setItem` and `getItem` to simulate errors (like query exceeded) and verify that the hook state remains consistent even if persistence fails. Always add new hooks to both `include` and `coverage.include` in `vitest.config.ts`.

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

## 2026-03-24 - [Asset Key Generation & Accent Normalization]
**Learning:** Found that `generateAssetKey` in `src/utils/asset-key.ts` was completely untested and lacked normalization for accented characters (e.g., `Faerûn` became `faern`). This would cause failures when matching entities with accents in asset tags.
**Action:** Always include normalization (`.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')`) in slugging or key generation utilities to ensure robustness with D&D names. Added comprehensive coverage for `asset-key.ts` reaching 100% statement and branch coverage. Verified that it squashes non-alphanumeric special characters consistent with `slugify`.

## 2026-02-12 - [Combat Actions Hook Coverage & Concentration Mocking]
**Learning:** The `useCombatActions` hook orchestrates complex combat state transitions and integrates with multiple other hooks (AI, Mechanics, Session). Testing revealed that `checkConcentration` from `@/utils/spell-management` must be explicitly mocked to return `true` in general damage tests, as a default mock returning `undefined` causes `!undefined` to evaluate to `true`, resulting in unintended concentration loss.
**Action:** When testing hooks that manage concentration, always provide a default successful return value for `checkConcentration` in the `beforeEach` block. Use fake timers to test turn advancement in `handleEnemyAttack` as it uses `setTimeout`. Always verify both `include` and `coverage.include` arrays in `vitest.config.ts` are updated for new hook tests.

## 2026-02-12 - [Area-of-Effect Template Calculations Coverage]
**Learning:** `src/utils/template-calculations.ts` contains critical D&D 5e math for spell templates (cones, spheres, etc.) and grid-based distance rules. Testing it revealed that coordinate generation for shapes like cones and spheres requires precise math (direction corrections, arc steps) to match battle map grid square selection.
**Action:** Always test AoE utilities with both pixel-perfect coordinate checks and grid-square occupancy checks (`getAffectedGridSquares`). Ensure new tests and source files are registered in BOTH `include` and `coverage.include` arrays in `vitest.config.ts`.

## 2026-02-12 - [Magic Item Attunement Hook Coverage]
**Learning:** The `useMagicItemAttunement` hook manages the state of magic item attunement for a character. Testing revealed that it correctly enforces D&D 5e RAW for the 3-item attunement limit and requirement validation (class, race, alignment) via the `magicItemEffects` utility.
**Action:** When testing hooks that manage character state, always provide a mock `onCharacterUpdate` callback and verify it is called with the expected deep-copied and updated character object. Ensure new hook tests are registered in BOTH `include` and `coverage.include` arrays in `vitest.config.ts`.

## 2026-02-27 - [Voice Mapper Service Coverage & Heuristics]
**Learning:** `VoiceMapper` uses a keyword-based matching system where the priority is determined by the order of keys in `CHARACTER_KEYWORDS`. For example, 'monster' is checked before 'guard', so 'dragon captain' matches 'monster'. Also, the `debugAndClearCharacter` method deletes a mapping but immediately re-saves it by calling `getVoiceForCharacter`.
**Action:** When testing priority-based matching, verify the expected override behavior based on the defined keyword order. Use spies to verify that deletion from `localStorage` actually occurs if the subsequent re-save is the intended side effect of the debug method.

## 2026-02-19 - [Session Utilities Coverage & Strict Predicates]
**Learning:** Found that `isValidSession` was returning `null` instead of `false` when passed `null`, due to the behavior of the `&&` operator in JavaScript. While technically falsy, this violated the expected boolean return type of the predicate.
**Action:** Use the double-bang operator (`!!`) for type predicates that rely on logical AND chains to ensure a strict boolean return. Always verify hook and utility coverage by adding both the test file and source file to `vitest.config.ts`.

## 2026-02-20 - [Message Queue Hook Coverage & Retry Bug Detection]
**Learning:** The `useMessageQueue` hook manages complex message persistence with exponential backoff and batching. Testing revealed a potential bug where a failure in batch processing after a successful single message insertion could cause the original message to be retried, potentially leading to primary key violations in Supabase.
**Action:** Always use `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync()` to test hooks with retry logic and exponential backoff. Ensure that mocks for chainable services like Supabase return stable objects or use `vi.hoisted` to avoid mismatched mock instances. Add new hook tests to both `include` and `coverage.include` in `vitest.config.ts`.

## 2026-02-20 - [Pending Rolls Hook Coverage & Parser Fixes]
**Learning:** Found that `usePendingRolls` was completely untested. Testing revealed a bug in `parseRollRequests` where simple DC mentions in parentheses like "(DC 15)" were being incorrectly captured as dice formulas (resulting in "1d20"). Also found that the deduplication logic in the parser was keeping the first match regardless of confidence, which could lead to lower-quality results being returned.
**Action:** Use negative lookahead in regex to exclude DC-only patterns from formula capture. Sort by confidence before applying unique filters in the parser. Always verify hook coverage by adding both the test and the source file to `vitest.config.ts`.

## 2026-02-23 - [Geometry & Lighting Utilities Coverage]
**Learning:** The `lineSegmentsIntersect` function in `geometry.ts` uses strict inequalities, meaning it returns `false` if segments touch at an endpoint. To test polygon closing segments in `isLineBlocked`, a wall must have more than 2 points and the line must intersect ONLY the segment connecting the last point to the first.
**Action:** Always include both the test file and the source module in `vitest.config.ts`'s explicit `include` and `coverage.include` arrays. Use `eslint --fix` to handle complex import ordering requirements (vitest > local modules > alias types).

## 2026-02-23 - [Dice Roll Request Coverage]
**Learning:** Found that `DiceRollRequest.tsx` had complex logic for deriving ability modifiers from both purpose text and formula strings, which was completely untested. Discovered a testing gotcha where `lucide-react` icons in buttons can cause "multiple elements found" errors when querying by button text, because icons often have accessibility titles that match the text.
**Action:** Always use exact regex boundaries when querying for buttons with icons, e.g., `screen.getByRole('button', { name: /^advantage$/i })`. Ensure coverage for both purpose-based and formula-based ability detection.

## 2026-02-23 - [Vision Calculations Bug Fix & Coverage]
**Learning:** Found a bug in `canSeeToken` where vision modes other than `basic` and `darkvision` (like `tremorsense`, `blindsight`, `truesight`) were incorrectly returning `true` in total darkness even when the target was outside their special range/conditions. This was because the light level check only explicitly handled `basic` and `darkvision`.
**Action:** Always ensure light level requirements are checked for all vision types when they are outside their special-case logic blocks. Added comprehensive test coverage for `vision-calculations.ts` reaching 100% line coverage.

## 2026-02-24 - [Combat Pattern Detection Coverage & Bug Fixes]
**Learning:** Found that `dm-response-patterns.ts` was completely untested and contained several critical bugs: 1) Negative modifiers (e.g., "-1", "-dex") were ignored by regex. 2) Plain number damage (e.g., "10 damage") was missed in favor of only dice formulas. 3) Multi-word skills (e.g., "Sleight of Hand") and parenthesized skills (e.g., "Wisdom (Perception)") caused detection failure. 4) Strict whitespace requirements in AC/DC mentions missed common formats like "AC: 15" or "DC is 12".
**Action:** When implementing heuristic-based narrative detection, use flexible regex patterns that allow for optional colons, varied whitespace, and common filler words (like "is"). Always test for both positive and negative numeric transitions. Added comprehensive test coverage for `dm-response-patterns.ts` reaching 100% statement and branch coverage.

## 2026-02-24 - [Advanced Spellcasting Hook Coverage]
**Learning:** Found that `useAdvancedSpellcasting` hook had zero test coverage. Testing revealed that state updates in hooks using `useState` without functional updates (e.g., `setSelectedMetamagic([...selectedMetamagic, optionId])`) can lead to race conditions in tests if multiple updates are triggered within the same `act` block.
**Action:** In tests, wrap each sequential state-changing call in its own `act` block to ensure React has processed the state transition before the next call. Always verify hook coverage by adding both the test and the source file to `vitest.config.ts`.

## 2026-02-25 - [AI Response Logic Coverage]
**Learning:** The AI response logic was recently refactored into `src/hooks/ai/` but lacks unit tests for the extracted modules. `game-phase-updater.ts` and `roll-processor.ts` contain critical state transition and dice roll parsing logic that impacts the core game loop.
**Action:** Implement comprehensive unit tests for `game-phase-updater.ts` and `roll-processor.ts`. Ensure `vitest.config.ts` is updated to include these new tests and track their coverage.

## 2024-05-24 - [Campaign Assets Hook Coverage & Concurrent Mocks]
**Learning:** Found that `use-campaign-assets.ts` was completely untested. Testing it required mocking concurrent Supabase calls to multiple tables (`starter_character_templates`, `campaign_chunks`, `starter_campaigns`). Discovered that using `vi.mockImplementation((table: string) => { ... })` is the most effective way to handle diverse chained operations across different tables in a single `Promise.all` block.
**Action:** When testing hooks that perform concurrent database queries, use a single `mockImplementation` on the `from` method to return specialized mock objects based on the table name. Always verify that normalization logic for keys (like `generateKey`) handles special characters and Unicode quote variants.

## 2026-02-26 - [Grid Snapping & Hex Calculation Bug]
**Learning:** Found that `grid-snapping.ts` was completely untested. Identified a bug in `hexToWorld` for flat-top hexagons where `gridSize` was not applied to the entire $y$ coordinate calculation, leading to incorrect positioning when `gridSize` is not 1.
**Action:** Always verify coordinate conversion logic with non-unit scale (e.g., `gridSize = 100`) to catch scaling bugs. Ensure parentheses are used correctly to distribute multipliers across all terms in a coordinate formula.

## 2026-03-04 - [Dice Roll Message Coverage & RTL Disambiguation]
**Learning:** Found that `DiceRollMessage.tsx` was completely untested. Discovered a testing gotcha where "Natural 1" and "Natural 20" labels appear in both the critical result badge and the special d20 callout badge, causing "multiple elements found" errors in React Testing Library when using `getByText`. Also learned that running the full test suite from the root requires `bun install` in `server-bun/` to resolve backend-only dependencies like `pino`.
**Action:** Use `getAllByText` and verify length or presence when labels appear in multiple badges within the same component. Always ensure that `vitest.config.ts` includes both the test path and the source path for proper coverage tracking.

## 2025-06-26 - [Class Mechanics Logic Bugs]
**Learning:** Found several bugs in `src/utils/classMechanics.ts`: 1) `canUseSneakAttack` ignored advantage/disadvantage and distance. 2) `deactivateRage` incorrectly removed pre-existing resistances. 3) `getDivineSmiteDamage` exceeded the 5d8 maximum for high-level slots. 4) `isIncapacitated` missed the explicit 'incapacitated' condition.
**Action:** Always verify D&D 5e RAW (Rules As Written) when testing class features. Use comprehensive tests that cover pre-existing states (like resistances) and cap limits (like Smite damage). Ensure all condition-checkers include the name of the condition they are checking for.

## 2026-03-05 - [Voice Services Coverage & Regex Fixes]
**Learning:** Found that `detectVoiceCategoryFromNPCType` incorrectly prioritized descriptors like "ancient" (elder) over "dragon" (creature). Also discovered that dialogue parsing regex failed on smart quotes (`“”`) and names with apostrophes (e.g., "Drizzt Do'Urden").
**Action:** Always check for monstrous/creature keywords before generic descriptors in D&D NPC detection. Use `[\w']` and `["“]` patterns in narrative parsing to handle literary formatting and fantasy names. Use `import * as mod from '...'` with `vi.spyOn` to mock sibling exports in Vitest.

## 2026-03-24 - [Vision Polygon Coverage & Convex Hull Logic]
**Learning:** Found that `vision-polygon.ts` was already registered in `coverage.include` but had zero tests. Testing revealed that the `mergeVisionPolygons` function uses a convex hull approximation (Graham scan) which is efficient but can over-represent the shared vision area compared to a true polygon union.
**Action:** When testing geometry-heavy utilities, use mocked dependencies for coordinate-heavy functions like raycasting to focus on the logic of the module under test. Ensure that unused imports in test files are removed to comply with strict `@typescript-eslint/no-unused-vars` rules.

## 2026-03-15 - [Condition Icons Coverage]
**Learning:** `condition-icons.ts` provides critical visual mapping for the battle map but had zero test coverage. The logic for sorting conditions by priority and determining the primary condition (lowest priority number) is offensive for correct token rendering.
**Action:** Always verify that visual utility functions are tested for both standard and edge cases (empty arrays, unknown types). Added comprehensive coverage for `condition-icons.ts` and included `condition-definitions.ts` in coverage reports as it's a key dependency for the condition system.

## 2026-02-27 - [Blog Hooks & Cache Management Coverage]
**Learning:** The blog system hooks (`useBlogPosts`, `useBlogMedia`) manage complex state via React Query. Testing revealed the importance of verifying manual cache updates (`setQueryData`) and invalidations (`invalidateQueries`) after mutations to ensure UI consistency. Also learned that `useDeleteBlogMedia` uses optimistic updates with a rollback mechanism that must be verified by mocking service failures.
**Action:** When testing hooks that use React Query, always provide a fresh `QueryClient` per test and spy on its methods (`invalidateQueries`, `setQueryData`, `removeQueries`) to verify side effects. Ensure that `vitest.config.ts` is updated to include both the test file and the source module for accurate coverage reporting.

## 2026-02-13 - [Dice Engine Coverage & rpg-dice-roller 5.x Gotchas]
**Learning:** Found that `DiceEngine.ts` was under-tested. During testing, discovered that `@dice-roller/rpg-dice-roller` v5.x includes both die results and grouping objects in its `rolls` array. Also learned that advantage/disadvantage flags should be explicitly initialized to `false` rather than `undefined` to ensure consistent API responses and simplify test assertions.
**Action:** When iterating over `roll.rolls` from `rpg-dice-roller`, always check for the existence of the `sides` property to distinguish between actual die rolls and result groups. Ensure boolean flags in result objects are explicitly cast or defaulted (e.g., `!!val || false`). Added comprehensive coverage for `DiceEngine.ts` reaching 99% line coverage.

## 2026-04-05 - [GameContextBuilder Coverage & Type Mismatch]
**Learning:** Found that `GameContextBuilder` in `src/utils/context/builder.ts` was completely untested. Testing revealed a bug where memory types were being filtered using `'character'` and `'plot'` strings, which did not match the actual `MemoryType` enum values used in the system (`'npc'` and `'plot_point'`).
**Action:** When testing data aggregators, verify that all filtering criteria (like `type` or `status`) match the actual values present in the database or defined in TypeScript enums. Ensure that `vitest.config.ts` includes both the new test file and the source module for accurate coverage reporting.

## 2025-02-14 - [Condition Definitions Coverage]
**Learning:** Found that `condition-definitions.ts` was completely untested. Testing revealed that the `unconscious` condition implements a catch-all `autoFail: true` for any `rollType` that isn't exactly `defense`, effectively covering actions, saves, and ability checks in one branch.
**Action:** When testing conditions, ensure to verify all relevant `rollType` values (attack, defense, saves, ability_check) as many conditions have specialized logic for each. Always add new tests to both `include` and `coverage.include` in `vitest.config.ts`.

## 2026-03-24 - [Pathfinding Mode-Awareness & Regex Branch Coverage]
**Learning:** Found that `calculatePath` in `src/utils/movement-navigation.ts` was not mode-aware, causing flyers to path around walls instead of through them. Also identified uncovered branches in `regex-parser.ts` related to DC context detection in simple skill patterns and non-standard formula fallbacks.
**Action:** When implementing pathfinding, always ensure the search loop uses the same capability-based mode detection as the reachable area calculation. Use inclusive checks for DC context windows (`text.slice(match.index)`) to ensure nearby DC mentions are captured for skill checks without explicit parentheses.

## 2026-04-10 - [Multiclass Spell Validation Coverage]
**Learning:** The `validateMulticlassSpellSelection` utility handles the delegation between single-class and multiclass spellcasting rules. Testing revealed that it correctly generates warnings for multiclass caster levels and Pact Magic slot separation, which are critical D&D 5e mechanics.
**Action:** When testing multiclass utilities, ensure to mock the `getEnhancedSpellcastingInfo` to return various `multiclassInfo` states (including Pact Magic) to verify that the UI-facing warnings are correctly populated. Always add both the test file and the source module to `vitest.config.ts` to maintain coverage thresholds.

## 2026-04-11 - [Dice Utility Coverage & Mocking Improvements]
**Learning:** Found that `src/utils/diceRolls.ts` had several untested exported functions for detailed roll reporting and rerolling. Also discovered that previous tests were using a risky strategy of replacing the global `Math` object instead of using Vitest's `vi.spyOn(Math, 'random')`.
**Action:** Use `vi.spyOn(Math, 'random')` for deterministic dice roll testing to avoid global state leakage. Ensure that "detailed" variants of utility functions (which return objects instead of just numbers) have explicit tests for all returned properties.

## 2026-04-30 - [ChatInput Component Coverage]
**Learning:** Testing the `ChatInput` component revealed nuances in `user-event` (v14+) keyboard mapping. For Shift+Enter, the pattern `{Shift>}{Enter}{/Shift}` is required to correctly simulate holding the shift key. Also, when mocking specialized UI components like `Textarea`, using `React.forwardRef` is essential to maintain compatibility with internal `useRef` usage in the component under test.
**Action:** Use `user.keyboard('{Shift>}{Enter}{/Shift}')` for Shift+Enter sequences. Always wrap functional component mocks in `React.forwardRef` if the original component expects a ref.

## 2026-05-20 - [SpellApi Service Coverage & Singleton Mocking]
**Learning:** The `SpellApiService` is exported as a singleton and maintains internal state (`useLocalFallback`). Tests must manually reset this state in `beforeEach` to ensure isolation. Also confirmed that `spellApi` maps server-side snake_case-adjacent responses to camelCase frontend models, often providing defaults for optional fields like `materialComponents`.
**Action:** When testing singletons with internal state, use type casting `(service as any).property = value` in `beforeEach` to reset state. Ensure that `vitest.config.ts` is updated in both `include` and `coverage.include` for new service tests. Add large test files to `eslint.config.js`'s `max-lines` override list to maintain lint compliance.

## 2026-02-27 - [AI Context Builder Coverage]
**Learning:** Found that ContextBuilder in src/services/ai/context-builder.ts was completely untested despite being the primary orchestrator for AI prompts. Testing revealed that it correctly switches between opening scene logic and regular narrative flow based on the isFirstMessage flag, and integrates combat/voice contexts conditionally.
**Action:** Always include both the test file and the source module in vitest.config.ts's explicit include and coverage.include arrays to ensure visibility. Use mocked prompt builders to focus on the orchestration logic of the builder itself.

## 2026-05-12 - [conversation-service Coverage & Bug Fix]
**Learning:** Found that `saveChatMessage` in `conversation-service.ts` had a redundant try-catch block causing double-logging of errors. Also noticed `getConversationHistory` was missing `sequence_number` in its select clause, despite using it for ordering.
**Action:** Implement unit tests with Supabase chain mocks. Remove the redundant try-catch to ensure single-point error logging. Standardize select clauses across AI services.

## 2024-05-16 - [Chat Hooks Coverage & Logger Mocking]
**Learning:** Implemented tests for `useChatHistory` and `useChatPersistence`. Discovered that when mocking `@/lib/logger`, assertions must match the import style. If using `import logger from '@/lib/logger'`, the mock should be accessed as `logger.info` rather than `logger.default.info` in tests if the mock setup returns an object that represents the default export. Also verified that `useChatPersistence` uses an exponential backoff for message verification which requires `vi.useFakeTimers()` and `vi.advanceTimersByTime()` for reliable testing.
**Action:** When mocking utilities with both default and named exports, ensure the mock structure in `vi.mock` matches the expected consumer's usage. Always add both the test file and the source module to `vitest.config.ts` to maintain coverage thresholds.

## 2026-05-20 - [Lighting Mechanics Coverage & Bug Fixes]
**Learning:** Implemented comprehensive unit tests for `src/utils/lighting/mechanics.ts` in `src/utils/lighting/__tests__/mechanics.test.ts`. Found two bugs: (1) one-sided shadows caused by an incorrect dot product check in `castShadowFromSegment`, and (2) an off-by-one error in `calculateAmbientOcclusion` that skipped the closing segment of polygon walls. Achieved 100% statement and line coverage.
**Action:** Always include both the test file and the source module in `vitest.config.ts`'s explicit `include` and `coverage.include` arrays. Use `await import()` inside `async it` blocks to localized behavior changes for global mocks.

## 2026-05-28 - [Dice Formula Normalization & Idempotency Fix]
**Learning:** Found that `normalizeFormula` in `src/utils/roll-request/formula-utils.ts` was not idempotent. When a formula already contained `+modifier` (a standard internal representation), a second pass would aggressively strip the `modifier` keyword, leaving a trailing operator that was then also stripped, effectively reverting the formula to `1d20`.
**Action:** Use negative lookbehind in regex (`(?<![+\-*/])modifier`) to ensure keywords are only stripped when they are NOT part of a valid mathematical expression. Always test for idempotency (repeated function calls) when implementing normalization utilities.

## 2024-05-24 - [Session State Service Coverage]
**Learning:** Added comprehensive tests for `SessionStateService`. Found that achieving 100% branch coverage required specifically testing the case where `combatLog` is missing from the state returned by Supabase, as the `||` operator in `const existing = current.combatLog || [];` creates a branch. Also confirmed that mocking static class methods with `vi.spyOn` is effective for testing methods that depend on other methods in the same class (e.g., `updateState` calling `getState`).
**Action:** When testing services with JSONB columns, always test scenarios with missing or null fields to verify fallback logic. Use `vi.setSystemTime` to stabilize ISO strings in persisted state. Ensure new tests and modules are added to `vitest.config.ts`'s explicit `include` and `coverage.include` arrays.

## 2026-06-04 - [Safety Audit Service Coverage & Bug Fix]
**Learning:** Found that `SafetyAuditService` was missing a pause transition for the `x_card` command in its audit log. Although `SafetyResponseFactory` indicates that `x_card` should pause the game, the audit log was only explicitly setting `is_paused_after` to `true` for the `pause` command type.
**Action:** Ensure that audit logging logic covers all command types that result in a state change. In `SafetyAuditService`, updated `is_paused_after` calculation to include `x_card`. Verified truncation logic for long messages (1000 chars for messages, 500 for context) in the new test suite.

## 2026-02-14 - [Auth TokenService Coverage]
**Learning:** Found that `TokenService.ts` was completely untested despite handling critical session persistence and JWT logic. Discovered that testing environment-specific code (like `typeof window`) in JSDOM is difficult as `window` is always defined. Also confirmed that strict `import/order` lint rules require local relative imports to be grouped separately from aliased imports.
**Action:** When testing services that use both `localStorage` and `sessionStorage`, use `vi.stubGlobal` to provide clean mocks for each test. Ensure new tests are registered in BOTH `include` and `coverage.include` arrays in `vitest.config.ts`. Use `npx eslint` on specific files to find and fix import ordering issues before submission.

## 2026-07-26 - [Local Spell Service Coverage & Multiclassing Logic]
**Learning:** Found that `localSpellService.ts` was completely untested. It contains critical D&D 5e multiclassing logic, including caster level calculations and spell slot tables. Identified that the current implementation of `getMulticlassSpellSlots` is limited to level 5, and anything above that currently fallbacks to level 1 behavior.
**Action:** Always include both the test file and the source module in `vitest.config.ts`'s explicit `include` and `coverage.include` arrays. Added comprehensive tests for all `LocalSpellService` methods, including mixed multiclass scenarios (full, half, third, and pact casters) and spell filtering logic.

## 2026-06-16 - [Character Background Generator Case-Sensitivity Fix]
**Learning:** Found that `createImagePrompt` in `character-background-generator.ts` was using case-sensitive checks for character race and class (e.g., `race.includes('elf')`), which failed when character data contained capitalized names like "Elf".
**Action:** Always use `.toLowerCase()` when performing substring searches on character attributes for heuristic-based logic like prompt generation or theme selection.

## 2026-02-12 - [Supabase Chained Mocks & Type Safety]
**Learning:** Found that chained Supabase calls (e.g., multiple `.order()` calls) require the mock to return a chainable object (using `.mockReturnThis()`) for all intermediate calls. Also discovered that `LoreKeeperService` was using `any` in its mapping functions, which triggered strict linting errors.
**Action:** When mocking complex Supabase chains, ensure every method in the chain returns the mock object until the final `.then()` or `.single()`. Always use `Record<string, unknown>` instead of `any` for database row mappings to satisfy `@typescript-eslint/no-explicit-any`.

## 2026-06-25 - [TimelineRail Component Coverage & UI Mocking]
**Learning:** The `TimelineRail` component relies heavily on browser APIs like `IntersectionObserver`, `requestAnimationFrame`, and `CSS.escape`. In a JSDOM environment, these must be explicitly mocked to test scroll-based interactions and visibility tracking.
**Action:** Always provide a robust mock for `IntersectionObserver` and stub `requestAnimationFrame` with a `setTimeout` based fallback when testing components with complex scroll behavior. Ensure `CSS.escape` is mocked if the component uses it for dynamic ID selection.

## 2026-06-21 - [LlmApiClient Coverage & Mocking Patterns]
**Learning:** Found that LlmApiClient maintains an internal circuit-breaker state (useOfflineFallback) that persists across tests because it's a singleton. Testing it requires manual reset of this private state. Also learned that vi.useFakeTimers() is essential for testing its exponential backoff retry logic for 404 errors during image attachment. When mocking the @/lib/logger, use vi.mock to return an object with both default and logger properties to handle different import styles used in the codebase.
**Action:** Always reset singleton state in beforeEach using (service as any).property = value. Use await vi.runAllTimersAsync() and await Promise.resolve() to reliably progress async retry loops in tests.

## 2026-08-14 - [Response Service Coverage & Thenable Mocks]
**Learning:** The `EnvironmentGenerator` and `OpportunityGenerator` services were completely untested. Testing `OpportunityGenerator` required mocking Supabase queries that are awaited directly (using `.then()` behavior). Deeply nested tests in `src/agents/services/response/__tests__` must use `../../../../lib/logger` to reach the lib directory.
**Action:** Use `then: vi.fn().mockImplementation((cb) => cb({ data, error }))` when mocking Supabase clients for direct awaits. Always verify that new tests and source files are registered in both `include` and `coverage.include` in `vitest.config.ts`.

## 2026-08-16 - [Verbalized Sampling Parser Coverage]
**Learning:** The `Verbalized Sampling Parser` uses complex heuristics for AI response deduplication and fallback extraction. Achieving high coverage requires carefully crafted multi-paragraph inputs that trigger specific regex paths (like scene splitters) and length-based thresholds (200 chars for sections, 2500 chars for truncation).
**Action:** When testing heuristic parsers, use varied input lengths and structures (with/without options, with/without XML tags) to verify fallback robustness. Always add `/* eslint-disable max-lines */` to test files exceeding 200 lines to comply with strict project linting.

## 2026-08-17 - [World Update Processor Coverage]
**Learning:** Found that `world-update-processor.ts` lacked dedicated unit tests after being surgically extracted from the monolithic DM response processor. Testing revealed the importance of mocking nested service calls (MemoryManager, WorldBuilderService) with specific return values to trigger log-based assertions and ensure both XML-based and fallback extraction paths are verified.
**Action:** When testing extracted logic modules, ensure all imported services are mocked with stable return values. Use explicit log message matching to verify that conditional branches (like partial save failures or tier-based skipping) are correctly executed. Always verify that new tests are registered in BOTH `include` and `coverage.include` in `vitest.config.ts`.

## 2026-07-03 - [Account Billing Hook Coverage]
**Learning:** The `useAccountBilling` hook manages critical monetization state via fetch and React Router. Testing it requires mocking `useSearchParams` and global `fetch`. Verified that `window.location.href` assignment can be tested by mocking the global `location` object (with `configurable: true`). Achieved 100% statement and branch coverage.
**Action:** Always ensure internal async functions in hooks have explicit `: Promise<void>` return types to satisfy strict project linting. Use `act` for all asynchronous hook interactions that trigger state updates.

## 2024-05-25 - [Damage Calculation Coverage & Order of Operations]
**Learning:** Added 100% test coverage for `src/services/combat/damage-calculation.ts`. Verified the D&D 5e rule where resistance is applied (and rounded down) before vulnerability. For example, 11 damage with both resistance and vulnerability results in 10 damage: floor(11/2) = 5, then 5 * 2 = 10.
**Action:** When testing combat mechanics, always verify the order of operations for stacking modifiers. Ensure new tests and source files are registered in BOTH `include` and `coverage.include` arrays in `vitest.config.ts`.

## 2026-07-21 - [Combat Action Executor Coverage]
**Learning:** `combat-action-executor.ts` coordinates intent synchronization between the frontend client and backend combat status APIs. Testing it revealed that when `expectedVersion` is undefined, the executor automatically does an initial query to retrieve the current combat state version, falling back to version `1` if the state contains no explicit version data.
**Action:** When testing executors with automatic version-lookup and API intent wrapping, mock global `fetch` calls sequentially using `.mockResolvedValueOnce` to return both the status payload and subsequent wrapped intent payload. Always register the test file and module under test in BOTH `include` and `coverage.include` lists in `vitest.config.ts`.

## 2026-07-22 - [React Query Hook Refresh Event & ASI Coverage]
**Learning:** Custom hooks that consume React Query and utilize custom window events for query invalidation (like `useCampaignJournal`) can be beautifully tested using `@testing-library/react`'s `renderHook` and `waitFor`. Window-dispatched custom events can be verified by mocking or spying on global `window.removeEventListener` and dispatching actual events on `window`.
**Action:** When testing event-driven query invalidations, render within a standard `QueryClientProvider` per test, trigger the event with `window.dispatchEvent(new Event('event-name'))`, and assert against spied `queryClient.invalidateQueries` calls. Always register both the test and source paths explicitly in `vitest.config.ts`.

## 2026-07-23 - [Vitest Hoisting & Voice Profile Service]
**Learning:** Any shared mock variables referred to inside hoisted `vi.mock` modules must be declared inside a `vi.hoisted()` block, otherwise early reference errors occur during execution. Additionally, discovered that `voiceProfileService.upsertVoiceProfile` catches its own thrown database/payload exceptions internally and logs them, returning a `null` value to the caller rather than propagating/rejecting.
**Action:** When writing test suites in Vitest with hoisted mocks, always leverage `vi.hoisted` to declare spies or mock handlers cleanly. Ensure test assertions for upsert errors match the true codebase behavior of returning a `null` resolution.

## 2026-07-26 - [React Hook with Array Dependencies / Infinite Loops]
**Learning:** When writing unit tests for custom React hooks that track array/object dependencies (such as `useSpellSelectionValidation`), passing inline arrays (e.g. `selectedCantrips: ['cantrip-1']`) directly into options inside the `renderHook` callback instantiates new array references on every single render. This triggers effect hooks to loop infinitely and hang tests.
**Action:** Always supply stable array/object references from outside the `renderHook` scope, or memoize them, to ensure referential stability and prevent infinite rendering loops.

## 2026-07-27 - [Combat Start Toast Notification Coverage]
**Learning:** The combat starting sequence features stage-specific UI feedback toasts. Previously, these were completely untested. Adding a test suite required mocking `sonner`'s toast dispatchers and invoking the custom action triggers (`action.onClick`) manually in Vitest to verify callback propagation.
**Action:** Always mock `sonner` as a module, verify exact stage string matches, and manually invoke spied UI callback handlers to verify action retry triggers under test.

## 2026-07-29 - [World Builder Repository Mocking Chain]
**Learning:** Chained Supabase queries can be beautifully and lightweightly mocked using a chainable "thenable" mock builder. By returning an object that has self-referential helper methods (`select`, `eq`, `ilike`, `limit`) and a custom `then` function returning the mock promise, you can support nested chaining with standard async `await` without requiring heavy external mocking libraries.
**Action:** Use a reusable helper like `createMockChain(resolveValue)` inside test suites requiring chainable queries, resolving table-specific data dynamically.

## 2026-07-29 - [Ensure Action Options Coverage & Type-Coercion]
**Learning:** Found that the `ensure-action-options.ts` utility is crucial for repairing DM responses that lack interactive action choices, and verified its parser error boundaries. Specifically, if a non-string object/number is passed to `messageHasOptions`, the internal `rawContent.replace` call throws a `TypeError` which is correctly caught by a fallback try-catch.
**Action:** When testing heuristic utilities with try-catch fallback logic, explicitly supply invalid types (e.g. nested objects or numbers as parameters) to trigger and fully cover the catch block pathways. Always mock the underlying LLM API wrappers cleanly using `vi.mocked` to isolate network calls.

## 2026-07-31 - [Spell Validation Utilities & Mock Module Types]
**Learning:** When mocking module exports in Vitest, we can avoid `@typescript-eslint/consistent-type-imports` lint errors by importing module namespaces as types (e.g. `import type * as SpellcastingInfoModule from '...'`) and passing `typeof SpellcastingInfoModule` to `importOriginal<T>()` rather than using inline `typeof import(...)`. Additionally, testing scaling spell limits requires passing correct `spellcasting` class metadata properties to prevent level-1 fallbacks from returning empty values.
**Action:** Always import namespace types at the top level for module types inside hoisted `vi.mock` factory parameters, and supply realistic sub-objects in character class test fixtures to satisfy D&D rule conditions.

## 2026-08-01 - [Character Modifiers Alias Expertise Bug Fix & Coverage]
**Learning:** Found that custom skill modifier calculations inside `src/utils/characterModifiers.ts` failed to correctly apply expertise multipliers if skill names were passed as aliases (e.g., "sleight" instead of "sleight of hand"). This was due to evaluating the expertise array directly against the un-normalized alias string instead of its canonical resolved counterpart.
**Action:** Always normalize alias skill inputs using canonical lists (`SKILL_ALIASES`) before comparing against `expertiseProficiencies` or any other proficiency trackers. Created a comprehensive, 43-test suite covering 100% of pathways in `characterModifiers.ts`.
