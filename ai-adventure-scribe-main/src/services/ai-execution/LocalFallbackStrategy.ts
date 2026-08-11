import type { AIExecutionStrategy } from './AIExecutionStrategy';

import logger from '@/lib/logger';

export class LocalFallbackStrategy implements AIExecutionStrategy {
  readonly name = 'local-fallback';
  readonly priority: number;

  constructor(priority: number = 5) {
    this.priority = priority;
  }

  canExecute(functionName: string): boolean {
    return functionName === 'rules-interpreter-execute';
  }

  async execute(functionName: string, _payload?: Record<string, unknown>): Promise<unknown> {
    if (functionName !== 'rules-interpreter-execute') {
      throw new Error(`Unsupported local AI function: ${functionName}`);
    }
    return this.executeRulesInterpreter();
  }

  private async executeRulesInterpreter() {
    logger.info('[LocalFallbackStrategy] Using simplified rules validation');
    return {
      isValid: true,
      suggestions: [],
      errors: [],
      explanation: 'Local rules validation - action appears valid',
    };
  }
}
