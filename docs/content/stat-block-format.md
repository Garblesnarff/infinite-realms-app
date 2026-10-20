# Authored monster stat blocks — the attack line

Campaign bibles in this project put a monster's attack on one labelled line. This file is the author-facing copy of that line. There is no `CAMPAIGN-BIBLE-FORMAT-SPEC.md` in this repo. The code that reads the line is `ai-adventure-scribe-main/server-bun/src/services/combat/authored-stat-block-parser.ts` (the comment on `labelPattern` is not the copy authors should follow). Geometry is read from the same line by `readGeometry()` in `monster-attack-profile.ts`.

A name goes in **one parenthetical after `Attack`**, and nowhere else. The text after the colon must still start with `+N`. `Attack: Ink Lash, +5` is refused.

Markdown emphasis around the label is optional (`**Attack:**`, `*Attack:*`, or `Attack:`).

## Examples

Melee with reach. The swing is named Tendril Lash and is melee at 10 ft:

```text
**Attack (Tendril Lash):** +3 to hit, reach 10 ft, 1d6 slashing
```

Ranged, with a normal range and a long range (`range N/M ft`). The swing is named Spit, normal range 30 ft, long range 120 ft:

```text
**Attack (Spit):** +4 to hit, range 30/120 ft, 1d8 poison
```

`range N ft` (one number, no slash) is also ranged, at that distance only. The launch bestiaries use `range 60 ft` that way.

Plain unnamed attack. No parenthetical, and no reach or range, so the swing is `<Monster> attack` at melee 5 ft:

```text
**Attack:** +7 to hit, 2d10+4 bludgeoning
```

## What the line means

- `reach N ft` is melee at N feet. It is not a ranged attack.
- `range N ft` is ranged. N is the normal range.
- `range N/M ft` is ranged. N is the normal range and M is the long range.
- A line with no reach and no range stays melee 5 ft.
- Omit the parenthetical and the swing is still `<Monster> attack`.
- A parenthetical that is not a name is ignored, and the `+N` is still read. A name is letters, spaces, hyphens, and apostrophes (for example `Ink Lash`). `()`, `(2d6)`, and a name that starts with a digit are not names.
- One attack line per monster. The engine resolves one attack on the monster's turn. A second `Attack:` line is not a second attack.
- Damage on this line is unchanged: dice as `NdN` or `NdN+N`, then one damage type. Save-based abilities (a breath weapon, a gaze, "DC 14 or be stunned") are still not executed.

The name parenthetical is the form added for #2213 (draft PR #2220). It is not on `main` yet. Until that parser is merged, `Attack` has to be followed directly by the colon. A parenthetical between them is not skipped, and the `+N` is not read. `range` / `reach` words are safe to write before that merge; they do not change distance until the same parser is on `main`.

## Boss Moves and mooks (#728)

A boss can author three scripted moves, one line each: `Opener`, `Turnabout`, and `Finale`. Each line has five parts separated by `|`, and every part is required:

```text
**Opener:** Starlit Lash | effect: strike | tell: The geometry folds toward one point. | telegraph: none | counterplay: Keep out of reach.
**Turnabout:** Gaze of the Void | effect: frighten wis | tell: Every torch in the chasm dims. | telegraph: none | counterplay: Hold to the rope.
**Finale:** Reality Break | effect: burst int | tell: Your thoughts echo back a half-beat wrong. | telegraph: The walls take on a deeper shade of dark. | counterplay: Take the Dodge action while it is telegraphed.
```

- The first part is the move's name: letters, spaces, hyphens, and apostrophes.
- `effect` is a closed list. `strike` is an attack roll. `burst <ability>` is a save for half damage. `frighten <ability>` is a save, and a failed save leaves the hero frightened for one round. Ability is one of `str dex con int wis cha`. Any other effect is refused, and that move is not used.
- `telegraph` is `none` for Opener and Turnabout. A Finale needs a real telegraph, because it is announced one round before it fires.
- A line that breaks this shape is refused whole and its label is reported as unparsed. Nothing is guessed.

A boss uses at most one move per round, each move once per fight. Damage comes from the boss's own attack line: Opener is half of it, Turnabout is all of it, and Finale is one and a half times. No move averages more than 40% of the hero's max HP.

`Mook: yes` marks a minion with no HP track (a house rule, not SRD 5.1). Any damage that lands on a mook drops it.
