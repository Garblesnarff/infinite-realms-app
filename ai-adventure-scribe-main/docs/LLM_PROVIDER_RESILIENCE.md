# LLM provider resilience

The server validates configured OpenRouter and Gemini model IDs at boot and every six hours. An invalid model or an OpenRouter text model without both `response_format` and `structured_outputs` support makes `/health` report `status: "degraded"` while the process remains available. The OpenRouter text path tries `OPENROUTER_TEXT_MODEL`, then the comma-separated `OPENROUTER_FALLBACK_MODELS` list. Defaults are currently listed, low-cost, schema-capable models: `google/gemini-3.1-flash-lite`, `nex-agi/nex-n2-mini`, and `inclusionai/ling-2.6-1t`.

Provider HTTP errors never pass their status through to clients. Exhausted provider model chains return HTTP 502 with `error: "upstream_model_error"`, the provider/model, the upstream status, and a retryability flag. Circuit breakers open only after the complete candidate chain fails.

## Hetzner synthetic check

The smoke check sends a real authenticated generate request, so it reaches the configured provider and requires a non-empty response. Put `LLM_SMOKE_BEARER_TOKEN` (and optionally `LLM_SMOKE_BASE_URL`) in `/etc/infiniterealms/llm-smoke.env`. With cron mail configured, install this line on Hetzner to run it every six hours:

```cron
0 */6 * * * cd /var/www/infiniterealms/ai-adventure-scribe-main && set -a && . /etc/infiniterealms/llm-smoke.env && set +a && /usr/local/bin/bun run scripts/llm-smoke.ts
```

Configure cron's `MAILTO` to the Hetzner operator mailbox so the non-zero exit and diagnostic output are mailed. There is no Slack `#dev-dispatch` integration in the server code today, so failures deliberately exit non-zero for cron mail rather than pretending to post to Slack.
