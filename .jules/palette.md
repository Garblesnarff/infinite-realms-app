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
