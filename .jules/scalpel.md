## 2025-01-29 - [Combat Interface Extraction]
**Challenge:** Encountered build-breaking syntax errors in unrelated files (`context-builder.ts` and `asset-processor.ts`) that were truncated in the source. This prevented verification of the refactor.
**Learning:** Always verify the build state *before* starting a refactor to distinguish between existing issues and new ones. Backticks in template literals must be carefully escaped when editing files via search-and-replace tools.
**Pattern:** Extracting a large set of handlers and state into a custom hook effectively reduced a 1000-line component to under 350 lines, improving readability without changing UI structure.
## 2026-02-20 - [Combat Sequence Validator Extraction]
**Challenge:** Extracting turn management logic revealed that some tests were manually accessing private state (e.g., `initiativeRolled`) via `as any`. This required a minor update to the test suite to account for the new internal hierarchy.
**Learning:** Even when following a "no functional change" rule, refactoring internal state can break tests that bypass visibility modifiers. Always check for `as any` usages in tests when moving private properties.
**Pattern:** Extracting a cohesive set of state-management methods (Initiative/Turn Order) into a specialized manager (`CombatTurnManager`) significantly reduced the complexity of the main orchestrator (`CombatSequenceValidator`) while maintaining a stable public API through delegation.

## 2026-03-03 - [Class Mechanics Extraction]
**Challenge:** Re-exporting functions from the new module back into the original monolithic file ensured backward compatibility for the rest of the codebase but required adding both files to the `max-lines` override list in `eslint.config.js`.
**Learning:** Even after a successful surgical extraction, the original file may still exceed the 200-line limit if it contains extensive definitions (like D&D class features). Modularizing by responsibility (definitions vs. logic) is a sustainable first step.
**Pattern:** Separating pure calculation logic (`classMechanics.ts`) from data definitions and resource management (`classFeatures.ts`) improves testability and readability of the business logic.
## 2026-03-04 - [Message Command Handler Extraction]
**Challenge:** Extracting safety and dice command logic from a large hook revealed that the original code relied on multiple context hooks and local refs to manage asynchronous state.
**Learning:** When extracting into a new hook, ensure that all necessary context hooks are duplicated in the new hook and that refs (like `messagesRef`) are maintained to prevent stale closures in async operations.
**Pattern:** Delegating specialized command processing to a sub-hook (`useMessageCommandHandler`) significantly reduces the cognitive load and line count of the main orchestrator (`useMessageHandlerLogic`) while maintaining a clean, functional interface.

## 2026-03-19 - [Authorization Logic Extraction]
**Challenge:** Extracting authorization logic from a service while leaving some database queries behind resulted in a broken build due to a missing 'or' import in the original file.
**Learning:** When extracting logic that uses shared library functions (like Drizzle's 'or', 'and', 'sql'), double-check that the original file still has all the imports it needs for its remaining code. Don't assume that if you moved all calls *you saw* that there aren't others.
**Pattern:** Extracting cohesive, database-heavy verification methods into a standalone module ('combat-authorization.ts') reduces service complexity and allows for easier reuse of authorization patterns across different combat services.
