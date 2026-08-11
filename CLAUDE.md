## Ground rules — READ FIRST

**Never merge PRs. Never push to `main`.** Only Rob merges; merges auto-deploy to production. Full rules for all AI agents: see `AGENTS.md` at the repo root. These apply to every Claude Code session (local, Hetzner, cloud) and every other agent.

## Agent skills

This repo uses [Matt Pocock's engineering skills](https://github.com/mattpocock/skills) (installed under `.claude/skills/`), including `/wayfinder` for planning large efforts.

### Issue tracker

Issues live as GitHub Issues on `Garblesnarff/infinite-realms-production`, managed via the `gh` CLI. PRs are not treated as a triage request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) — not yet created on the actual repo, see note below. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root (not yet created — skills create these lazily as decisions get made). See `docs/agents/domain.md`.
