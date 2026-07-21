# LLM provider resilience

The server validates configured OpenRouter and Gemini model IDs at boot and every six hours. An invalid model or an OpenRouter text model without both `response_format` and `structured_outputs` support makes `/health` report `status: "degraded"` while the process remains available. The OpenRouter text path tries `OPENROUTER_TEXT_MODEL`, then the comma-separated `OPENROUTER_FALLBACK_MODELS` list. Defaults are currently listed, low-cost, schema-capable models: `google/gemini-3.1-flash-lite`, `nex-agi/nex-n2-mini`, and `inclusionai/ling-2.6-1t`.

Provider HTTP errors never pass their status through to clients. Exhausted provider model chains return HTTP 502 with `error: "upstream_model_error"`, the provider/model, the upstream status, and a retryability flag. Circuit breakers open only after the complete candidate chain fails.

## Hetzner synthetic journey

`scripts/api-smoke.ts` replaces the old LLM-only smoke. It checks `/health`, the public Eternal Feast starter templates, an authenticated session list and joined session context, a realistic authenticated LLM generation, and the JSON 404 contract for a sessionless tactical-map request. Every check prints one `PASS` or `FAIL` line and any failure exits non-zero.

Put these values in `/etc/infiniterealms/llm-smoke.env`:

```bash
LLM_SMOKE_BEARER_TOKEN=<long-lived smoke-user access token>
# Optional overrides:
# API_SMOKE_BASE_URL=https://api.infiniterealms.app
# API_SMOKE_SESSION_ID=<owned session id; otherwise the first listed session is used>
# LLM_SMOKE_PROVIDER=openrouter
# SLACK_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
```

The smoke user must own at least one session with joined campaign, character, and stats data. Without `LLM_SMOKE_BEARER_TOKEN`, a developer run exercises the public checks and prints `PASS ... SKIP` for the four authenticated checks. A local machine with no database can explicitly set `API_SMOKE_ALLOW_INFRA_SKIPS=1`; only a 5xx from the database-backed starter-template check is then reported as a skip. Deploy and scheduled invocations never set that escape hatch and use `API_SMOKE_REQUIRE_AUTH=1`, so missing auth, DB data, or provider access fails closed.

With cron mail configured, replace the old `llm-smoke.ts` cron entry with this six-hour journey:

```cron
0 */6 * * * cd /var/www/infiniterealms/ai-adventure-scribe-main && set -a && . /etc/infiniterealms/llm-smoke.env && set +a && API_SMOKE_REQUIRE_AUTH=1 API_SMOKE_ALLOW_INFRA_SKIPS=0 /usr/local/bin/bun run scripts/api-smoke.ts
```

Configure cron's `MAILTO` to the Hetzner operator mailbox so non-zero exits and the named failing checks are mailed. The deploy gate additionally sends failures to `SLACK_ALERT_WEBHOOK_URL`; if it is unset or delivery fails, it writes `/var/log/infiniterealms/DEPLOY_FAILED_SMOKE` and exits non-zero for cron mail.

For a local boot, start the Bun API on port 8888 and run:

```bash
API_SMOKE_ALLOW_INFRA_SKIPS=1 bun run scripts/api-smoke.ts
```

Health runs without database credentials. Starter templates require the database unless the explicit local-only skip flag is set. Session, context, LLM, and tactical-map checks need the smoke token plus the server's database/provider environment and otherwise skip as described above.
