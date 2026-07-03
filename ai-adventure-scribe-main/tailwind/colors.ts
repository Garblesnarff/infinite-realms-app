// border/input/muted/card/sidebar-background/-border bake their own
// alpha into an rgba() value, so they reference the var directly
// instead of a `rgb(var(--x) / <alpha-value>)` triplet (which would
// need a solid, alpha-less color).
export const colors = {
  border: 'var(--border)',
  input: 'var(--input)',
  ring: 'rgb(var(--ring) / <alpha-value>)',
  background: 'rgb(var(--background) / <alpha-value>)',
  foreground: 'rgb(var(--foreground) / <alpha-value>)',
  primary: {
    DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
    foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
  },
  secondary: {
    DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
    foreground: 'rgb(var(--secondary-foreground) / <alpha-value>)',
  },
  destructive: {
    DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
    foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
  },
  muted: {
    DEFAULT: 'var(--muted)',
    foreground: 'var(--muted-foreground)',
  },
  accent: {
    DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
    foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
  },
  popover: {
    DEFAULT: 'rgb(var(--popover) / <alpha-value>)',
    foreground: 'rgb(var(--popover-foreground) / <alpha-value>)',
  },
  card: {
    DEFAULT: 'var(--card)',
    foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
  },
  sidebar: {
    DEFAULT: 'var(--sidebar-background)',
    foreground: 'rgb(var(--sidebar-foreground) / <alpha-value>)',
    primary: 'rgb(var(--sidebar-primary) / <alpha-value>)',
    'primary-foreground': 'rgb(var(--sidebar-primary-foreground) / <alpha-value>)',
    accent: 'rgb(var(--sidebar-accent) / <alpha-value>)',
    'accent-foreground': 'rgb(var(--sidebar-accent-foreground) / <alpha-value>)',
    border: 'var(--sidebar-border)',
    ring: 'rgb(var(--sidebar-ring) / <alpha-value>)',
  },
  // InfiniteRealms Brand Colors — channel-var driven so they can be
  // re-themed per scope (see --c-* defaults in index.css and the
  // navy overrides in ir-overhaul.css under .ir-app). <alpha-value>
  // keeps opacity utilities (e.g. bg-infinite-dark/60) working.
  'infinite-purple': 'rgb(var(--c-infinite-purple) / <alpha-value>)',
  'infinite-gold': 'rgb(var(--c-infinite-gold) / <alpha-value>)',
  'infinite-teal': 'rgb(var(--c-infinite-teal) / <alpha-value>)',
  'infinite-dark': 'rgb(var(--c-infinite-dark) / <alpha-value>)',

  // Lore-based Color Aliases
  shadowweave: 'rgb(var(--c-infinite-purple) / <alpha-value>)',
  emberlight: 'rgb(var(--c-infinite-gold) / <alpha-value>)',
  crystalline: 'rgb(var(--c-infinite-teal) / <alpha-value>)',
  electricCyan: 'rgb(var(--c-electric-cyan) / <alpha-value>)',
};
