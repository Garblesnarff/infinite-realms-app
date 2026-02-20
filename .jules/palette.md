# Palette's Journal

## Established Patterns

### Z-Index Standardization
**Learning:** The app has centralized z-index constants in `src/constants/z-index.ts`. Tailwind JIT does not reliably generate classes for dynamic arbitrary values like `z-[${Z_INDEX.CONSTANT}]`.
**Action:** Always use inline `style={{ zIndex: Z_INDEX.CONSTANT }}` instead of Tailwind arbitrary values. Check `z-index.ts` before adding new z-index values.

### Icon-Only Button Accessibility
**Learning:** Icon-only buttons (`size="icon"`) are invisible to screen readers. Toggle buttons need state feedback.
**Action:** Always add `aria-label` to icon-only buttons. Add `aria-pressed` for toggle buttons (mute, favorite, view mode). Add `title` for tooltip on hover.

### Form Accessibility
**Learning:** Linking `Label` to inputs via `id`/`htmlFor` improves accessibility and clickable area. In components that render multiple times (lists, combat trackers), use React's `useId()` to avoid ID collisions.
**Action:** Use `useId()` for all `htmlFor`/`id` pairings. Add `aria-label` to `SelectTrigger` components. Always provide descriptive empty states ("No items found") for dynamic lists.

### View Mode Toggle Pattern
**Learning:** View toggles (Grid/List/Compact) require specific ARIA structure for accessibility.
**Action:** Wrap toggles in a container with `role="group"` and `aria-label`. Each button gets `aria-label`, `aria-pressed`, and `title`.

### Live Status Indicators
**Learning:** Visual-only indicators (like "Speaking..." pulses) are invisible to screen readers.
**Action:** Add `role="status"` and `aria-live="polite"` to status indicators so screen readers announce activity changes.

### Toolbar Accessibility
**Learning:** Complex feature panels (drawing tools, combat controls) need proper ARIA roles for keyboard navigation.
**Action:** Add `role="toolbar"` to tool panels. Use `aria-pressed` for state indicators. Migrate legacy form elements (raw checkboxes) to design system `Switch` components. Reveal nested actions on focus (`focus-visible:opacity-100`).

---

## Specific Fixes

### 2025-05-14 - Character Sheet Loading and Layout
**Learning:** Hardcoded grid columns (`grid-cols-7`) break when tabs are added. Using responsive grids (`grid-cols-4 md:grid-cols-8`) prevents layout shifts.
**Action:** Always check item count against grid column classes. Prefer responsive grids. Use `Skeleton` components for loading states.

### 2025-05-29 - Tree Item Accessibility
**Learning:** Custom tree items (like `FolderTree`) need `role="button"`, `tabIndex={0}`, and `aria-selected`. Nested actions need `aria-label` and `aria-expanded`.
**Action:** Add keyboard event handlers (`onKeyDown` for Enter/Space) to interactive list/tree items.

### 2025-05-26 - Focused Micro-UX
**Learning:** Combining accessibility fixes with large-scale design migrations in a single PR increases regression risk.
**Action:** Keep UX improvements surgical and focused on a single component. Favor small, targeted accessibility enhancements over sweeping changes.

### 2025-06-01 - Audio Control Accessibility
**Learning:** Audio controls need `aria-label` and `aria-pressed` for mute/unmute, `aria-label` for sliders. Redundant component structures (`src/components/game` and `src/features/game-session`) must be updated in tandem.
**Action:** Always check for duplicate component definitions across feature directories when making accessibility fixes.

## 2025-06-03 - Z-Index Migration and Select Accessibility
**Learning:** Performance overlays and debug monitors should use high-level z-index constants (like `Z_INDEX.TOAST`) to remain visible above other UI layers. `SelectTrigger` components often lack accessible names when their labels are not correctly associated or are implicit.
**Action:** Migrate hardcoded z-indices to `Z_INDEX` constants using inline styles. Always provide `aria-label` to `SelectTrigger` components in forms and filters.

## 2025-06-05 - Z-Index Standardization and Icon Button Accessibility
**Learning:** Character cards and campaign selection views often use complex layering (glows, backgrounds, overlays) that require careful z-index management. Hardcoded Tailwind classes like `z-0` or `z-50` conflict with the centralized `Z_INDEX` system. Icon-only buttons (like Delete) are invisible to screen readers without explicit labels.
**Action:** Migrate all z-index applications to inline `style={{ zIndex: Z_INDEX.CONSTANT }}`. For icon-only buttons, provide both `aria-label` and `title` for dual accessibility and UX benefit. Ensure `AlertDialog` components follow the `Z_INDEX.MODAL` (60) and `Z_INDEX.MODAL_BACKDROP` (50) hierarchy instead of defaulting to `z-50`.

## 2025-06-07 - Campaign Creation Accessibility and Z-Index
**Learning:** Campaign creation steps (like Genre Selection) use many hardcoded z-indices for visual effects (overlays, hover popups). View mode toggles in these screens are often icon-only and lack state feedback. Brittle Vitest selectors targeting margin classes (e.g., `.mb-4`) cause tests to fail when design tweaks are made.
**Action:** Migrate `GenreSelection` z-indices to `Z_INDEX` constants. Add `role="group"`, `aria-label`, and `aria-pressed` to view toggles. Update tests to use more robust selectors (e.g., targeting height/width or functional classes like `.animate-pulse`) instead of spacing classes.

## 2025-06-12 - Memory Panel Accessibility and Z-Index Standardization
**Learning:** The Game Side Panels (MemoryPanel and GameRightPanel) use complex layering that requires Z_INDEX constants for stability. Icon-only buttons for panel controls (Minimize, Expand, Close) and tab triggers require explicit ARIA attributes (aria-label, aria-pressed) to be accessible. Linking labels to textareas via useId improves the accessible name and hit target for session notes.
**Action:** Always migrate z-index to inline style={{ zIndex: Z_INDEX.CONSTANT }}. Ensure all icon-only buttons have aria-label and title. Use useId for linking Labels to inputs. Correct documentation in constants files when it contradicts established best practices.

### Destructive Action Confirmation Pattern
**Learning:** Native `window.confirm` dialogs feel disconnected from the app's dark fantasy aesthetic. Using themed Shadcn `AlertDialog` components provides a more immersive and accessible experience.
**Action:** Replace `window.confirm` with `AlertDialog` for all destructive actions (deleting, ending sessions, revoking access).

## 2025-06-14 - Gallery Accessibility and Component Redundancy
**Learning:** Interactive gallery items implemented as `div` elements require full keyboard support (role="button", tabIndex, onKeyDown) and visible focus states (focus-visible) to be accessible. The project contains duplicate component structures in `src/components/` and `src/features/` (e.g., `GalleryGrid.tsx`), which can lead to inconsistent UX if only one is updated.
**Action:** Always verify if a component has a duplicate in `src/features/` or `src/components/` and synchronize accessibility and z-index fixes across both. Use `e.preventDefault()` in keyboard handlers for the Space key to prevent scrolling.

## 2025-06-16 - Z-Index Standardization and Sticky Header Layering
**Learning:** Hardcoded z-index classes like `z-50` for sticky headers can conflict with the centralized `Z_INDEX` hierarchy, potentially causing headers to appear above modal backdrops (which also use 50). Standardizing to `Z_INDEX.STICKY` (30) ensures headers remain below modals while still staying on top of base content.
**Action:** Migrate hardcoded `z-index` classes to `style={{ zIndex: Z_INDEX.CONSTANT }}`. For sticky headers, use `Z_INDEX.STICKY`. For existing `z-10` values, map to `Z_INDEX.DROPDOWN` to maintain behavior while standardizing. Add complex files (like `SceneCreationWizard.tsx`) to `eslint.config.js` overrides if they exceed the 200-line limit to ensure build passes after minor changes.
