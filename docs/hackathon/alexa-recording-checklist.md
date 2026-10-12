# Alexa+ companion recording and judge-access checklist

Draft for #215; unchecked items are pending, not evidence of completion.
Use the [demo script](alexa-demo-script.md) and the accepted #382 runbook.

## Before rehearsal

- [ ] Record the selected reviewed companion SHA, public MIT repo URL and
      published submission SHA. Rob creates the repo using the
      [prepared handoff](https://github.com/Garblesnarff/infinite-realms-app/issues/215#issuecomment-6116895666).
- [ ] From a clean export, run `bun install --frozen-lockfile` and
      `bun run typecheck`. Confirm the README startup takes under five minutes
      once access is supplied. Measure it; do not claim an unmeasured time.
- [ ] Privately obtain the approved API endpoint, dedicated demo-account
      access and owned synthetic session/character instructions. Confirm
      companions are enabled and a companion seat is free. Production config
      or quota changes require Rob's separate approval.
- [ ] Obtain a valid WorkOS access credential through normal sign-in and
      supply it as `IR_DEMO_TOKEN`. It is not an arbitrary static string.
      Keep credentials out of commands, capture, public logs and committed files.
- [ ] Prepare a non-combat tavern/door scene with synthetic content. Show only
      this session; close account pages, unrelated tabs and notifications.
- [ ] Keep the MCP server on loopback. A supplied hosted demo endpoint is the
      upstream HTTP API; do not expose the unauthenticated MCP port.

## Real API rehearsal — required before recording

- [ ] Record the rehearsal time and reviewed source SHA privately.
- [ ] Initialize the real MCP server and list all six tools in the local page.
- [ ] Run `join_party` and confirm success plus the updated party.
- [ ] Run `get_scene` and confirm the synthetic scene and party roster.
- [ ] Run `speak_as_companion` and confirm the exact spoken line appears in
      the real app transcript.
- [ ] Run `roll_for_companion` and confirm a successful server d20, modifier
      and total, with the roll present in the real app transcript.
- [ ] Send `look around`; confirm another successful `get_scene` call.
- [ ] Send `leave` and confirm success before repeating the demo.
- [ ] Check every tool result, not only the friendly reply or completion banner.
      Refresh expired access and restart the MCP server for a 401. For a 404,
      check ownership, ids and feature enablement; for the cap, free a seat.

Existing fixture tests prove transport and route contracts. They do not
complete this real-authentication/persistence rehearsal.

## Record and inspect

- [ ] Capture the two-minute script with the simulation label, readable tool
      log and synthetic app transcript. Use text input unless voice was tested.
- [ ] Narrate the actual roll result without claiming a mechanical outcome
      the API did not return. Avoid combat, autonomous-agent and Alexa-device claims.
- [ ] Keep credentials, account identity, production hostnames/IPs and private
      session/character ids out of the final frames. Crop or blur id fields.
- [ ] Use original narration and permitted visual material; omit music and
      unrelated third-party logos.
- [ ] Watch the entire exported recording. Confirm legibility, intelligible
      audio, truthful edits, successful calls and duration below three minutes.
- [ ] Rob approves the final video and its publication; record the public
      YouTube/Vimeo URL and duration. No upload or publication is performed by
      this checklist.

## Judge access and final submission

- [ ] Have someone follow the public repo README from a clean environment.
      Confirm both the local MCP/client startup and real upstream access.
- [ ] Arrange renewable access privately through judging, including quota
      and synthetic owned session instructions. A recording token is not a
      durable judge login; the companion has no OAuth refresh flow.
- [ ] Rob checks the source license, final revision, video and private test
      instructions against the [Devpost draft](alexa-devpost-draft.md).
- [ ] Rob fills measured product feedback, confirms the claimed event-period
      changes and submits. Keep the private access fields separate from public text.

The [official rules](https://amazonappdev2026.devpost.com/rules) specify
Oct 23, 2026 at noon Pacific for submission and judging through Nov 20.
Recheck those dates and the form immediately before submission.
