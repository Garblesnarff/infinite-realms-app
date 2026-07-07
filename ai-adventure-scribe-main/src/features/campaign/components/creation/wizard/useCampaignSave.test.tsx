import { act, render, screen, waitFor } from '@testing-library/react'; // Added waitFor
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCampaignSave } from './useCampaignSave';

import type { Campaign } from '@/types/campaign';

const { mockCreateCampaign } = vi.hoisted(() => ({ mockCreateCampaign: vi.fn() }));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createCampaign: mockCreateCampaign,
    updateCampaign: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/services/campaign-image-generator', () => ({
  campaignImageGenerator: { generateCampaignImage: vi.fn(() => new Promise(() => {})) },
}));

// Mock useToast (even if not directly used by the hook's core logic being tested, it's an import)
const mockToastFn = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToastFn }),
}));

// Helper Test Component
let hookResult: ReturnType<typeof useCampaignSave>;

const TestComponent: React.FC<{ campaignDataToSave?: Partial<Campaign> }> = ({
  campaignDataToSave,
}) => {
  const { saveCampaign, isSaving } = useCampaignSave();
  hookResult = { saveCampaign, isSaving }; // Store for access outside component scope

  return (
    <div>
      <div data-testid="isSaving">{isSaving.toString()}</div>
      <button
        onClick={async () => {
          if (campaignDataToSave) {
            try {
              await saveCampaign(campaignDataToSave);
            } catch (_e) {
              // Error handling can be tested by checking mocks or error messages if displayed
            }
          }
        }}
      >
        Save
      </button>
    </div>
  );
};

describe('useCampaignSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCampaign.mockReset();
  });

  it('initial state should have isSaving as false', () => {
    render(<TestComponent />);
    expect(screen.getByTestId('isSaving').textContent).toBe('false');
  });

  it('saveCampaign should set isSaving to true during operation and false after success', async () => {
    mockCreateCampaign.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: 'campaign-123' }), 10)),
    );
    render(<TestComponent />); // Render the component once

    let savePromise: Promise<unknown>;

    // Call saveCampaign - this will set isSaving to true synchronously within the hook's state
    act(() => {
      savePromise = hookResult.saveCampaign({ name: 'Test' });
    });

    // Wait for the DOM to update to reflect isSaving = true
    await waitFor(() => {
      expect(screen.getByTestId('isSaving').textContent).toBe('true');
    });

    // Wait for the save operation to complete
    await act(async () => {
      await savePromise;
    });

    // Check isSaving is false after completion
    expect(screen.getByTestId('isSaving').textContent).toBe('false');
  });

  it('saveCampaign should return campaign ID on successful insert', async () => {
    mockCreateCampaign.mockResolvedValueOnce({ id: 'campaign-xyz' });
    render(<TestComponent />);

    let result;
    const campaignData = { name: 'Test Campaign' };
    await act(async () => {
      result = await hookResult.saveCampaign(campaignData);
    });

    expect(result).toBe('campaign-xyz');
    expect(mockCreateCampaign).toHaveBeenCalledWith({
      name: 'Test Campaign',
      status: 'active',
      setting_details: {},
      enhancement_selections: [],
      enhancement_effects: {},
    });
  });

  it('saveCampaign should throw error if Supabase returns error', async () => {
    const supabaseError = new Error('API error');
    mockCreateCampaign.mockRejectedValueOnce(supabaseError);
    render(<TestComponent />);

    await act(async () => {
      await expect(hookResult.saveCampaign({ name: 'Error Campaign' })).rejects.toThrow(
        supabaseError.message,
      );
    });
    expect(screen.getByTestId('isSaving').textContent).toBe('false');
  });

  it('saveCampaign should throw error if no data is returned from insert', async () => {
    mockCreateCampaign.mockResolvedValueOnce(null);
    render(<TestComponent />);

    await act(async () => {
      await expect(hookResult.saveCampaign({ name: 'No Data Campaign' })).rejects.toThrow(
        'No data returned from insert',
      );
    });
    expect(screen.getByTestId('isSaving').textContent).toBe('false');
  });

  it('saveCampaign should ensure setting_details is an object', async () => {
    mockCreateCampaign.mockResolvedValueOnce({ id: 'campaign-abc' });
    render(<TestComponent />);

    // Test with setting_details as null
    await act(async () => {
      await hookResult.saveCampaign({ name: 'Test', setting_details: null });
    });
    expect(mockCreateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test', setting_details: {} }),
    );

    // Reset mocks for next call within the same test
    mockCreateCampaign.mockClear();
    mockCreateCampaign.mockResolvedValueOnce({ id: 'campaign-def' });

    // Test with provided setting_details
    const myDetails = { world: 'Mystara' };
    await act(async () => {
      await hookResult.saveCampaign({ name: 'Test 2', setting_details: myDetails });
    });
    expect(mockCreateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test 2', setting_details: myDetails }),
    );
  });
});
