/**
 * Copy of `calculateImportance` from `src/utils/memory/importance.ts`
 * at origin/main `3fa7eefe`. That module imports `@/types/memory`, so this
 * pilot does not import it. The point schedule is locked by a test against
 * the source file's function body.
 */
export interface ImportanceFactors {
  content: string;
  type: string;
  ageInHours?: number;
  category?: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
  priority?: 'high' | 'medium' | 'low';
}

export const calculateImportance = (factors: ImportanceFactors): number => {
  let score = 0;

  switch (factors.type) {
    case 'plot':
    case 'action':
      score += 3;
      break;
    case 'character':
    case 'location':
    case 'dialogue':
    case 'scene_state':
      score += 2;
      break;
    case 'event':
    case 'description':
      score += 1;
      break;
    case 'task_result':
      score += 5;
      break;
    default:
      score += 0;
  }

  if (factors.category) {
    switch (factors.category) {
      case 'player_action':
        score += 2;
        break;
      case 'npc':
      case 'location':
        score += 1;
        break;
    }
  }

  if (factors.content) {
    if (factors.content.length > 200) {
      score += 1;
    }
    if (factors.content.length > 500) {
      score += 1;
    }
    if (factors.content.includes('quest') || factors.content.includes('mission')) {
      score += 1;
    }
    if (factors.content.includes('danger') || factors.content.includes('threat')) {
      score += 1;
    }
    const namedEntities = factors.content.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
    score += Math.min(2, namedEntities.length);
  }

  if (factors.ageInHours !== undefined) {
    if (factors.ageInHours < 1) {
      score += 3;
    } else if (factors.ageInHours < 24) {
      score += 2;
    } else if (factors.ageInHours < 72) {
      score += 1;
    }
  }

  if (
    factors.metadata &&
    typeof (factors.metadata as Record<string, unknown>).significance === 'number'
  ) {
    score += (factors.metadata as Record<string, number>).significance;
  }

  if (factors.error) {
    score += 2;
  }
  if (factors.priority === 'high') {
    score += 2;
  }

  return Math.min(10, Math.max(1, score));
};

/** Map the 1–10 point score onto the 1–5 scale the pilot asks Jev for. */
export function importanceToFive(score1to10: number): number {
  return Math.min(5, Math.max(1, Math.ceil(score1to10 / 2)));
}
