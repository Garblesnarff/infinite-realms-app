import {
  WorldEntity,
  WorldRelationship,
  WorldFact,
  WorldConflict,
  WorldRule,
  ResolutionMethod,
  RelationshipType,
  EntityQuery,
  ValidationMessage,
} from '@/engine/world/types';

/**
 * Calculates a similarity score between two entities based on name, type, and tags.
 */
export function calculateSimilarity(entity1: WorldEntity, entity2: WorldEntity): number {
  // Simple similarity calculation - can be enhanced
  const nameSimilarity = stringSimilarity(entity1.name, entity2.name);
  const typeMatch = entity1.entityType === entity2.entityType ? 1 : 0;
  const tagOverlap = calculateTagOverlap(entity1.tags, entity2.tags);

  return nameSimilarity * 0.5 + typeMatch * 0.3 + tagOverlap * 0.2;
}

/**
 * Calculates similarity between two strings based on Levenshtein distance.
 */
export function stringSimilarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculates the Levenshtein distance between two strings.
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }

  return matrix[s1.length][s2.length];
}

/**
 * Calculates Jaccard similarity between two sets of tags.
 */
export function calculateTagOverlap(tags1: string[], tags2: string[]): number {
  const set1 = new Set(tags1);
  const set2 = new Set(tags2);
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Validates basic graph consistency.
 */
export function validateBasicConsistency(
  entities: Map<string, WorldEntity>,
  relationships: WorldRelationship[],
  warnings: ValidationMessage[],
  errors: ValidationMessage[]
): void {
  const entityIds = new Set(entities.keys());

  relationships.forEach((rel) => {
    if (!entityIds.has(rel.subjectId)) {
      errors.push({
        type: 'error',
        message: `Relationship references non-existent subject: ${rel.subjectId}`,
        entityId: rel.subjectId,
        relationshipId: rel.id,
        severity: 'high',
        autoFixable: false,
      });
    }

    if (!entityIds.has(rel.objectId)) {
      errors.push({
        type: 'error',
        message: `Relationship references non-existent object: ${rel.objectId}`,
        entityId: rel.objectId,
        relationshipId: rel.id,
        severity: 'high',
        autoFixable: false,
      });
    }
  });

  // Check for low confidence entities
  entities.forEach((entity) => {
    if (entity.confidenceScore < 0.3) {
      warnings.push({
        type: 'warning',
        message: `Entity has very low confidence: ${entity.name}`,
        entityId: entity.id,
        severity: 'medium',
        autoFixable: false,
      });
    }
  });
}

/**
 * Checks rule conditions against world state.
 */
export function checkRuleConditions(
  rule: WorldRule,
  queryEntities: (query: EntityQuery) => WorldEntity[]
): string[] {
  const matches: string[] = [];

  // Check entity type conditions
  if (rule.conditions.entityTypes) {
    rule.conditions.entityTypes.forEach((type) => {
      const entities = queryEntities({ entityTypes: [type] });
      if (entities.length > 0) {
        matches.push(entities[0].id);
      }
    });
  }

  return matches;
}

/**
 * Resolves conflicts by recency (keeping newer ones).
 */
export function resolveConflictsByRecency(conflicts: Map<string, WorldConflict>): void {
  const conflictList = Array.from(conflicts.values())
    .filter((c) => c.status === 'open')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  conflictList.slice(10).forEach((conflict) => {
    conflict.status = 'resolved';
    conflict.resolvedAt = new Date();
    conflict.resolutionMethod = 'most_recent';
    conflict.resolvedBy = 'system';
  });
}

/**
 * Resolves conflicts based on confidence scores.
 */
export function resolveConflictsByConfidence(
  facts: Map<string, WorldFact>,
  conflicts: Map<string, WorldConflict>
): void {
  const openConflicts = Array.from(conflicts.values()).filter((c) => c.status === 'open');

  openConflicts.forEach((conflict) => {
    const factA = facts.get(conflict.factA);
    const factB = facts.get(conflict.factB);

    if (factA && factB) {
      const winner = factA.confidenceScore > factB.confidenceScore ? factA : factB;
      const loser = factA.confidenceScore > factB.confidenceScore ? factB : factA;

      // Invalidate the losing fact
      loser.validUntil = new Date();
      facts.set(loser.id, loser);

      conflict.status = 'resolved';
      conflict.resolvedAt = new Date();
      conflict.resolutionMethod = 'weighted';
      conflict.resolvedBy = 'system';
    }
  });
}

/**
 * Gets severity weight for sorting.
 */
export function getSeverityWeight(severity: string): number {
  switch (severity) {
    case 'critical':
      return 3;
    case 'error':
      return 2;
    case 'warning':
      return 1;
    default:
      return 0;
  }
}

/**
 * Generates recommendations for conflict resolution.
 */
export function generateRecommendations(
  warnings: ValidationMessage[],
  errors: ValidationMessage[],
  conflicts: WorldConflict[]
): string[] {
  const recommendations: string[] = [];

  if (errors.length > 0) {
    recommendations.push('Resolve critical errors before proceeding');
  }

  if (conflicts.filter((c) => c.severity === 'high').length > 0) {
    recommendations.push('Review and resolve high-priority conflicts');
  }

  if (warnings.length > 10) {
    recommendations.push('Consider reviewing and updating confidence scores');
  }

  return recommendations;
}

/**
 * Checks if two relationship types are conflicting.
 */
export function getConflictingTypes(type: RelationshipType): RelationshipType[] {
  const conflicts: Record<RelationshipType, RelationshipType[]> = {
    enemy_of: ['allied_with', 'friend_of', 'married_to'],
    allied_with: ['enemy_of'],
    hates: ['loves', 'married_to', 'friend_of'],
    owns: ['owns'],
  };

  return conflicts[type] || [];
}

/**
 * Checks if two facts are in conflict.
 */
export function isFactConflict(fact1: WorldFact, fact2: WorldFact): boolean {
  return (
    fact1.propertyValue !== fact2.propertyValue &&
    Math.abs(fact1.confidenceScore - fact2.confidenceScore) < 0.3
  );
}

/**
 * Checks if two relationships are in conflict.
 */
export function isRelationshipConflict(
  rel1: WorldRelationship,
  rel2: WorldRelationship
): boolean {
  // Check if relationships are temporally valid simultaneously
  const now = new Date();
  const rel1Valid = isRelationshipValid(rel1, now);
  const rel2Valid = isRelationshipValid(rel2, now);

  return rel1Valid && rel2Valid;
}

/**
 * Checks if a relationship is valid at a given time.
 */
export function isRelationshipValid(relationship: WorldRelationship, at: Date): boolean {
  return (
    relationship.validFrom <= at && (!relationship.validUntil || relationship.validUntil >= at)
  );
}
