# Palette's Journal 🎨

## 2025-05-22 - Z-Index Standardization Pattern
**Learning:** The app has a centralized z-index constant file (`src/constants/z-index.ts`) but it's not consistently used, leading to "chaotic" layering. Using Tailwind's arbitrary value syntax (`z-[${Z_INDEX.CONSTANT}]`) is the standard way to apply these.
**Action:** Always check `src/constants/z-index.ts` before adding new `z-` classes and migrate hardcoded values when touching components.

## 2025-05-22 - Accessibility on Icon Buttons
**Learning:** Many interactive elements in the Battle Map are icon-only buttons (`size="icon"`). These are invisible to screen readers without explicit `aria-label`.
**Action:** Always add `aria-label` to components using `size="icon"`.
