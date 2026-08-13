# Combat System Design v2

**Status:** Owner decisions D1–D8 made 2026-08-12 (design session, Rob + architect). D6 confirmed in-session from Rob's own framing; flag any change at review.
**Companion doc:** `docs/memory-system-design-v2.md` — shares the same discipline: numbered decisions, phased delivery, no speculative work beyond the current phase.
**Epic:** #1751. Absorbed issues: #1672 (XP), #1712 (HP), #1714 (HP narration), #1715 (ceremony), #1739 (spell identity), #1744 follow-ups, #1716 spell extension.

## §1 Vision

The engine owns truth; the DM owns narration. Every number — hit, miss, damage, HP, XP, distance, advantage — comes from the engine. The DM describes what the engine resolved and may never invent, adjust, or omit a mechanical outcome. The player's dice are the player's: any roll that belongs to their character (attacks, checks, saves, death saves) is offered to them first (#1716 propose → popup → commit), engine-rolled only on cancel/fallback and labeled "(auto-rolled)".

The two 2026-08-11/12 playtests are the reference evidence for why: every combat failure observed was either the DM fabricating outcomes (fake kill, greataxe-that-never-was) or an undecided rule (whose turn, where's movement, how do I cast). This doc decides the rules; the enforcement architecture (refusal + repair + ledger) already works.

## §2 Glossary

- **Encounter** — one combat, engine-owned state: participants, initiative order, round, turn resources. Created at combat start, closed by `concludeEncounter` (the single chokepoint for endings, XP, HP write-back).
- **Turn resources** — the spendable set for one participant's turn. Schema holds `action`, `move`, `bonus_action`, `reaction`; v1 enforces the first two (D1).
- **Tactical grid** — authoritative coordinates per participant. Source of distance, reach, cover, and adv/dis derivation (D2, D7).
- **Proposal** — read-only-except-approach dry run of an attack/cast returning bonus, target AC/DC, advantage state, powering the player dice popup (#1716).
- **Condition tier** — the engine's qualitative health description (unharmed / wounded / bloodied / near death) provided in the tactical digest; the only health language the DM may use (#1714).
- **Entry vector** — the campaign-bible-defined way a NEW character plausibly enters the ongoing world (The Eternal Feast: hired as new staff). Used at playthrough start and after a character death (D6).

## §3 Decisions

### D1 — Action economy: Action + Move now, full 5e later, additively
V1 enforces one **action** and **movement** per turn. `bonus_action` and `reaction` exist in the schema, disabled. Adding them later is a flag-flip and prompt change, not a migration. The UI (and the tactical digest) always states what remains: "Action: available · Move: 20ft left."

### D2 — Movement: grid-authoritative, words-first; click-to-move is a later accelerator
The grid stays the source of truth for distance/reach/cover. The player moves **by words** ("I close with Balthazar", "I fall back to the doorway") and the engine translates to squares — the same translation the #1716 propose already performs for attack approaches. Click-to-move ships later as an alternate input to the SAME engine calls. **Hard requirement:** the DM narrates positions in words every combat turn (roster, ranges, flanks) so a voice-only or eyes-closed player can play the map blind. This is a #1715 ceremony rule, not an optional flourish.

### D3 — Turn flow: auto-run every NPC turn to the player's next turn
After the player's action resolves, the engine runs ALL non-player turns in initiative order — real rolls, real resources, per-turn auto-advance (the #1744 fix generalized: the engine never waits for the LLM to remember `end_turn`). The player receives one narration block covering everything that happened, ending with "Round N — your turn." Consequence: **whenever the player can type, it is legally their turn** — the out-of-turn refusal class (#1744) becomes structurally impossible, and the input-gating UI reduces to a progress state while NPC turns resolve.

### D4 — XP: automatic by monster CR at concludeEncounter (#1672 resolved)
Encounter ends → engine sums standard XP from defeated/routed hostiles' CR, banks it on the authoritative character record, announces it ("+150 XP · 350/900 to level 3"). No DM discretion over the number. Level-up is a separate guided flow (later phase); XP accrual ships first so no encounter is ever un-rewarded again.

### D5 — Spellcasting v1: cantrips + leveled slots, single-target only
Casting costs the action (D1). Slot tracking is real. Attack-roll spells reuse the #1716 propose/popup path — the caster rolls their own spell attack. Save-based spells: the TARGET's save is engine-rolled for NPCs; when the player is the target of any save-forcing effect, the player rolls their own save via popup. Multi-target spells (Fireball) and concentration are explicitly v2 — deferred, not half-built. Prerequisite: #1739 (spell identity slug mapping).

### D6 — Death: the character dies; the world does not
Death saves are real 5e death saves and the player rolls them (popups). Three failures = the character is **permanently dead** — hardcore, no resurrection-by-default. But death ends a CHARACTER, never a PLAYTHROUGH: the death is written to the ledger as canon (a world_event/narrative_fact), the DM narrates an epilogue from the campaign's stakes, and the player is offered "begin a new character in this world." The new character enters via the campaign's **entry vector** into the same living world — NPCs remember the fallen, their deeds and grave are canon, and the world the player grew attached to persists. Rationale (owner, in-session): permadeath stakes without "you rolled a 1 on a ladder and lost a year-old world."

### D7 — Advantage/disadvantage only in v1; engine-derived ONLY; full conditions are the end goal
No condition list in v1. The engine may grant advantage/disadvantage from **deterministic, grid/state-derived sources only** (initial source list in §6 open questions — e.g., target engaged by another hostile). The DM may never grant, claim, or narrate a mechanical adv/dis — if it isn't in the engine's resolution, it doesn't exist (the same fabrication door we closed for HP stays closed here). **End-goal (owner decision):** full condition modeling (prone, restrained, poisoned, …) as engine state in v2 — D7 is a staging decision, not a scope cut.

### D8 — HP has ONE owner: the character record (#1712 direction ratified)
`character_stats` is authoritative. Encounter participants copy current/max at seeding (never invent them — the 10/11-vs-9/9 bug), damage applies to the participant during combat, and `concludeEncounter` (plus periodic ticks) writes the delta back. UI reads one source in combat. "Character vitals" joins the memory-v2 glossary ownership table when implemented.

## §4 Phases

Each phase lands only after the prior one is playtest-verified in prod. No agent starts phase N+1 work while N is unverified.

- **Phase C0 (in flight):** #1744 blockers — NPC turn auto-advance + refused-actions-never-narrated-as-outcomes; #1747 stale-client toast. DONE WHEN: the wedged encounter 10444307 pattern cannot recur; a refused attack produces no fabricated outcome.
- **Phase C1 — Turn integrity & ceremony:** turn-resource model (action+move) enforced and shown; D3 auto-run of NPC turns; input gating (it is always your turn when you can type); #1715 ceremony (roster announcement with counts, position narration for voice play, numbered token badges). DONE WHEN: a full fight plays with visible rounds, no out-of-turn refusals, and the player always knows who/where the enemies are without opening the map.
- **Phase C2 — Honest numbers:** D8 HP unification (#1712); D4 XP at concludeEncounter (#1672); condition tiers in digest + no-numeric-HP narration (#1714, #1738); combat endings (victory/flee/defeat paths all through concludeEncounter). DONE WHEN: sheet and party card agree at all times and every encounter pays XP.
- **Phase C3 — Movement:** words-→-squares movement intents; move-resource spending; adv/dis v1 sources (D7) derived from the grid; DM position-narration rules hardened. DONE WHEN: "I fall back to the door" moves the token, spends movement, and the narration matches the grid.
- **Phase C4 — Spells v1 (D5):** after #1739; slot tracking; spell attacks through propose/popup; player-rolled saves; casting UI in combat. DONE WHEN: a level-1 wizard can fight with cantrips + one leveled spell, rolling their own dice.
- **Phase C5 — Death & continuity (D6):** death-save popups; defeat → ledger canon + epilogue; new-character-in-same-world flow using entry vectors. Depends on memory-v2 playthrough boundary for the "world persists" half. DONE WHEN: a character can die and the player continues in the same world with a new character who can hear about the old one.
- **Phase C6 (v2 horizon, not scheduled):** click-to-move UI; multi-target + concentration; full condition modeling (D7 end goal); reactions/opportunity attacks; bonus actions (D1 completion).

## §5 Worker guardrails (additive to AGENTS.md)

1. Never merge; draft PRs only; gates as deltas vs origin/main.
2. Mechanical effects come only from the engine. Any PR that lets the LLM assert a number (HP, adv/dis, XP, distance) is wrong by definition.
3. Narration may not describe an unresolved or refused action as an outcome.
4. Do not start phase N+1 while phase N is unverified in prod playtest.
5. One migration tree per table's DDL (memory-v2 §6 rule applies here too).
6. If your findings disprove this doc's premise, STOP and report — the doc gets corrected, not worked around (this happened twice to #1744's original text; the discipline works).

## §6 Open questions (small — none block C0–C2)

- D7 v1 adv/dis source list: exact deterministic rules (flanking definition on the grid? unseen attacker?). Propose during C3.
- Entry vectors: add an `entry_vector` field to campaign bibles — authored for the 163+ starters or derived by the generator? Decide in C5.
- Death-save UX: shown as tense one-by-one popups or one grouped popup? Decide in C5 with playtest.
- Level-up flow (guided) — design when first character banks enough XP.
- Whether NPC-vs-NPC turns in D3's auto-run get summarized or fully narrated when many NPCs fight each other.
