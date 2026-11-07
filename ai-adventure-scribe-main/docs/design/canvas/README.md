# The Table — design canvas boards (reference only)

Source: the design canvas "The Table — DM Screen Concept" (claude.ai Design artifact), exported 2026-11-06 for issue #92 and the Table tickets (#1408–#1414, #1421). These files are the spec for the Table UI: structure, sizes, spacing, colours, fonts and copy. Read them as HTML+CSS; nothing here is imported by the app.

Not included: the canvas runtime (`support.js`, `/_blob/…` scripts) and the image blobs (`/_blob/<hash>`), so the files do not render standalone. The markup, inline styles and `<style>` blocks are complete. Boards that only set a preset (`<dc-import name="Main" preset="crit">`) are states of the named board.

| File | Board | Size |
|---|---|---|
| `Main.dc.html` | Combat · your turn (desktop, playable) | 1440×900 |
| `Critical.dc.html` | Combat · natural 20 (same board, crit state) | 1440×900 |
| `Phone.dc.html` | Combat · phone 390 (playable) | 390×844 |
| `Explore.dc.html` | Chat mode · exploring (desktop, playable) | 1440×900 |
| `Check.dc.html` | Chat mode · ability check pop-up | 1440×900 |
| `ExplorePhone.dc.html` | Chat mode · phone 390 (playable) | 390×844 |
| `Campaigns.dc.html` | Start · choose a campaign | 1440×900 |
| `Heroes.dc.html` | Start · choose a hero | 1440×900 |
| `Materials.dc.html` | Materials kit | 1440×1000 |
| `Landing.dc.html` | Public · landing (desktop) | 1440×3100 |
| `PublicExplore.dc.html` | Public · /explore | 1440×900 |
| `PublicCampaign.dc.html` | Public · campaign page | 1440×1100 |
| `LandingPhone.dc.html` | Public · landing (phone 390) | 390×3020 |
| `Panels.dc.html` | Game panels · memory, journal, voice (desktop) | 1440×900 |
| `PanelsSettings.dc.html` | Game panels · settings sheet | 1440×900 |
| `PanelsPhone.dc.html` | Game panels · phone 390 | 390×844 |
| `PanelsPhoneSheet.dc.html` | Game panels · phone, memory sheet open | 390×844 |
| `Chronicle.dc.html` | Chronicle · shared page (logged out) | 1440×900 |
| `ChronicleOwner.dc.html` | Chronicle · in game, with Share | 1440×900 |
| `ChronicleFree.dc.html` | Chronicle · free plan | 1440×900 |
| `Fight.dc.html` | Combat · read the fight (desktop, playable) | 1440×900 |
| `FightCasting.dc.html` | Combat · casting from the sheet (today: 45 s wait) | 1440×900 |
| `FightSave.dc.html` | Combat · “Target saves” card | 1440×900 |
| `FightDone.dc.html` | Combat · result stays in view | 1440×900 |
| `FightPhone.dc.html` | Combat · read the fight (phone 390) | 390×844 |
| `FightPhoneCast.dc.html` | Phone · casting, sheet at 42% | 390×844 |
| `FightPhoneSave.dc.html` | Phone · Target saves card | 390×844 |
| `FightPhoneDone.dc.html` | Phone · result in view | 390×844 |
| `Results.dc.html` | Engine result cards (9 cases, today vs proposed) | 1440×1980 |
| `Rounds.dc.html` | Round and turn — wrap demo | 1440×720 |
| `Death.dc.html` | End of story · desktop (shown full length) | 1440×1340 |
| `DeathStory.dc.html` | End of story · “Read the story so far” (Log, Chronicle) | 1440×900 |
| `DeathPhoneLive.dc.html` | Phone · play the death: dying → third failed save → end screen | 390×844 |
| `DeathPhone.dc.html` | Phone · end screen, restored (reload) | 390×844 |
| `DeathPhoneStory.dc.html` | Phone · read the story so far | 390×844 |
| `DeathPhoneNoData.dc.html` | Phone · data missing (no portrait, cards, stats) | 390×844 |
| `DeathReload.dc.html` | Reload state · today vs proposed | 1440×1040 |
| `DyingStates.dc.html` | Dying panel · every state (#2518) | 1440×1160 |

## Designer's notes from the canvas

**chatHow** — Chat mode has no initiative and no action cards. Tap an idea card or write your own line.

Tap “Climb down the rope”: the DM asks for a Strength (Athletics) check. The check card slides out from the DM screen, and the dice-tray lid opens.

The card shows the math (d20 + STR + proficiency), the DC and the Inspiration option (2014 rule: advantage on one roll). “Show target numbers” is one player setting for the DC and the enemy AC. It starts on in Easy and Medium campaigns and off in Hard ones, so this card starts with “DC hidden”. The switch on the card changes it; Tweaks → Settings → Difficulty changes the default.

After the roll, a wax seal says Success or Failed, and a failed climb costs HP.

**deathHow** — Full-screen takeover, not an overlay or a dimmed game. The page reads one value: the saved dead flag.

Sample: The Scholar (Human Wizard, HP 7, AC 11) against Captain Sarah Reeves, as in stranger run 16. Numbers in “The run” are examples. The server has no run-summary field yet (see the spec). Until it has, the block is hidden.

The DM paragraph is sample text. The screen works without it.

Try it: on the desktop board press “Read the story so far”, then Chronicle, then “Write the chronicle”. Tweaks → State: phase (live, restored, data missing), view, tab.

Death is not red. Gold and grey frame the page. Red appears only on HIT and FAILED badges and the failure pips.

**deathPhoneHow** — Phone 390. Press “Roll death save” on the first board. Saves: 14 (success), then Captain Sarah Reeves hits the unconscious Scholar (critical: two failures), then a 2 (third failure). The end screen then fades in, and the DM line arrives after 3 s. “Replay” resets. If you do nothing, the auto-roll fires at 0 s (45 s here; the real time comes from #2504).

The primary button is a sticky bar. Scroll the end screen to see Explore other campaigns and Back to your realm after it. Tab order: story, new hero, explore, realm.

The “Replay” button and the dashed demo box are for this canvas only.

**fightHow** — Data is from stranger run 16: The Scholar (Human Wizard, HP 7, AC 11, +6 spell attack, DC 14) against Captain Sarah Reeves.

Tweaks: Moment (which turn), Stage (idle, casting, save, resolving, done), Sheet (open or closed), Order (today = the cast waits 40 s before the Target saves card; fixed = the card comes at once, #2392), Difficulty (Medium by default, as in the runs; Hard hides AC and DC).

Try it: on the desktop board open the sheet, press Cast on Acid Splash. The demo runs 5 s per second. Replay from the start resets.

The round goes up only when the first actor in the order acts again. See the Rounds board.

Badge colour: gold helps you, red hurts you, grey changes nothing. Every badge also has a word and a shape.

**fightPhoneHow** — Phone 390. The sheet is a bottom sheet, not a full cover. The chat and the newest result stay above it (sheet height: 68% idle, 42% casting, 36% with the save card, 58% after). The tray slot keeps the Target saves card.

**howto** — Combat. Main and Phone are playable with real 3D dice: pick Attack, press Roll. The die lands on the number the rules engine picked. A natural 20 fills the tray with gold light; a natural 1 gets a dark ribbon.

Tap the Inspiration token (top right) before you roll: you roll 2d20 and keep the higher.

Natural 20 is the same board in its crit state (Tweaks → State).

Abyssal Descent is a Hard campaign, so the spider’s AC starts hidden (“AC ?”, “vs the spider’s AC”). Tweaks → Settings → Difficulty: pick Easy or Medium to see “AC 15”.

**panelsHow** — Panels use only data the code has: memory categories, content, metadata, importance and time; DM handouts; the chronicle.

Try it: Memory tab → search, pick a filter, press “That’s wrong” on a card. Listen button: Tweaks → State → Voice demo shows idle, preparing, playing, error and limit. Gear button opens Settings. “Show target numbers” follows the difficulty (Tweaks → Settings).

“That’s wrong” (edit and forget) needs an API. It is a decision for Rob (see the issue).

The Chronicle boards: logged-out reader, the in-game dialog with Share, and the free-plan version. The public share page needs a route in the app first.

**publicHow** — These pages use the same navy, gold and teal as the game, with Cinzel, DM Sans and EB Garamond.

All copy and art are real (from the live pages and the campaign data). Text in [brackets] is a placeholder for a value the code does not give yet.

The product picture on the landing page is a stand-in. A real capture of the game replaces it.

Try it: on the landing page press Play in the Voice block. On /explore, each card is one link. On the campaign page, pick a hero and press “Read more”.

Hard campaigns start with target numbers hidden. The campaign page says so, and where to change it.

**startHow** — Real covers and hero cards from the campaigns.

Choose a campaign, then a hero; “Play as …” opens chat mode. Only Abyssal Descent has hero cards in this prototype.

The line under the button tells the player if target numbers (DC and AC) start shown or hidden for that campaign.
