# Wave 6 LLM consolidation

The live game route uses `AIService.chatWithDM` and the authenticated
`infrastructure/api/rest-client` transport. The older modular narration service is retained as a
deprecated compatibility facade because it remains exported from `services/ai`; it is not part of
the `/app/game/:id` import chain.

`supabase/functions/dm-agent-execute` remains deployed for now. It accepts the older
`task`/`agentContext`/`combatContext` contract and invokes edge-only prompt builders and auxiliary
generators. The Bun `/v1/llm` pipeline accepts an already-built prompt and cannot replace that
contract without migrating and verifying every edge-function caller. Redirecting it during
dead-code cleanup would therefore risk changing combat narration behavior. A later migration
should first inventory remote Supabase invocations, add a Bun compatibility endpoint, and then
deprecate the edge function with telemetry.
