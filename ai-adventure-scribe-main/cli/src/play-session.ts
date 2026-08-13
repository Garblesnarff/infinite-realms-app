import type { CampaignPayload } from '@/services/user-data-api';

import {
  seedStarterCharacter,
  type StarterCharacterTemplateLike,
} from '@/services/character/starter-character-seeding';
import {
  resolveOrCreateStarterCampaign,
  type StarterCampaignBootstrapSource,
} from '@/services/starter-campaign-bootstrap';

type Session = {
  id: string;
  session_number?: number | null;
  starter_campaign_id?: string | null;
};

type SessionContext = {
  campaign_id: string | null;
  character_id: string | null;
  starter_campaign_id?: string | null;
};

export type StarterTemplate = StarterCharacterTemplateLike &
  Record<string, unknown> & {
    template_key: string;
    name: string;
    class: string;
  };

export interface PlaySessionApi {
  listSessions(filters: {
    status: string;
    starterOnly: boolean;
    limit: number;
  }): Promise<Session[]>;
  getSessionContext(sessionId: string): Promise<SessionContext>;
  listStarterCharacterTemplates(campaignId: string): Promise<StarterTemplate[]>;
  listCharacters(campaignId: string): Promise<Array<{ id: string }>>;
  listCampaigns(): Promise<Array<{ id: string; name: string }>>;
  createCampaign(payload: CampaignPayload): Promise<{ id: string }>;
  createCharacter(payload: Record<string, unknown>): Promise<{ id: string }>;
  createSession(payload: Record<string, unknown>): Promise<{ id: string }>;
}

export interface PlaySessionArgs {
  campaign?: string;
  template?: string;
  character?: string;
  fresh: boolean;
  auto: boolean;
}

export interface PlaySessionDependencies {
  getStarterCampaign(slug: string): Promise<StarterCampaignBootstrapSource | null>;
  chooseTemplate(templates: StarterTemplate[]): Promise<StarterTemplate>;
  log(message: string): void;
}

function templateForKey(templates: StarterTemplate[], key: string): StarterTemplate | undefined {
  return templates.find((template) => template.template_key === key);
}

export function templateListRows(
  templates: StarterTemplate[],
): Array<{ key: string; name: string; class: string }> {
  return templates.map((template) => ({
    key: template.template_key,
    name: template.name,
    class: template.class,
  }));
}

async function selectCharacter(
  api: PlaySessionApi,
  campaignId: string,
  starterCampaignId: string,
  templateKey: string | undefined,
  character: string | undefined,
  chooseTemplate: PlaySessionDependencies['chooseTemplate'],
): Promise<string> {
  const templates = await api.listStarterCharacterTemplates(starterCampaignId);
  const requestedTemplate = templateKey || character;
  const template = requestedTemplate ? templateForKey(templates, requestedTemplate) : undefined;

  if (template) {
    return (await seedStarterCharacter(template, campaignId, api.createCharacter)).id;
  }
  if (templateKey) throw new Error(`Starter template not found: ${templateKey}`);

  if (character) {
    const existing = (await api.listCharacters(campaignId)).find((entry) => entry.id === character);
    if (!existing) throw new Error(`Character not found in this campaign: ${character}`);
    return existing.id;
  }

  if (templates.length === 0)
    throw new Error(`No starter templates found for ${starterCampaignId}`);
  return (
    await seedStarterCharacter(await chooseTemplate(templates), campaignId, api.createCharacter)
  ).id;
}

function createStarterSession(
  api: PlaySessionApi,
  campaignId: string,
  characterId: string,
  starterCampaignId: string,
  sessionNumber: number,
): Promise<{ id: string }> {
  return api.createSession({
    session_number: sessionNumber,
    status: 'active',
    campaign_id: campaignId,
    character_id: characterId,
    turn_count: 0,
    current_scene_description: 'The adventure begins...',
    session_notes: '',
    starter_campaign_id: starterCampaignId,
  });
}

/** Select an active session, or execute the browser-equivalent starter bootstrap. */
export async function selectPlaySession(
  args: PlaySessionArgs,
  api: PlaySessionApi,
  dependencies: PlaySessionDependencies,
): Promise<string> {
  const sessions = await api.listSessions({
    status: 'active',
    starterOnly: Boolean(args.campaign),
    limit: 100,
  });
  const matching = sessions.filter(
    (session) => !args.campaign || session.starter_campaign_id === args.campaign,
  );
  const current = matching[0];

  if (!args.fresh && current) return current.id;
  if (!args.fresh)
    throw new Error(
      `No active session for ${args.campaign || 'this account'}; use --new to start one.`,
    );
  if (!args.campaign) throw new Error('--new requires --campaign');

  if (current) {
    const context = await api.getSessionContext(current.id);
    if (!context.campaign_id) throw new Error(`Active session ${current.id} has no campaign`);
    const characterId =
      args.template || args.character
        ? await selectCharacter(
            api,
            context.campaign_id,
            args.campaign,
            args.template,
            args.character,
            dependencies.chooseTemplate,
          )
        : context.character_id;
    if (!characterId) throw new Error(`Active session ${current.id} has no character`);
    return (
      await createStarterSession(
        api,
        context.campaign_id,
        characterId,
        args.campaign,
        Math.max(...matching.map((session) => Number(session.session_number || 0))) + 1,
      )
    ).id;
  }

  const starter = await dependencies.getStarterCampaign(args.campaign);
  if (!starter) throw new Error(`Starter campaign not found: ${args.campaign}`);
  const campaignId = await resolveOrCreateStarterCampaign(starter, api, dependencies.log);
  const characterId = await selectCharacter(
    api,
    campaignId,
    starter.id,
    args.template,
    args.character,
    dependencies.chooseTemplate,
  );
  return (await createStarterSession(api, campaignId, characterId, starter.id, 1)).id;
}
