import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * #660 item 2: record/replay at the LLM provider fetch seam.
 * LLM_FIXTURE_DIR set: responses come from <dir>/<key>.json and the network is never called.
 * LLM_RECORD_DIR set: real responses are written to <dir>/<key>.json.
 * The key and the recording never include request headers or the URL query (Gemini sends its key as ?key=).
 */
export interface LLMFixtureRecord {
  key: string;
  url: string;
  request: unknown;
  status: number;
  contentType: string;
  body: string;
}

const stripQuery = (url: string): string => url.split('?')[0];

const parseBody = (body: RequestInit['body']): unknown => {
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

export function llmFixtureKey(url: string, body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ url: stripQuery(url), body }))
    .digest('hex');
}

export async function llmFetch(url: string, init: RequestInit): Promise<Response> {
  const fixtureDir = process.env.LLM_FIXTURE_DIR;
  const recordDir = process.env.LLM_RECORD_DIR;
  const request = parseBody(init.body);
  const key = llmFixtureKey(url, request);

  if (fixtureDir) {
    const fixturePath = join(fixtureDir, `${key}.json`);
    if (!existsSync(fixturePath)) {
      throw new Error(`LLM fixture not found: ${key}.json in ${fixtureDir}`);
    }
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as LLMFixtureRecord;
    return new Response(fixture.body, {
      status: fixture.status,
      headers: { 'content-type': fixture.contentType },
    });
  }

  const response = await globalThis.fetch(url, init);
  if (recordDir) {
    const record: LLMFixtureRecord = {
      key,
      url: stripQuery(url),
      request,
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/json',
      body: await response.clone().text(),
    };
    mkdirSync(recordDir, { recursive: true });
    writeFileSync(join(recordDir, `${key}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }
  return response;
}
