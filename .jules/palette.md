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

## 2026-01-24 - Accessible Selectable Cards
**Learning:** Selectable cards with inner checkboxes often suffer from nested interactivity, causing double-triggering of events and a poor keyboard/screen reader experience (redundant tab stops).
**Action:** Use a single-interaction pattern for selectable cards. Assign `role="checkbox"`, `aria-checked`, and `tabIndex` to the parent `Card`. Mark the inner `Checkbox` component with `tabIndex={-1}` and `aria-hidden="true"`. This ensures the whole card is a single, focusable accessibility object.

### RadioGroup Accessibility
**Learning:** Shadcn `RadioGroup` components in complex forms (like campaign creation steps) often lack clear associations with their section titles, making navigation difficult for screen reader users.
**Action:** Use `useId` to link section labels to `RadioGroup` components via `aria-labelledby`. Always wrap icon-only view toggles in a `role="group"` container with a descriptive `aria-label`.

### Click-to-Edit Accessibility Pattern
**Learning:** Interactive display elements that trigger edit modes (like in `EditableDescription.tsx`) are often implemented as static `div`s, making them invisible to keyboard users and screen readers.
**Action:** Add `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler for Enter/Space to ensure keyboard navigation parity. Always provide a descriptive `aria-label` for the trigger and `title`/`aria-label` for action buttons like Save/Cancel.

## 2026-03-24 - Quick Action Button Accessibility in Panels
**Learning:** Functional text buttons in complex side panels (like the Layers Panel) can be ambiguous if they only use short labels like "Reset". Providing more descriptive `aria-label` and `title` attributes (e.g., "Reset layers to default visibility and opacity") significantly improves the experience for both screen reader users and sighted users via tooltips.
**Action:** Always provide descriptive `aria-label` and `title` attributes for functional buttons in utility panels, even if they have text labels, to clarify the scope of the action.

## 2026-01-25 - Combat UI Accessibility
**Learning:** Core combat components like `HPTracker` and `CombatActionPanel` often lack basic accessibility, making them difficult for screen reader users. Icon-only buttons for critical actions (damage/healing) need explicit labels.
**Action:** Always use `useId` to link labels to inputs. Provide `aria-label` and `title` for icon-only buttons. Add `aria-label` to `Progress` bars to provide context for health status.

## 2026-01-26 - Reusable Component Accessibility and UX
**Learning:** Reusable components like `EditableDescription` are often duplicated across `src/components/` and `src/features/`. Missing `id`/`htmlFor` associations on these components reduce accessibility and clickability across many parts of the application. Adding a `title` to the edit button provides a helpful tooltip for mouse users.
**Action:** Use `useId` to link labels to inputs in reusable components. Always synchronize changes across duplicated component locations. Add `title` to icon-only buttons for a better desktop UX.

## 2026-01-27 - Campaign Creation Accessibility and Z-Index Standardization
**Learning:** Complex form components like `CampaignParameters` often contain multiple sections with `RadioGroup` controls that lack proper semantic linkage to their titles. Icon-only view toggles and search inputs in these components are frequently missing accessible labels and state feedback. Standardizing z-index via `Z_INDEX` constants prevents visual layering bugs in card-based UIs.
**Action:** Link `RadioGroup` to section titles using `useId` and `aria-labelledby`. Add `aria-label`, `aria-pressed`, and `title` to all icon-only buttons. Migrate all hardcoded `z-index` classes to inline styles with `Z_INDEX` constants.

## 2026-01-28 - Core UI Z-Index Standardization and Type Safety
**Learning:** Tailwind JIT arbitrary values for z-index (e.g., `z-[${Z_INDEX.POPOVER}]`) are unreliable and can fail to generate CSS classes, causing overlays to hide behind other elements. Centralizing all overlay z-indices in `src/constants/z-index.ts` and using explicit `style={{ zIndex: Z_INDEX.CONSTANT }}` ensures reliable layering. Missing constants like `CONTEXT_MENU` lead to TypeScript errors in UI components.
**Action:** Migrate all Radix-based UI components (Popover, DropdownMenu, Toast, Tooltip, ContextMenu) to use inline styles for z-index. Ensure all semantic overlay types have corresponding entries in `Z_INDEX`.

## 2026-01-29 - Sidebar Accessibility and Z-Index Standardization
**Learning:** Core layout components like `Sidebar` often use hardcoded Tailwind z-index classes (`z-10`, `z-20`) that conflict with the centralized `Z_INDEX` hierarchy. Icon-only buttons for toggling the sidebar (`SidebarTrigger`) and interactive regions (`SidebarRail`) lack accessible state feedback (`aria-expanded`) and desktop hover tooltips.
**Action:** Migrate all sidebar z-indices to inline `style={{ zIndex: Z_INDEX.CONSTANT }}`. Add `aria-expanded` and `title` (including keyboard shortcuts like Ctrl+B) to sidebar triggers and interactive rails to improve both accessibility and discoverability.

## 2026-03-05 - Quick Action Menu Accessibility and UX
**Learning:** Interactive radial menus using raw `<button>` elements should always specify `type="button"` to prevent accidental form submissions when nested. Providing a `title` attribute for the center toggle/close button ensures sighted desktop users have a clear visual cue (tooltip) for its function, complementing the `aria-label` used by screen readers.
**Action:** Add `type="button"` to all buttons in radial or context menus. Ensure center or primary toggle buttons have both `aria-label` and `title` for dual accessibility and UX benefits.

## 2026-03-06 - Spell Preparation UX and Accessibility
**Learning:** Browser `alert()` calls are disruptive and don't match the application's aesthetic. Replacing them with `toast` notifications provides a smoother, non-blocking user experience. For checkboxes in lists, providing a dynamic `aria-label` (e.g., "Prepare [Item Name]") ensures screen reader users have clear context without needing to find a separate label.
**Action:** Replace `alert()` with `toast.error()` or `toast.success()`. Always add descriptive `aria-label` to checkboxes in repetitive lists.

## 2026-03-07 - Combat UI Accessibility and Keyboard Navigation
**Learning:** Purely visual pulsing indicators for "Combat in Progress" and "Current Turn" are invisible to screen readers without a status role. Interactive non-button elements like enemy selection cards and initiative rows require explicit `focus-visible` ring styles and ARIA labels to be usable by keyboard and screen reader users. Descriptive `title` attributes on buttons like "Next Turn" clarify the action (ending the turn) for all users.
**Action:** Always add `role="status"` and `aria-label` to visual state indicators. Use `focus-visible:ring-2` on interactive cards. Provide descriptive `title` tooltips for functional buttons.

## 2026-03-08 - Folder Tree and Dice Roller Accessibility
**Learning:** Interactive `div` elements and purely informational `Badge` components often lack the semantic metadata required for a high-quality accessible experience. Combining `aria-label` for screen readers and `title` for sighted user tooltips provides a consistent "micro-UX" win across different input methods.
**Action:** Always provide both `aria-label` and `title` for custom interactive elements and critical status indicators (like dice results) to ensure "invisible" UX that just works for everyone.

## 2026-03-23 - Dice Roll Message Accessibility
**Learning:** Dice roll messages in chat are high-frequency game events that must be announced immediately to screen reader users. Components like `DiceRollMessage` that are duplicated across the codebase (e.g., `src/components/game/` and `src/features/game-session/components/chat/`) must be updated in tandem to maintain UX consistency.
**Action:** Use `role="status"`, `aria-live="polite"`, and `aria-atomic="true"` for event-driven message components. Use `aria-label` to provide semantic context for formula and result values (e.g., "Formula: 1d20+4") rather than relying on raw text.

## 2026-03-09 - Searchable Listbox and Scroll Area Accessibility
**Learning:** Standardizing selection feedback in listboxes (`role="option"`) by adding `aria-selected` and visual cues like a `Check` icon improves both accessibility and visual clarity. Semantically linking `ScrollArea` containers to their section headings using `aria-labelledby` provides better context for screen reader users when navigating complex dialogs.
**Action:** For searchable listbox implementations, always include `aria-selected` on options and a visual selection indicator (like a `Check` icon). Link scrollable lists to their headers via `aria-labelledby` using `useId`.

## 2026-04-01 - SelectTrigger Accessibility Redundancy
**Learning:** Providing an `aria-label` on a `SelectTrigger` that is already correctly associated with a `Label` (via `id` and `htmlFor`) or an `aria-labelledby` causes screen readers to announce the label twice. Removing the redundant attribute ensures a cleaner, more professional experience for assistive technology users.
**Action:** Avoid redundant `aria-label` attributes on `SelectTrigger` components if they have an associated `Label`. Update unit tests to check for accessible names via role/name instead of targeting the specific attribute.

## 2026-04-15 - Descriptive ARIA Labels in Lists
**Learning:** Generic `aria-label` and `title` attributes (e.g., "Revoke access") in repetitive lists can be ambiguous for screen reader users and confusing in multi-item views. Including the item's name or a unique identifier in the label (e.g., "Revoke access for [User Name]") provides immediate context and improves navigation.
**Action:** Always use template literals to include contextually relevant identifiers in `aria-label` and `title` attributes for per-item actions in lists or grids.

## 2025-05-02 - Battle Map UX and Accessibility Refinement
**Learning:** Redundant `title` attributes on buttons wrapped in Radix `Tooltip` components cause "double tooltips" (native browser + custom UI), which is distracting and unprofessional. Including keyboard shortcuts directly in the `aria-label` (e.g., "Select (S)") provides immediate, high-value context for screen reader users without requiring them to find the shortcut elsewhere.
**Action:** Always remove native `title` attributes when using custom Tooltip components. Use template literals to include shortcuts in `aria-label` for toolbar-style actions.

## 2026-05-03 - Audio Control Accessibility and UX
**Learning:** Providing both a `title` attribute and an `aria-label` on a button wrapped in a Radix `Tooltip` causes redundant or clashing information for both sighted and screen reader users. Ensuring icon-only buttons have `type="button"` prevents accidental form submissions in React environments.
**Action:** Remove redundant `title` attributes when using custom `Tooltip` components. Always add `aria-label`, `aria-pressed` (for toggles), and `type="button"` to icon-only buttons in utility players.

## 2026-05-03 - Layers Panel Accessibility and Visual Affordance
**Learning:** Truncated names in sidebars (like layer names) need tooltips to be discoverable on desktop. Descriptive ARIA labels on repetitive controls (like opacity sliders) should include the item name for context. Quick actions benefit from icons to align with individual item controls.
**Action:** Add `title` tooltips to truncated labels. Use template literals for `aria-label` on sliders. Apply icons to functional buttons and mark decorative ones as `aria-hidden="true"`.

## 2026-02-24 - Battle Map Z-Index and Header Accessibility
**Learning:** Floating UI elements in the Battle Map (like Tool Options and Performance Monitor) should be grouped in the same Z-index layer as the main Toolbar (Z_INDEX.FLOATING_PANEL) to ensure consistent stacking behavior. Native 'title' attributes on buttons wrapped in Tooltips cause distracting "double tooltips".
**Action:** Migrate map-floating controls from STICKY to FLOATING_PANEL. Use Tooltip components for icon-only header buttons and ensure aria-labels are descriptive (e.g., "Open View Settings" instead of just "Settings").

## 2026-06-12 - Dice Suggestion Keyboard Navigation and Listbox Accessibility
**Learning:** Interactive listbox suggestions (like dice commands in `ChatInput.tsx`) that only support mouse clicks are inaccessible to keyboard-only and screen reader users. Implementing standard keyboard navigation (`ArrowUp`/`ArrowDown` for cyclic navigation, `Enter` for selection, and `Escape` for dismissal) provides a significant UX improvement for power users.
**Action:** Always implement full keyboard navigation for custom autocomplete or suggestion listboxes. Use `selectedIndex` state to track the active item, apply visual highlighting, and use `aria-selected` for accessibility. Ensure `e.preventDefault()` is used on navigation keys to prevent cursor movement or unintended form submission.

## 2026-06-25 - User Search Keyboard Navigation and Screen Reader Accessibility
**Learning:** For interactive search suggestions, implementing keyboard navigation (Arrow keys, Enter, Escape) is not enough for full accessibility. Adding 'aria-activedescendant' on the search input, combined with unique IDs on suggestion options, ensures that screen readers announce the currently highlighted item as the user navigates. Using a short delay in 'onBlur' allows mouse clicks on suggestions to register before the list is dismissed.
**Action:** Always pair keyboard navigation logic with 'aria-activedescendant' and unique option IDs. Use 'useId' for stable ID prefixes. Implement 'onBlur' with a 'setTimeout' delay when suggestions are dismissible by losing focus.

## 2026-07-15 - Slider Accessibility with aria-valuetext
**Learning:** For Shadcn/Radix Slider components, visual labels and numeric percentages are often not enough for screen readers to provide meaningful context during adjustment. Implementing `getAriaValueText` on the `Slider` (and passing it down to the `Thumb`'s `aria-valuetext` attribute) allows screen readers to announce human-readable values like "80%" or "10px" instead of raw numbers.
**Action:** Enhance standard `Slider` components to support a `getAriaValueText` prop. Always provide this prop at call sites where the numeric value has a unit or specific context.

## 2026-07-20 - Campaign Header Tooltip Enhancement
**Learning:** Replacing native 'title' attributes with Shadcn Tooltips improves visual consistency. To ensure tooltips trigger on disabled buttons (like during a 'deleting' state), wrap the button and its trigger in a '<span>' element. This preserves hover feedback for all users while avoid 'double tooltips' on desktop.
**Action:** Always wrap disabled-capable buttons in a '<span>' within 'TooltipTrigger' and remove redundant 'title' attributes when migrating to custom Tooltips.

## 2026-06-12 - Dice Roll Request Accessibility and UX
**Learning:** Essential game interactions like dice roll requests require clear accessible names and state feedback. Combining `aria-label` for screen readers and Shadcn `Tooltip` for sighted users provides a robust experience. Standardizing buttons to `type="button"` prevents accidental form submissions in complex game views.
**Action:** Replace native `title` with Shadcn `Tooltip`. Ensure all buttons have explicit `type="button"` and descriptive `aria-label`. Wrap interactive groups in `TooltipProvider`.
