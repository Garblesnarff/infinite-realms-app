# InfiniteRealms Brand Guidelines

## Brand Identity

**Name:** InfiniteRealms  
**Domain:** InfiniteRealms.tech  
**Tagline:** "Your World, Your Story, Forever"

## Vision Statement
Create the most personalized, persistent storytelling experience possible - where every player action echoes could through centuries, building a unique world that exists only in their campaigns.

## Brand Positioning
InfiniteRealms is not just a game - it's a universe creation platform where players build persistent worlds that evolve across generations, campaigns, and eras.

## Core Brand Values
- **Persistence** - Worlds that never forget
- **Evolution** - Stories that grow and change
- **Ownership** - Your personal universe
- **Legacy** - Actions that echo through time
- **Infinity** - Endless possibilities

## Visual Identity

InfiniteRealms deliberately uses two related visual systems:

- **Product application (`/app/*`) — shipped:** deep navy surfaces, antique gold emphasis, muted steel-blue secondary accents, and teal interaction/status accents.
- **Public marketing — retained:** cosmic purple, bright gold, and teal. Purple remains appropriate for launch pages and campaign storytelling; it is not the default product-shell color.

Do not reintroduce marketing purple as a hardcoded app glow. Product UI should inherit the scoped tokens below.

### Shipped app palette

- **Deep navy:** `#070b14` (`--c-infinite-dark`)
- **Antique gold:** `#d5b070` (`--c-infinite-gold`)
- **Steel blue:** `#5f71a8` (`--c-infinite-purple`; legacy token name retained for compatibility)
- **Teal:** `#4fb6c4` (`--c-infinite-teal`)

### Theme token architecture

The authenticated product shell applies `.ir-app` to every `/app/*` route. `src/styles/ir-overhaul.css` defines the product theme beneath that scope, so public and marketing surfaces remain unchanged.

The `--c-infinite-*` values are space-separated RGB channels, not hex colors:

```css
--c-infinite-gold: 213 176 112;
```

This format is intentional. Tailwind consumes the channels as `rgb(var(--c-infinite-gold) / <alpha-value>)`, enabling utilities such as `bg-infinite-gold/10` to respect opacity. Use semantic CSS variables and shared Tailwind utilities (`shadow-glow-gold`, `shadow-glow-teal`, and `shadow-glow-purple`) instead of component-local hex, RGB, gradient, radius, or glow values.

Shared product primitives include `.ir-panel`, `.ir-display`, `.ir-narr`, `.ir-btn-gold`, and the `ir-gold` Button variant. Change the product palette centrally in `.ir-app`; do not override it screen by screen.

### Typography
- **Headers**: Bold, fantasy-inspired fonts (Medieval Sharp for emphasis)
- **Body**: Clean, readable sans-serif for accessibility
- **Accent**: Elegant serif for quotes and taglines

### Logo Concepts
1. **Infinity Symbol + Realm**: Infinity symbol (∞) with castle/realm silhouette inside
2. **Nested Worlds**: Concentric circles representing layered realities
3. **Timeline Tree**: Branching tree representing generational storylines
4. **Cosmic Portal**: Mystical gateway representing infinite possibilities

## Messaging Framework

### Primary Messages
- "Create worlds that remember everything"
- "Your choices echo through eternity"
- "Build universes, not just campaigns"
- "Where every story becomes legend"

### Audience Personas
1. **Solo RPG Enthusiasts** - Want rich, persistent narratives
2. **Campaign Builders** - Need tools for complex world creation
3. **Storytelling Creators** - Desire ownership of their fictional universes
4. **Tech-Forward Gamers** - Appreciate AI-powered innovation

## Brand Applications

### Website/App
- Navy and antique-gold product surfaces under `.ir-app`
- Cosmic purple gradients on public marketing surfaces
- Smooth animations suggesting infinite scroll/time passage
- Particle effects representing memories floating through space
- Progressive disclosure of complexity (simple entry, infinite depth)

### Marketing Copy Tone
- **Inspirational** - Focus on the epic scale of creation
- **Personal** - Emphasize ownership and uniqueness
- **Mystical** - Use language that evokes wonder and possibility
- **Technical** - When appropriate, highlight AI innovation

## Competitive Differentiation

### What We're NOT
- Another D&D tool
- A simple campaign manager
- A temporary gaming session
- A social platform

### What We ARE
- A universe creation engine
- A generational storytelling platform
- An AI-powered memory system
- A personal mythology builder

## Future Branding Considerations

### Scalability
The brand should work across:
- Web application
- Mobile app
- API/developer tools
- Potential VR/AR experiences
- Merchandise and community items

### Evolution Path
- Phase 1: Focus on "Infinite" possibilities
- Phase 2: Emphasize "Realms" and world-building
- Phase 3: Highlight generational/"Forever" aspects
- Phase 4: Expand to "Multiverse" concepts

---

**Created:** September 2025

**Product theme updated:** July 8, 2026

**Next Review:** October 2026

*This brand guide will evolve as the platform grows and user feedback shapes our identity.*
