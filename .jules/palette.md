# Palette's Journal 🎨

## 2025-05-22 - Z-Index Standardization Pattern
**Learning:** The app has a centralized z-index constant file (`src/constants/z-index.ts`) but it's not consistently used, leading to "chaotic" layering. Using Tailwind's arbitrary value syntax (`z-[${Z_INDEX.CONSTANT}]`) is the standard way to apply these.
**Action:** Always check `src/constants/z-index.ts` before adding new `z-` classes and migrate hardcoded values when touching components.

## 2025-05-22 - Accessibility on Icon Buttons
**Learning:** Many interactive elements in the Battle Map are icon-only buttons (`size="icon"`). These are invisible to screen readers without explicit `aria-label`.
**Action:** Always add `aria-label` to components using `size="icon"`.

## 2025-05-23 - Form Accessibility Pattern
**Learning:** Linking `Label` components to their respective inputs (like `Switch` or `Select`) via `id` and `htmlFor` significantly improves accessibility and the clickable hit area. For reusable components like `SettingItem`, passing an `id` prop down to both the label and the input is a clean way to implement this.
**Action:** When creating or modifying form-like settings, ensure every input has a unique `id` linked to its label.

## 2025-05-24 - Form Accessibility and Redundancy
**Learning:** For `Select` components, linking the label to the `SelectTrigger` via `id` and `htmlFor` improves accessibility. Adding an explicit `aria-label` to the `SelectTrigger` provides additional clarity for screen reader users when navigating interactive elements.
**Action:** Always link `Label` to `SelectTrigger` and provide an `aria-label` on the trigger for consistent accessibility.

## 2025-05-23 - Z-Index Reliability
**Learning:** Tailwind JIT might not always generate classes for arbitrary values like `z-[${Z_INDEX.CONSTANT}]` if they are dynamic. Using inline `style={{ zIndex: Z_INDEX.CONSTANT }}` is the most reliable way to apply our centralized z-index constants.
**Action:** Prefer inline styles for applying `Z_INDEX` constants over Tailwind arbitrary value syntax.

## 2025-05-25 - Comprehensive Accessibility Standardization
**Learning:** Standardizing accessibility across a complex component (like `ToolOptionsPanel`) involves a multi-pronged approach: adding `aria-label` to non-textual controls (`Slider`, `SelectTrigger`), `aria-pressed` for toggle states, and using `React.useId()` for robust label-to-input linking.
**Action:** When touching complex UI panels, perform a full a11y audit and apply these patterns consistently.

## 2025-05-27 - View Toggle Accessibility Pattern
**Learning:** View mode toggles (e.g., Grid/List) require a combination of patterns for full accessibility: a container with `role="group"` and `aria-label`, and buttons with `aria-label`, `aria-pressed`, and `title`. This ensures screen readers announce the group's purpose and the individual button states correctly.
**Action:** Implement view toggles as ARIA-compliant button groups.

## 2025-05-26 - Focused Micro-UX Pattern
**Learning:** UX improvements are most effective when they are highly focused and "surgical". Combining accessibility fixes with large-scale design system migrations (like z-index) in a single PR can obscure the core value and increase regression risk.
**Action:** Keep UX improvements strictly focused on a single component or small set of related elements. Favor surgical accessibility enhancements (ARIA labels, linked labels) as they provide immediate value with minimal risk.

## 2025-05-14 - Character Sheet Loading and Layout
**Learning:** Hardcoded grid columns (e.g., `grid-cols-7`) in tabbed layouts are brittle and break when new tabs are added (e.g., "Gallery" as the 8th tab). Using responsive grids (`grid-cols-4 md:grid-cols-8`) improves mobile UX and prevents layout shifts.
**Action:** Always check the item count against grid column classes in tabbed navigations. Prefer responsive grid columns over fixed ones. Use `Skeleton` components instead of plain text for a more "delightful" loading experience.

## 2025-05-28 - Drawing Tool Accessibility and Component Standards
**Learning:** Polishing a complex feature panel like the Drawing Tool involves standardizing accessibility attributes (role="toolbar", aria-label, aria-pressed) and migrating legacy form elements (raw checkboxes) to design system components (Switch). Keeping these changes surgical and under 50 lines ensures they are maintainable and easy to review.
**Action:** When touching feature toolbars, always add role="toolbar" and ensure all interactive elements have appropriate state indicators (aria-pressed) and accessible names (aria-label).

## 2025-05-29 - Tree Item Accessibility Pattern
**Learning:** Custom tree items (like `FolderTree`) require `role="button"`, `tabIndex={0}`, and `aria-selected` to be properly navigable for keyboard and screen reader users. Nested actions (like expand/collapse or context menus) must be clearly labeled with `aria-label` and `aria-expanded` and should ideally be revealed on focus (`focus-visible:opacity-100`) to ensure they are discoverable without a mouse.
**Action:** Implement interactive list/tree items with appropriate ARIA roles, keyboard event handlers (`onKeyDown` for Enter/Space), and ensure all icon-only sub-actions are accessible and visible on focus.

## 2025-05-30 - Floating Action Panel Accessibility and Layering
**Learning:** Standardizing accessibility on floating panels involves adding `aria-label` to state toggles and ensuring z-index reliability. Descriptive `aria-label` for "Open/Close" and "Expand/Collapse" states provides essential context for screen reader users. Using `style={{ zIndex: Z_INDEX.CONSTANT }}` prevents layering issues that Tailwind's dynamic classes might occasionally skip.
**Action:** Always add descriptive `aria-label` to floating action buttons and use inline styles for z-index standardization.

## 2025-06-01 - Audio Control Accessibility and Live Status
**Learning:** Audio controls require specific ARIA attributes for a complete UX: `aria-label` and `aria-pressed` for mute/unmute toggles, and `aria-label` for sliders. Crucially, visual-only indicators like "Speaking..." pulses should be accompanied by `role="status"` and `aria-live="polite"` so screen reader users are aware of activity. Redundant component structures (e.g., in `src/components/game` and `src/features/game-session`) must be updated in tandem to ensure a consistent experience.
**Action:** Implement `aria-pressed` for toggles, `aria-label` for icon-only buttons/sliders, and `aria-live` for status indicators. Always check for duplicate component definitions across feature directories.

## 2026-02-10 - Accessibility & Feedback Enhancements in Combat Panels
**Learning:** Using React's `useId` is the most robust way to link form labels to inputs in components that might appear multiple times (like in lists or combat trackers), avoiding ID collisions. Additionally, silent empty lists are poor UX; always provide an explicit "No [items] found" message.
**Action:** Use `useId` for all `htmlFor`/`id` pairings and always implement descriptive empty states for dynamic lists.

## 2026-03-05 - Card Interaction Accessibility and Z-Index
**Learning:** Complex cards (like `RaceCard`) often use multiple `z-index` layers for overlays and hover effects. Migrating these to inline styles ensures reliable layering in all environments. Additionally, secondary actions on cards (like "Favorite" or "Compare") must be explicitly labeled and indicate their state via `aria-pressed` to be fully accessible.
**Action:** Standardize card layering using inline `zIndex` styles and ensure all secondary icon-only actions have `aria-label` and `aria-pressed` (if togglable).

## 2026-03-20 - View Mode Toggle Accessibility and Z-Index Standardization
**Learning:** View mode toggles (Grid/List/Compact) require a specific ARIA structure for optimal accessibility: a container with `role="group"` and `aria-label`, and buttons with `aria-label`, `aria-pressed`, and `title`. Furthermore, standardizing z-index application using inline styles and centralized constants (e.g., `Z_INDEX.BACKGROUND_LAYER` for card overlays) ensures consistent layering and avoids Tailwind JIT generation issues.
**Action:** Implement view toggles as ARIA button groups and always prefer inline `style={{ zIndex: Z_INDEX.CONSTANT }}` for layering.
