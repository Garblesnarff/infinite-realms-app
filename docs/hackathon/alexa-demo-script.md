# Infinite Realms companion — two-minute demo script

Draft for #215. Rehearse against approved real HTTP API access before recording.
Source: #272 PASS `4befff22fe84bce17d0b33f56563420c664791cf`.
Preparation: [recording checklist](alexa-recording-checklist.md).
The accepted runbook is in #382 at `108f3f77f0ac38a7824d0524241a6c059adf31e9`;
it is not yet on main. The prepared MIT export is described in the
[Rob handoff](https://github.com/Garblesnarff/infinite-realms-app/issues/215#issuecomment-6116895666).

Use one synthetic non-combat scene, one player and one companion with an
available companion seat. Enter the owned session and character ids before
capture. Show the local client beside the real app transcript. Keep the
simulation label and tool log visible. Text input is the reliable baseline;
browser speech output or microphone input is optional, after rehearsal.

| Time      | Action                                                  | Narration                                                                                                                                                                                               |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Show the local page and simulation label.               | “This is the Infinite Realms companion, a simulated Alexa+ browser experience connected to a self-hosted MCP server. A player can invite a companion into a tabletop party.”                            |
| 0:15–0:30 | Show the six listed tools.                              | “The browser connects over Streamable HTTP. Six tools join the party, read the scene, speak, roll, list companions and leave.”                                                                          |
| 0:30–0:45 | Click **Run scripted demo** once; show `join_party`.    | “First, our companion joins this owned session. The server returns the companion and the updated party.”                                                                                                |
| 0:45–1:00 | Show `get_scene` and its reply.                         | “Next, we read the current scene and party roster. This response is redacted by the game API.”                                                                                                          |
| 1:00–1:15 | Show `speak_as_companion` and the app transcript.       | “The companion says, ‘Stay behind me. I will check the door for traps.’ The tool sends that line to the game.”                                                                                          |
| 1:15–1:30 | Show `roll_for_companion`, its d20, modifier and total. | “Now the game server resolves a Perception roll. We display the returned result; the browser does not decide the die or whether a trap is found.”                                                       |
| 1:30–1:45 | Type `look around`; show another `get_scene` result.    | “The player can continue with short text commands. Looking around reads the scene again through the same MCP connection.”                                                                               |
| 1:45–2:00 | Show source overview and the local setup instructions.  | “The new hackathon work is the companion MCP layer and this browser client. Judges can run them locally with supplied API access. The game backend predates the event and remains separately licensed.” |

The scripted calls may complete faster than the narration. Rehearse the pace
and use a cut or hold on the actual result panels; do not fabricate a live
sequence or results. Read the rolled total only after it appears. It varies.
The client uses command matching and scripted sequencing; do not describe it
as an autonomous agent, Amazon-hosted Alexa+, or implemented account linking.

Confirm all four tool calls succeeded and the real app transcript contains
the speech and roll before accepting the take. The “demo complete” banner
alone is insufficient: intermediate tool errors can still reach that banner.
If access expires or a call fails, stop, correct the access/session privately
and record a clean take. Use `leave`, verify success, then repeat the demo.

Keep the finished narration near two minutes. The [official rules](https://amazonappdev2026.devpost.com/rules)
set a video limit below three minutes. Rob approves publication and submission.
