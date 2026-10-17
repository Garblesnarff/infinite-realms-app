import { existsSync } from 'node:fs';
import path from 'node:path';

import type { EngineContract } from './fixtures';

export type CheckerViolation = { rule: string; matched?: string; detail?: string };

export type NarrationChecker = (narration: string, contract: EngineContract) => CheckerViolation[];

/**
 * Load the checker from the selected app root so older comparison checkouts
 * without the module can still report that no checker is available.
 */
export async function loadRegexChecker(appRoot: string): Promise<NarrationChecker | null> {
  const filePath = path.join(appRoot, 'src/services/ai/narration-contract-check.ts');
  if (!existsSync(filePath)) {
    return null;
  }
  const loaded: unknown = await import(filePath);
  if (
    typeof loaded !== 'object' ||
    loaded === null ||
    !('checkNarrationAgainstContract' in loaded)
  ) {
    return null;
  }
  const fn = loaded.checkNarrationAgainstContract;
  if (typeof fn !== 'function') {
    return null;
  }
  return fn as NarrationChecker;
}
