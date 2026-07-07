/**
 * Campaign Context Provider Service
 *
 * This file defines the CampaignContextProvider class, responsible for fetching
 * campaign details from the Supabase database. It uses the ErrorHandlingService
 * to manage potential database errors during fetch operations.
 *
 * Main Class:
 * - CampaignContextProvider: Fetches campaign details.
 *
 * Key Dependencies:
 * - Supabase client (`@/integrations/supabase/client`)
 * - ErrorHandlingService (`../../error/services/error-handling-service.ts`)
 * - Error types (`../../error/types`)
 *
 * @author AI Dungeon Master Team
 */

// External/SDK Imports
import { userDataApi } from '@/services/user-data-api';

// Project Services (assuming kebab-case filenames)
import { ErrorHandlingService } from '../../error/services/error-handling-service';

// Project Types
import { ErrorCategory, ErrorSeverity } from '../../error/types';
import { logger } from '../../../lib/logger';

export class CampaignContextProvider {
  private errorHandler: ErrorHandlingService;

  constructor() {
    this.errorHandler = ErrorHandlingService.getInstance();
  }

  public async fetchCampaignDetails(campaignId: string) {
    try {
      const { data, error } = await this.errorHandler.handleDatabaseOperation(
        async () => userDataApi.getCampaign(campaignId).then((data) => ({ data, error: null })),
        {
          category: ErrorCategory.DATABASE,
          context: 'CampaignContextProvider.fetchCampaignDetails',
          severity: ErrorSeverity.HIGH,
        },
      );

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching campaign details:', error);
      return null;
    }
  }
}
