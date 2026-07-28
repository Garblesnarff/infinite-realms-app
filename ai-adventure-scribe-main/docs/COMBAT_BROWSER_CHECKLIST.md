# Combat in the browser — 10-minute check

**Who this is for:** you, at the end of a long day, with a browser and nothing else.
**What it proves:** a fight starts on its own during normal play, the battle map appears with
everyone on it, an attack lands and hit points actually change, and the fight ends.

You do not need a terminal. You do not need to install anything. Every step is either
"type this" or "look at this".

If any step fails, stop and write down the step number and what you saw instead. That is
the whole bug report.

---

## Before you start

1. Open **https://infiniterealms.app** in Chrome and sign in.
2. Open a **new browser tab** — leave it on any page. (Only needed if step 12 fails; skip for now.)
3. Start a fresh game session: open a campaign and click into a session, or start a new one.
   A brand-new session is best — an old one may already be mid-fight.

---

## Part 1 — Get a fight to start

4. In the chat box, type something that walks you into danger and press Enter. For example:

   > I push open the door and step into the guard room.

5. Read the reply. If nothing hostile shows up, keep going with one more prompt:

   > I draw my sword and attack the nearest guard.

   Repeat at most three times. The Dungeon Master decides when a fight begins; if three
   attempts produce no fight, that is itself the result — write it down and stop.

6. **✅ CHECK — the fight started.** You should see, within a few seconds of the reply:
   - a **red bar across the top of the chat** reading "⚔️ Combat in progress", and
   - a **grid appear above the chat** — the battle map.

   If you see the red bar but no grid, note it and continue to step 7 anyway.

---

## Part 2 — The map

7. **✅ CHECK — the map has people on it.** Look at the grid. You should see coloured markers,
   not an empty checkerboard. There should be at least two: you, and whatever you are fighting.
   Hovering a marker shows its name.

8. **✅ CHECK — the map names the right combatants.** The names on the markers should match the
   names in the story you just read. A goblin in the text should be a goblin on the map.

9. Click the **⤢ (expand)** button in the map's top-right corner and then click it again to
   shrink it. The map should grow and shrink without the page breaking.

---

## Part 3 — An attack that actually does something

10. Before attacking, note the enemy's hit points. Open the side panel on the right (if it is
    collapsed, click to expand it) and look at the **Combat** tab. Write down the enemy's HP —
    e.g. `Goblin 7/7`.

11. In the chat box, attack. Be specific about the target:

    > I swing my sword at the goblin.

12. **✅ CHECK — the numbers moved.** After the DM replies, look at the Combat tab again.
    The enemy's hit points should be **lower than what you wrote down in step 10** (unless the
    story clearly says you missed — in that case attack again and re-check).

    The change should appear **without you reloading the page**.

    > If nothing changed: reload the page (Cmd+R / F5) and look again. If the number is
    > correct after a reload but not before, that is a live-update bug — note it exactly that
    > way, it is a different problem from the attack not working.

13. Keep attacking with the same prompt until the enemy drops. Usually two to four swings.

---

## Part 4 — The fight ends

14. **✅ CHECK — the fight ended cleanly.** When the last enemy falls, within a few seconds:
    - the red "⚔️ Combat in progress" bar **disappears**, and
    - the battle map **disappears**, and
    - the DM narrates the end of the fight — the final blow and what you are left standing in.

15. **✅ CHECK — the DM knows the fight is over.** Type one more ordinary message:

    > I search the bodies.

    The reply should read like exploration, not combat. It must **not** ask you for initiative,
    talk about whose turn it is, or start a new fight in the same breath.

---

## What "pass" looks like

All six ✅ CHECK steps behaved as described: 6, 7, 8, 12, 14, 15.

## What to send back if something failed

- The step number.
- What you saw instead, in one sentence.
- A screenshot of the whole browser window (Cmd+Shift+4 then Space, then click the window).
- The session URL from the address bar.

That is enough to reproduce it. Nothing else is needed.
