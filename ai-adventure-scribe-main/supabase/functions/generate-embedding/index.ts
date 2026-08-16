import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { EMBEDDING_MAX_INPUT_CHARS } from '../../../shared/embedding-limits.ts'
import { generateEmbedding } from './embedding.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { text } = await req.json();

    if (!text) {
      throw new Error('Text is required');
    }

    const cleanedText = text.substring(0, EMBEDDING_MAX_INPUT_CHARS).replace(/\n/g, ' ').trim();
    console.log('Processing text for embedding:', cleanedText.substring(0, 100) + '...');

    // Get Google Gemini API key from environment
    const googleApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!googleApiKey) {
      throw new Error('Google Gemini API key not configured');
    }

    const embedding = await generateEmbedding(cleanedText, googleApiKey);
    console.log('Gemini API response received, embedding dimensions:', embedding.length);

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
