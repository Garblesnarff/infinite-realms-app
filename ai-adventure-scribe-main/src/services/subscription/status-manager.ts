import type { TableSubscription } from './types';

import logger from '@/lib/logger';

/**
 * Handles subscription status changes and updates state
 */
export function handleStatusChange(
  tableName: string,
  status: string,
  subscription: TableSubscription,
  onFailure: () => void,
): void {
  logger.info(`Subscription status for ${tableName}: ${status}`);

  switch (status) {
    case 'SUBSCRIBED':
      subscription.isConnected = true;
      subscription.retryCount = 0;
      subscription.isConnecting = false;
      if (subscription.connectionTimeoutId) {
        clearTimeout(subscription.connectionTimeoutId);
        subscription.connectionTimeoutId = null;
      }
      break;

    case 'CHANNEL_ERROR':
    case 'TIMED_OUT':
      subscription.isConnected = false;
      subscription.isConnecting = false;
      onFailure();
      break;

    case 'CLOSED':
      subscription.isConnected = false;
      subscription.isConnecting = false;
      if (subscription.connectionTimeoutId) {
        clearTimeout(subscription.connectionTimeoutId);
        subscription.connectionTimeoutId = null;
      }
      break;
  }
}

/**
 * Handles connection failures with exponential backoff logic
 */
export function handleFailure(
  tableName: string,
  subscription: TableSubscription,
  options: {
    maxRetries: number;
    retryDelay: number;
    retryAction: (tableName: string) => void;
  },
): void {
  subscription.retryCount++;
  subscription.isConnected = false;
  subscription.isConnecting = false;

  if (subscription.retryCount < options.maxRetries) {
    const delay = options.retryDelay * Math.pow(2, subscription.retryCount - 1);
    logger.info(
      `Retrying ${tableName} subscription in ${delay}ms (${subscription.retryCount}/${options.maxRetries})`,
    );

    setTimeout(() => {
      options.retryAction(tableName);
    }, delay);
  } else {
    logger.warn(`Max retries exceeded for ${tableName} subscription`);
    subscription.disabled = true;
    if (subscription.connectionTimeoutId) {
      clearTimeout(subscription.connectionTimeoutId);
      subscription.connectionTimeoutId = null;
    }
  }
}
