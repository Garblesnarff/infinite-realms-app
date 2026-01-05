
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// This is a simple wrapper around the client creation functions.
// This allows us to easily mock the client creation in our tests
// without having to deal with the complexities of mocking ES module exports.
export const clients = {
  createSupabaseClient: (
    supabaseUrl: string,
    supabaseKey: string
  ): SupabaseClient => {
    return createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  },
  createOpenAIClient: (options: { apiKey: string }): OpenAI => {
    return new OpenAI(options);
  },
};
