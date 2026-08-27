#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const BUILD_ROOT = path.resolve(process.cwd(), 'dist');
const SCANNED_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.mjs', '.map']);
const CONFIGURED_ELEVENLABS_SECRETS = [
  process.env.ELEVENLABS_API_KEY,
  process.env.ELEVEN_LABS_API_KEY,
].filter((value) => Boolean(value));

const forbiddenPatterns = [
  {
    label: 'ElevenLabs API key identifier',
    pattern: /\b(?:VITE_)?ELEVENLABS_API_KEY\b|\b(?:VITE_)?ELEVEN_LABS_API_KEY\b/i,
  },
  {
    label: 'provider secret token',
    pattern: /\bsk_[A-Za-z0-9_-]{16,}\b/,
  },
  {
    label: 'ElevenLabs provider header',
    pattern: /\bxi-api-key\b/i,
  },
  {
    label: 'ElevenLabs provider endpoint',
    pattern: /api\.elevenlabs\.io/i,
  },
];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(filePath));
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(filePath);
    }
  }
  return files;
}

export function findClientBuildSecrets(content) {
  const findings = forbiddenPatterns
    .filter(({ pattern }) => pattern.test(content))
    .map(({ label }) => label);

  if (CONFIGURED_ELEVENLABS_SECRETS.some((secret) => content.includes(secret))) {
    findings.push('configured ElevenLabs secret');
  }

  return findings;
}

function main() {
  if (!fs.existsSync(BUILD_ROOT)) {
    console.error(`Client build directory not found: ${path.relative(process.cwd(), BUILD_ROOT)}`);
    process.exitCode = 1;
    return;
  }

  const findings = [];
  for (const filePath of walk(BUILD_ROOT)) {
    const labels = findClientBuildSecrets(fs.readFileSync(filePath, 'utf8'));
    for (const label of labels) {
      findings.push({ file: path.relative(process.cwd(), filePath), label });
    }
  }

  if (findings.length > 0) {
    console.error('Client build secret check failed:');
    for (const finding of findings) {
      // Report locations and rule names only; never echo matched secret text.
      console.error(`- ${finding.label}: ${finding.file}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Client build secret check passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
