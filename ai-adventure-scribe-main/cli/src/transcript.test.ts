import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTranscriptWriter } from './transcript';

const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-'));
  dirs.push(dir);
  return join(dir, 'run.txt');
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('createTranscriptWriter', () => {
  it('appends each line immediately with the known request id', () => {
    const file = tempFile();
    const writer = createTranscriptWriter(file, () => 'req-1');
    writer.write('first');
    writer.write('second');
    expect(readFileSync(file, 'utf8')).toBe('[req req-1] first\n[req req-1] second\n');
  });

  it('uses [req -] when no request id is known', () => {
    const file = tempFile();
    const writer = createTranscriptWriter(file, () => undefined);
    writer.write('no id yet');
    expect(readFileSync(file, 'utf8')).toBe('[req -] no id yet\n');
  });

  it('truncates existing content when created', () => {
    const file = tempFile();
    writeFileSync(file, 'stale content\n');
    const writer = createTranscriptWriter(file, () => undefined);
    writer.write('fresh');
    expect(readFileSync(file, 'utf8')).toBe('[req -] fresh\n');
  });
});
