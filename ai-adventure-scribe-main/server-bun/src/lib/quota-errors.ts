/**
 * Thrown when the usage store cannot be reached, so a quota cannot be checked (#2673).
 *
 * Its own module, not ai-usage-service: http-pipeline maps it to 503, and test suites mock
 * ai-usage-service wholesale. A class imported from a mocked module is missing at load time.
 */
export class QuotaUnavailableError extends Error {
  constructor() {
    super('AI quota unavailable');
    this.name = 'QuotaUnavailableError';
  }
}
