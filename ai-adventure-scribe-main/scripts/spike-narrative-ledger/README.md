# Spike: Engine Ledger proof-of-concept (THROWAWAY)

Companion to `docs/memory-system-design-v2.md` §5 (this rebase is Phase 0.9). Not wired to
production. No dependencies.

Builds a bi-temporal narrative-fact ledger from **deterministic events only** (roll
requests/results, combat boundaries — all events the server already resolves) out of real
playtest transcripts, renders the `<scene_state>` prompt block the design proposes, and
flags transcript statements that contradict then-current facts.

```bash
node scripts/spike-narrative-ledger/ledger-spike.mjs \
  aggressive-playtest-3.log first-agent-playtest.log aggressive-playtest.log
```

Results against the three local transcripts (2026-07-28):

| Transcript | Facts built | Contradictions caught |
|---|---|---|
| aggressive-playtest-3.log | 3 (incl. `void-maw status=dead` from combat boundary) | 2 × F4 sheet-fact drift (`1d20+3` vs ledger `+5`) |
| first-agent-playtest.log | 2 (warning-learned, with supersession) | 1 × F1 resolved-beat regression ("One more chance to listen" after confirmed success) |
| aggressive-playtest.log | 1 | 1 × F4 symbolic formula (`1d20+dex` — the bug that killed 25 turns) |

Zero false positives from the dead-creature-reintroduction rule.

What this proves: the highest-value continuity facts are recoverable from events the
engine already owns, with **no LLM extraction**, and checking prose against them is cheap.
What it does not prove: that the model *obeys* an injected `<scene_state>` block — that is
the §5 pass/fail experiment to run with the live harness.
