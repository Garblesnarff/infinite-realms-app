import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://infiniterealms.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();

    if (!text) {
      throw new Error('Text is required');
    }

    // Clean and truncate text (Gemini text-embedding-004 supports up to 2048 tokens)
    const cleanedText = text.substring(0, 2000).replace(/\n/g, ' ').trim();
    console.log('Processing text for embedding:', cleanedText.substring(0, 100) + '...');

    // Get Google Gemini API key from environment
    const googleApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!googleApiKey) {
      throw new Error('Google Gemini API key not configured');
    }

    // Call Gemini embeddings API (text-embedding-004)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text: cleanedText }],
          },
          taskType: 'RETRIEVAL_DOCUMENT',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Gemini API error:', error);
      throw new Error('Failed to generate embedding');
    }

    const data = await response.json();
    console.log('Gemini API response received, embedding dimensions:', data.embedding?.values?.length);

    // Extract embedding array from Gemini response
    const embedding = data.embedding?.values;

    // Validate embedding format
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Invalid embedding format received');
    }

    // Format embedding for Supabase vector storage
    const vectorString = `[${embedding.join(',')}]`;

    return new Response(
      JSON.stringify({ embedding: vectorString }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error generating embedding:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      }
    );
  }
});