import { AsyncLocalStorage } from 'node:async_hooks';

export const transactionContext = new AsyncLocalStorage<{ database: unknown; afterCommit: Array<() => void> }>();

export function deferUntilCommit(callback: () => void): boolean {
  const context = transactionContext.getStore();
  if (!context) return false;
  context.afterCommit.push(callback);
  return true;
}
