import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { CharacterInteractionGenerator } from "./generators/CharacterInteractionGenerator.ts";
import { EnvironmentGenerator } from "./generators/EnvironmentGenerator.ts";
import { buildPrompt } from "./promptBuilder.ts";
import { DMResponse, StructuredDMResponse, VoiceContext, NarrationSegment } from "./types.ts";
import { calculatePassiveScores } from "./passiveSkillsEvaluator.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-release, x-environment',
};

const DEFAULT_PRIMARY_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_FALLBACK_MODEL = 'gemini-2.0-flash-lite';

const GEMINI_PRIMARY_MODEL = (Deno.env.get('GEMINI_TEXT_MODEL') ?? DEFAULT_PRIMARY_MODEL).trim() || DEFAULT_PRIMARY_MODEL;
const GEMINI_FALLBACK_MODEL = (Deno.env.get('GEMINI_TEXT_FALLBACK') ?? DEFAULT_FALLBACK_MODEL).trim() || DEFAULT_FALLBACK_MODEL;
const GEMINI_VARIANT_MODELS = (Deno.env.get('GEMINI_MODEL_VARIANTS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const dedupeModels = (models: string[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const model of models) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    ordered.push(model);
  }
  return ordered;
};

const buildModelCandidates = (preferred: string, variants: string[], fallback: string): string[] => {
  const autoVariants: string[] = [];
  if (/^gemini-2\.5-flash-lite$/i.test(preferred)) {
    autoVariants.push('gemini-2.5-flash-lite-001', 'gemini-2.5-flash-lite-preview');
  }
  return dedupeModels([preferred, ...variants, ...autoVariants, fallback]);
};

const GEMINI_MODEL_CANDIDATES = buildModelCandidates(GEMINI_PRIMARY_MODEL, GEMINI_VARIANT_MODELS, GEMINI_FALLBACK_MODEL);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = req.headers.get('x-request-id') || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  try {
    // Parse request body with better error handling
    let requestBody: any;
    try {
      const rawBody = await req.text();
      console.log('[DM Agent] Raw request body length:', rawBody.length, { requestId });

      // Check for common serialization issues
      if (rawBody === '[object Object]' || rawBody === '"[object Object]"') {
        console.error('[DM Agent] Request body was improperly serialized as [object Object]', { requestId });
        return new Response(
          JSON.stringify({
            error: 'Request body serialization error. The client sent an improperly serialized object.',
            requestId,
            hint: 'Ensure Date objects are converted to ISO strings before sending'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-request-id': requestId } }
        );
      }

      requestBody = JSON.parse(rawBody);
    } catch (parseError: any) {
      console.error('[DM Agent] Failed to parse request body:', parseError.message, { requestId });
      return new Response(
        JSON.stringify({ error: `Invalid JSON in request body: ${parseError.message}`, requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-request-id': requestId } }
      );
    }

    const { task, agentContext, voiceContext, isFirstMessage = false, combatContext } = requestBody;

    // Validate required fields
    if (!task || !agentContext) {
      console.error('[DM Agent] Missing required fields in request body', { requestId, hasTask: !!task, hasAgentContext: !!agentContext });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: task and agentContext are required', requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-request-id': requestId } }
      );
    }

    const { campaignDetails, characterDetails, memories = [] } = agentContext;

    console.log('Processing DM Agent task:', {
      requestId,
      taskType: task.description,
      campaign: campaignDetails?.name,
      character: characterDetails?.name,
      memoryCount: memories?.length,
      isFirstMessage: isFirstMessage,
      hasCombatContext: !!combatContext
    });

    // Sort memories by importance and recency
    const relevantMemories = memories
      .sort((a, b) => {
        const importanceDiff = (b.importance || 0) - (a.importance || 0);
        if (importanceDiff !== 0) return importanceDiff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, 5); // Get top 5 most relevant memories

    console.log('Using relevant memories:', relevantMemories.map(m => ({
      content: m.content,
      importance: m.importance,
      type: m.type,
      requestId,
    })));

    const environmentGen = new EnvironmentGenerator();
    const interactionGen = new CharacterInteractionGenerator();

    // Calculate passive scores for the character
    const passiveScores = calculatePassiveScores(characterDetails);
    console.log('[DM Agent] Calculated passive scores:', passiveScores, { requestId });

    // Inject passive scores into character context
    const enhancedAgentContext = {
      ...agentContext,
      characterContext: {
        ...characterDetails,
        passiveScores: passiveScores
      }
    };

    // Build prompt with memory, voice context, combat context, and passive scores
    const prompt = buildPrompt({
      agentContext: enhancedAgentContext,
      memories: relevantMemories,
      combatContext: combatContext
    }, voiceContext, isFirstMessage);

    // Call Google Gemini with the enhanced prompt
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('VITE_GOOGLE_GEMINI_API_KEY') || '';
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not found in environment variables. Please set GEMINI_API_KEY in Supabase secrets.');
    }
    
    console.log('Using Gemini API key:', geminiApiKey.substring(0, 10) + '...', { requestId });
    const genAI = new GoogleGenerativeAI(geminiApiKey);

    const baseHistory = [
      {
        role: 'user',
        parts: [prompt],
      },
      {
        role: 'model',
        parts: ["Understood. I will generate a narrative response based on the provided context and task."]
      }
    ];

    const baseGenerationConfig = {
      temperature: 0.7,
      topK: 1,
      topP: 0.9,
      maxOutputTokens: 2048,
    } as const;

    const attempts: string[] = [];
    let chosenModel: string | null = null;
    let rawResponse: string | null = null;
    let unavailableMessage: string | null = null;

    // System instruction for critical rules
    const systemInstruction = {
      parts: [{
        text: `CRITICAL SYSTEM RULES:

1. ROLL STOPPING: When you request a dice roll from the player using a ROLL_REQUESTS_V1 code block, you MUST END your response immediately after that block. Do NOT continue with narrative, outcomes, choices, or any additional text after requesting a roll. The player needs to roll the dice first before you continue the story. Your next response (after receiving the roll result) should then narrate the outcome.

2. PASSIVE SKILLS - NEVER REQUEST ROLLS:
   D&D 5E passive skills (Perception, Insight, Investigation) are AUTOMATIC calculations that represent continuous awareness WITHOUT rolling dice.

   Formula: Passive Skill = 10 + ability modifier + proficiency bonus (if proficient)

   The character's passive scores are provided in the context. USE THEM AUTOMATICALLY to determine what the character notices.

   ❌ FORBIDDEN - NEVER SAY THESE:
      - "Make a Passive Perception check"
      - "Roll Passive Insight"
      - "Roll for Passive Investigation"
      - "Give me a Passive [Skill] check"

   These are CONTRADICTIONS - passive skills are never rolled!

   ✅ CORRECT - Use passive scores automatically in narration:
      - "Your keen awareness (Passive Perception ${passiveScores.perception}) notices scratches on the floor"
      - "Your intuition (Passive Insight ${passiveScores.insight}) senses the merchant is nervous"
      - "Your analytical mind (Passive Investigation ${passiveScores.investigation}) spots ancient runes"

   ✅ CORRECT - Request ACTIVE checks when players explicitly search:
      - Player: "I search for traps" → DM: "Make an Investigation check (1d20+INT, DC 15)"
      - Player: "I examine the statue" → DM: "Make a Perception check (1d20+WIS, DC 12)"

   Only request ACTIVE skill checks when:
   - The player explicitly declares they are searching/investigating
   - In combat or high-stress situations
   - The action requires focused effort beyond continuous awareness

   Passive Perception is ALWAYS ON - use it to reveal what characters notice naturally without prompting rolls.`
      }]
    };

    for (const candidate of GEMINI_MODEL_CANDIDATES) {
      attempts.push(candidate);
      try {
        const chat = genAI.getGenerativeModel({ model: candidate, systemInstruction }).startChat({
          history: baseHistory.map((entry) => ({ ...entry, parts: [...entry.parts] })),
          generationConfig: { ...baseGenerationConfig },
        });

        const result = await chat.sendMessage(task.description);
        const aiResponse = await result.response;
        const text = aiResponse.text();
        if (!text) {
          throw new Error('Gemini API error: No text in response');
        }
        rawResponse = text;
        chosenModel = candidate;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not a valid model id|unsupported model|model \w+ has been disabled/i.test(message)) {
          console.warn(`[DM Agent] Gemini model "${candidate}" unavailable: ${message}`, { requestId });
          unavailableMessage = message;
          continue;
        }
        throw error;
      }
    }

    if (!rawResponse || !chosenModel) {
      const details = unavailableMessage ? ` (${unavailableMessage})` : '';
      throw new Error(`Gemini models unavailable. Tried: ${attempts.join(', ')}${details}`);
    }

    if (chosenModel !== GEMINI_PRIMARY_MODEL) {
      console.warn(`[DM Agent] Gemini model fallback engaged. Requested "${GEMINI_PRIMARY_MODEL}", using "${chosenModel}"`, { requestId });
    }

    // Parse structured response if voice context provided
    let narrativeText = rawResponse;
    let narrationSegments: NarrationSegment[] | undefined;
    
    if (voiceContext) {
      try {
        const structuredResponse: StructuredDMResponse = JSON.parse(rawResponse);
        narrativeText = structuredResponse.text;
        narrationSegments = structuredResponse.narration_segments;
        console.log('Successfully parsed structured response with', narrationSegments?.length, 'segments', { requestId });
      } catch (parseError) {
        console.warn('Failed to parse structured response, falling back to plain text:', parseError, { requestId });
        // Keep narrativeText as rawResponse for backward compatibility
      }
    }

    // Generate environment and interactions using the AI response
    const environment = environmentGen.generateEnvironment(campaignDetails, characterDetails);
    const interactions = interactionGen.generateInteractions(
      campaignDetails.world_id,
      characterDetails
    );

    // Build narrative response
    const narrativeResponse: DMResponse = {
      environment: {
        description: environment.description,
        atmosphere: environment.atmosphere,
        sensoryDetails: environment.sensoryDetails
      },
      characters: {
        activeNPCs: interactions.activeNPCs,
        reactions: interactions.reactions,
        dialogue: narrativeText // Use the AI-generated narrative
      },
      opportunities: {
        immediate: generateImmediateActions(campaignDetails, characterDetails),
        nearby: getKeyLocations(campaignDetails),
        questHooks: generateQuestHooks(memories, characterDetails)
      },
      mechanics: {
        availableActions: getAvailableActions(characterDetails),
        relevantRules: [],
        suggestions: generateActionSuggestions(campaignDetails, characterDetails)
      }
    };

    // Prepare response with narration segments if available
    const responseData: any = {
      response: narrativeText,
      context: agentContext,
      raw: narrativeResponse,
      requestId,
    };

    // Add narration segments if they were parsed successfully
    if (narrationSegments) {
      responseData.narrationSegments = narrationSegments;
    }

    return new Response(
      JSON.stringify(responseData),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-request-id': requestId },
      }
    );
  } catch (error: any) {
    console.error('Error in DM agent execution:', error, { requestId });
    return new Response(
      JSON.stringify({ error: error.message, requestId }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-request-id': requestId },
      }
    );
  }
});

function formatNarrativeResponse(response: DMResponse, character: any): string {
  const { environment, characters, opportunities } = response;
  
  const narrative = [
    // Scene description with environment and sensory details
    environment.description,
    ...environment.sensoryDetails,

    // Character interactions and NPC reactions
    '',
    characters.dialogue,
    ...characters.reactions,

    // Available opportunities and actions
    '\nBefore you:',
    ...opportunities.immediate.map(action => `- ${action}`),

    // Nearby locations of interest
    '\nNearby:',
    ...opportunities.nearby.map(location => `- ${location}`),

    // Quest hooks if any
    opportunities.questHooks.length > 0 ? '\nRumors speak of:' : '',
    ...opportunities.questHooks.map(quest => `- ${quest}`),

    // Closing prompt based on character class
    '',
    getClassSpecificPrompt(character.class)
  ].filter(Boolean).join('\n');

  return narrative;
}

function getClassSpecificPrompt(characterClass: string): string {
  const prompts: Record<string, string> = {
    'Wizard': 'What would you like to do, esteemed wielder of the arcane?',
    'Fighter': 'What is your next move, brave warrior?',
    'Rogue': 'How do you wish to proceed, master of shadows?',
    'Cleric': 'What path calls to you, blessed one?'
  };
  
  return prompts[characterClass] || 'What would you like to do?';
}

// Helper functions for generating actions, locations, and quest hooks
function generateImmediateActions(campaign: any, character: any): string[] {
  const actions = [
    'Explore the immediate area',
    'Talk to nearby locals',
    'Check your equipment'
  ];

  if (character?.class === 'Wizard') {
    actions.push('Study the magical atmosphere');
  }

  if (campaign.genre === 'dark-fantasy') {
    actions.push('Investigate the unsettling shadows');
  }

  return actions;
}

function getKeyLocations(campaign: any): string[] {
  return campaign.thematic_elements?.keyLocations || [];
}

function generateQuestHooks(memories: any[], character: any): string[] {
  return memories
    ?.filter(m => m.type === 'quest' && m.metadata?.status === 'available')
    ?.map(m => m.content)
    ?.filter(Boolean) || [];
}

function getAvailableActions(character: any): string[] {
  const baseActions = ['Move', 'Interact', 'Attack'];
  
  if (character?.class === 'Wizard') {
    baseActions.push('Cast Spell');
  }
  
  return baseActions;
}

function generateActionSuggestions(campaign: any, character: any): string[] {
  const suggestions = [];
  
  if (campaign.genre === 'dark-fantasy') {
    suggestions.push('Remain vigilant');
    suggestions.push('Search for clues about the darkness');
  }

  if (character?.class === 'Wizard') {
    suggestions.push('Analyze magical anomalies');
  }

  return suggestions;
}
