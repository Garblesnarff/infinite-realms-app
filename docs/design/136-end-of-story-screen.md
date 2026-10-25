# End of story: fallen and complete states

**Issue:** #136  
**Status:** beta design specification; no production behavior changes  
**Review constraint:** Draft only — do not merge

This design covers the page a player sees when a solo character dies and the
parallel page shown when a one-shot campaign completes. It also specifies the
short dying state that precedes a death. The design is written against the
current end-state implementations in `src/features/game-session/components/game/game-content/DeathScreen.tsx`
and `CompletionScreen.tsx` at the design branch head.

## Beta decisions

These decisions are settled by the four comments on #136:

- Death is permanent for that character. There is no revive or resurrection flow.
- Choosing a new hero starts the campaign from the beginning in a new session.
- A fallen character remains in **My Characters**, marked **Fallen** and read-only.
  Opening it restores this end-of-story page.
- The hall of the fallen is post-beta. Beta may save a small future-facing death
  record, but it does not need a hall screen.
- The dying state is a multi-turn state. This page begins only after the final
  death result (or an instant-death result).

## Design call: one shell, two tones

Use one `CampaignEndState` presentation shell with a `mode` of `fallen` or
`complete`. The shell owns layout, persistence, story view, responsive rules,
focus, and actions. A small mode model supplies the title, summary, icon,
moment content, and tone-specific labels.

This is a real shared module rather than two visually similar cards: the
reload gate, story view, action ordering, and accessibility behavior must not
drift between death and victory. The mode model keeps the difference visible:

| Mode | Meaning | Accent use | Primary copy |
| --- | --- | --- | --- |
| `fallen` | This character's run ended | Gold/grey shell; red only for failed or hostile result badges | `Choose a new hero` |
| `complete` | The campaign's one-shot ending was reached | Gold shell; no death/failure badges | `Begin again with a new hero` |

Do not make a generic “success/error” color switch. Death is a solemn story
state, not an error, and completion is not a reward screen full of confetti.

The campaign's genre or tone may affect authored narration later, but beta uses
one copy system. A per-campaign tone switch would require authored content and
fallback rules that do not exist yet.

## Page state and transition

The end state replaces the game page. It is not a modal, a dismissible card, or
a dimmed game behind a scrim. The composer, sheet, tracker, and roll tray are
absent from the DOM while the end state is active.

```
session load
    │
    ├─ state unknown ──> name-only loading state
    │
    ├─ fallen ─────────> CampaignEndState mode=fallen
    │                      ├─ End view
    │                      └─ Story view (inline, read-only)
    │
    └─ complete ───────> CampaignEndState mode=complete
                           ├─ End view
                           └─ Story view (inline, read-only)
```

The same page must render after a reload or reconnect. The client should read a
single persisted state from the session load payload:

- `character_stats.vital_state === 'dead'` is the death truth.
- The completed-session status and stored summary are the completion truth.
- `PartyDefeatedError` and `ended_reason` can trigger a live transition, but
  they are not a second reload-time death gate.

During the load gate, show the character name when available and no game UI.
Do not render the composer first and replace it after the response arrives.

## Fallen end view

Phone width is the design anchor: 360–430 px, 16 px gutters, one column, and
a safe-area-aware sticky primary action. Desktop and tablet use the same column
at a maximum width of 640 px; the primary action returns to normal document
flow instead of sticking to the viewport.

```
┌──────────────────────────────┐
│ ABYSSAL DESCENT              │  campaign eyebrow, gold caps
│                              │
│          portrait           │  96 px phone / 128 px desktop
│      The Scholar has fallen │  h1
│      Human Wizard · Level 1 │  muted identity line, if known
│      Fell in the Membrane  │  epitaph, if known
│      of Regret.             │
│       ─────── ✦ ───────     │
│ HOW THEY FELL               │
│ │ DM death narration        │  optional, never required
│ │ killing-blow result       │  read-only engine card
│ │ death-save result         │  read-only engine card
│   The Scholar is dead.      │  final engine line
│ THE RUN                     │
│ Turns · Fights · Monsters   │  only when the run snapshot exists
│ Rounds · Fatal roll         │
│ [ Read the story so far ]   │  inline story view
│                              │
│ [ Choose a new hero       ] │  sticky on phone
│   Begin Abyssal Descent     │
│   again with a new hero.    │
│   The Scholar's story is    │
│   kept.                     │
│ Explore other campaigns     │
│ Back to your realm          │
└──────────────────────────────┘
```

### Content and fallback rules

| Element | Beta copy/data | Missing data behavior |
| --- | --- | --- |
| Eyebrow | Campaign name, uppercase | `YOUR CAMPAIGN` |
| Portrait | `image_url`, then `avatar_url` | Gold `✦` glyph in the same frame |
| Heading | `{name} has fallen` | `Your character has fallen` |
| Identity | Race, class, and level | Omit unknown parts; do not invent a chapter |
| Epitaph | `Fell in {location}.` from the death snapshot | Omit |
| Intro | `Their tale ends here. The campaign does not.` | Static |
| Narration | Last DM death paragraph, if saved | Omit; restored state never waits for it |
| Result cards | Killing blow and final death-save cards | Fall back to saved engine lines |
| Final line | `{name} is dead.` or the saved engine line | Use the static name line |
| Run block | Turns, fights, monsters defeated, rounds, fatal roll | Hide the entire block until a trustworthy snapshot exists |
| Story action | `Read the story so far` | Always available when the session log loaded |
| Primary | `Choose a new hero` | Disable only while the campaign-specific route is resolving |
| Helper | `Begin {campaign} again with a new hero. {name}'s story is kept.` | `This campaign goes on. Your story is kept.` |
| Secondary | `Explore other campaigns` | Always available |
| Tertiary | `Back to your realm` | Always available as a text link |

Zeros are real values. Show `Monsters defeated 0`; never replace an unknown
value with zero. Hide only the stat that is unknown when the rest of the
snapshot is valid, or hide the full block when the snapshot itself failed.

The primary route must carry the current campaign. Starter campaigns go to
`/explore/<slug>/choose-character?campaignId=<id>`; custom campaigns go to
`/app/characters/create?campaign=<id>`. Never use bare
`/app/characters/create`, which loses the campaign context.

## Completion end view

Completion shares the exact shell and action order. Its mode-specific content
is deliberately quieter than a reward ceremony:

- Heading: `Adventure complete`.
- Intro: `{name} has finished {campaign}. The story is complete.`
- Summary: the stored completion summary, when present.
- No failure pips, red result badges, skull, or “party defeated” language.
- Primary helper: `Begin {campaign} again with a new hero. {name}'s story is kept.`
- The same story view and campaign-preserving hero route are used.

The shared shell should not force a fake “run” block for completion. When the
server eventually supplies a run snapshot, the same honest stats block can be
shown in both modes.

## Story view

`Read the story so far` opens inside the page state. It does not dismiss the
end state or reveal the live game.

- Header: `Back` and `{name} — fallen` or `{name} — adventure complete`.
- Default tab: **Log**, the saved session messages in read-only form.
- Optional tab: **Chronicle**, using the existing chronicle viewer and real
  loading/error states (`Writing…`, `Try again`).
- No composer, sheet, roll tray, or action controls that can mutate the session.
- Empty log copy: `The story so far is still being written.`

The story view must work when cards, portrait, narration, or run statistics are
missing. A failed optional enrichment fetch must never remove the next-step
buttons.

## The dying state

This is the panel shown before `mode=fallen`; it is not the end screen.
It occupies the composer slot so the page does not jump.

### Enemy turn

- Heading: `The Scholar is dying`.
- Status: `Saved ●●○` and `Failed ✕○` with text counts for screen readers.
- Copy: `You cannot act. Wait for your turn.`
- Tracker state: `Unconscious` plus the turn bar (`Round 4 · Turn 1 of 2 · Dying`).

### Player turn

- Prompt: `Death saving throw — roll a d20`.
- Hint: `No modifiers. 10 or higher saves.`
- Button: `Roll death save`.
- Auto-roll: visible text and progress bar (`Auto-roll in 38 s`), with live
  announcements at start and 10 seconds only.

### Results and stable state

- `DEATH SAVE · SUCCESS` is gold; `FAILED` is red and includes the count.
- Natural 20: `You wake with 1 HP`.
- Natural 1: `Two failures`.
- A hit while down says it is an automatic critical hit and adds two failures.
- Stable state is neutral: `The Scholar is stable. Unconscious.` It does not
  open the end screen.
- Third failed save or instant death transitions to the fallen end view without
  requiring a player message.

## Tokens and visual language

Reuse `.ir-app` tokens and the existing combat-card shell. Add no new palette.

- Ground: navy `bg-infinite-dark` / `#070b14`.
- Text: `#eaeefa`; muted `#aab3cc`.
- Gold: `#d5b070` and `#f3deb0` for identity, rule, focus, and primary action.
- Red: `#ef8a8a` or the existing destructive token only for hostile/failure
  result badges and failed-save pips.
- Neutral cards: `bg-black/35`, `border-white/10`, rounded shell,
  `border-l-[5px]` where the combat card already uses an edge.
- Typography: `.ir-display` for eyebrow, heading, numbers, and final line;
  `.ir-narr` for the epitaph and DM narration; normal app text elsewhere.
- Ornament: one gold `✦` rule. No skull, emoji, confetti, rank, or achievement.

Death is not red. Red describes a hostile result; the page itself remains
gold, grey, and restrained.

## Accessibility and responsive rules

- Use a semantic `main` with one `h1`, not an `alertdialog`.
- Focus the heading on entry and set the document title to
  `{name} has fallen — Infinite Realms` or `Adventure complete — Infinite Realms`.
- Keep visible focus at the existing 2 px gold outline and 2 px offset.
- Every target is at least 44 px; the phone primary bar includes safe-area
  padding and matching page bottom padding.
- The page must work from 360 px upward without horizontal scrolling. Long
  names wrap rather than truncate.
- Respect reduced motion: no fade or animated death pips when reduced motion
  is active.
- Never communicate state by color alone; badges and pips include words or
  counts.

## Data contract and implementation boundary

The presentation module should receive a normalized end-state model rather
than querying several unrelated sources itself:

```ts
type CampaignEndMode = 'fallen' | 'complete';

type CampaignEndStateModel = {
  mode: CampaignEndMode;
  character: {
    name: string | null;
    race: string | null;
    className: string | null;
    level: number | null;
    portraitUrl: string | null;
  };
  campaign: { id: string | null; name: string | null; starterSlug: string | null };
  epitaph: string | null;
  narration: string | null;
  finalLines: string[];
  runSummary: {
    turns: number | null;
    fights: number | null;
    monstersDefeated: number | null;
    rounds: number | null;
    fatalRoll: string | null;
  } | null;
  completionSummary: string | null;
  story: { messages: unknown[]; chronicleId?: string | null };
};
```

The server currently has the death truth and completion summary, but not a
reliable structured run summary or fatal-roll field. Additive `run_summary`
capture at the terminal event is preferable to recalculating historical
counts on every reload. Until that exists, hide the stats block. Do not make
the end page depend on a best-effort count of messages or zero-HP rows.

This design does not change routes, schemas, migrations, or end-state behavior.
The behavior/persistence work belongs to the existing #2522 lane; the visual
implementation and run snapshot belong to the follow-on #2523 lane. The
design PR must not edit `GameMainContent.tsx`, `DMMessage.tsx`,
`MessageRenderer.tsx`, or `CampaignDetailPage.tsx`, which are owned by other
lanes.

## Acceptance checks for the implementation PR

1. A third failed death save replaces the game immediately; no message is sent
   and no composer exists in the DOM.
2. An instant-death result uses the same fallen page state.
3. Reloading a dead session shows the name-only gate, then the end page without
   a composer flash.
4. A stable character never sees the end page.
5. Completion reloads into the same shared shell with completion copy.
6. Missing portrait, narration, cards, or run statistics never removes actions.
7. `Read the story so far` stays inside the end state and is read-only.
8. `Choose a new hero` preserves the current campaign and lands in its hero pick.
9. The fallen character appears in My Characters as `Fallen` and read-only.
10. At 390 px there is no horizontal scroll, the primary is reachable, and all
    targets are at least 44 px.
11. Keyboard order is heading, story, primary, explore, realm; focus starts on
    the heading.
12. Reduced-motion and color-independent status checks pass.

## Friction / simplification

- The current death and completion implementations have parallel shells, so
  the design must name a shared module before visual work can avoid drift.
- Run numbers and the fatal roll are not one reliable payload today; a snapshot
  at the terminal event is simpler and more honest than recomputing them.
- The chapter label has no data source. Omitting it is safer than printing the
  current `Chapter 1` constant on a character who died later.

Design reference head: `5591a85066d442aac0581663b0408704ea3d399b`
