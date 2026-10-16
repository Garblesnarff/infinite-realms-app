# #716 fixture (built, not recorded live)

One OpenRouter chat-completion response for the Hark D5-029 turn (build 68c3b1db): the engine
rolled one enemy HIT on the player, and the DM prose lands a second strike.

- Producer: `llmFetch` in `server-bun/src/services/llm-fixture-fetch.ts`, LLM_RECORD_DIR branch
  (#734). `build-fixture.ts` runs `LLMProviderService.generate` over a stubbed `fetch`, so the
  file has the exact key, URL, request and response layout a live recording would have.
- Not a live recording. No provider key was used. The Hetzner ops session records the real
  fixtures (strategist, DAY QUEUE 2026-10-16 on #357). Replace this one when a real recording
  of an extra-strike turn exists.
