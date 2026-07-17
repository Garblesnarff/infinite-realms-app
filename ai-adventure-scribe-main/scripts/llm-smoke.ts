const baseUrl = (process.env.LLM_SMOKE_BASE_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');
const token = process.env.LLM_SMOKE_BEARER_TOKEN;

if (!token) {
  console.error('LLM smoke check requires LLM_SMOKE_BEARER_TOKEN');
  process.exit(2);
}

const response = await fetch(`${baseUrl}/v1/llm/generate`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Request-Id': `llm-smoke-${Date.now()}`,
  },
  body: JSON.stringify({
    prompt: 'Reply with exactly the word HEALTHY.',
    maxTokens: 16,
    temperature: 0,
    provider: process.env.LLM_SMOKE_PROVIDER || 'openrouter',
  }),
  signal: AbortSignal.timeout(75_000),
});

const body = (await response.json().catch(() => null)) as {
  text?: unknown;
  error?: unknown;
} | null;
if (!response.ok || typeof body?.text !== 'string' || body.text.trim().length === 0) {
  console.error('LLM smoke check failed', { status: response.status, body });
  process.exit(1);
}

console.log(`LLM smoke check passed (${response.status}): ${body.text.trim()}`);
