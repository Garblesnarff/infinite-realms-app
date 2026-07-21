# Testing realism policy

Production regressions must be reproduced at the boundary where they escaped. A green unit test is not sufficient when a real serializer, database client return type, or provider payload participates in the failure.

## Required realism

- HTTP route tests use `app.handle(new Request(...))` through `createRequestPipelineApp()` and assert status, content type, and parsed body. This exercises the same Elysia response serializers used in production.
- Database mocks reproduce the real client's return type. In particular, a `postgres.js` query mock must return a `RowList`-shaped `Array` subclass with query metadata, not a plain array. Values crossing an Elysia boundary must be normalized to plain arrays.
- LLM changes include at least one realistic prompt and request payload through `/v1/llm/generate`; `hello` and exact-word probes may supplement that path but cannot replace it.
- Every production incident adds its full real-HTTP reproduction to `scripts/api-smoke.ts`. That check is permanent unless the product endpoint itself is retired.

## Permanent incident regressions

1. **postgres.js `RowList` serialization:** `GET /v1/starter-character-templates?campaign_id=the-eternal-feast` must return `200 application/json`, at least five rows, and more than 5 KB. The HTTP test supplies a `RowList`-shaped subclass and proves it cannot become `[object Object]` with `text/plain`.
2. **Realistic LLM generation:** `POST /v1/llm/generate` sends a small gameplay prompt, requires `200 application/json`, and requires non-empty `text`. This traverses the configured provider/model chain and catches delisted models or upstream passthrough failures.

Add the next incident as item 3 and add its check to the same smoke journey in the fixing change.
