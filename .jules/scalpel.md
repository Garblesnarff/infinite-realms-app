## 2025-01-29 - [Combat Interface Extraction]
**Challenge:** Encountered build-breaking syntax errors in unrelated files (`context-builder.ts` and `asset-processor.ts`) that were truncated in the source. This prevented verification of the refactor.
**Learning:** Always verify the build state *before* starting a refactor to distinguish between existing issues and new ones. Backticks in template literals must be carefully escaped when editing files via search-and-replace tools.
**Pattern:** Extracting a large set of handlers and state into a custom hook effectively reduced a 1000-line component to under 350 lines, improving readability without changing UI structure.
## 2026-02-20 - [Combat Sequence Validator Extraction]
**Challenge:** Extracting turn management logic revealed that some tests were manually accessing private state (e.g., `initiativeRolled`) via `as any`. This required a minor update to the test suite to account for the new internal hierarchy.
**Learning:** Even when following a "no functional change" rule, refactoring internal state can break tests that bypass visibility modifiers. Always check for `as any` usages in tests when moving private properties.
**Pattern:** Extracting a cohesive set of state-management methods (Initiative/Turn Order) into a specialized manager (`CombatTurnManager`) significantly reduced the complexity of the main orchestrator (`CombatSequenceValidator`) while maintaining a stable public API through delegation.
