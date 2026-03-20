import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { CursorApiClient } from '../src/api-client.js';
import type { LaunchAgentRequest, FollowUpRequest } from '../src/api-client.js';

function buildServer(apiClient: CursorApiClient): Server {
  const server = new Server(
    { name: 'cursor-agent-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  const tools: Tool[] = [
    {
      name: 'list_agents',
      description: 'List all cloud agents for the authenticated user',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of agents to return (default 20, max 100)', minimum: 1, maximum: 100 },
          cursor: { type: 'string', description: 'Pagination cursor from previous response' },
        },
      },
    },
    {
      name: 'get_agent',
      description: 'Retrieve the current status and results of a cloud agent',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cloud agent ID (e.g. bc_abc123)' } },
        required: ['id'],
      },
    },
    {
      name: 'get_agent_conversation',
      description: 'Retrieve the conversation history of a cloud agent',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cloud agent ID' } },
        required: ['id'],
      },
    },
    {
      name: 'launch_agent',
      description: 'Start a new cloud agent to work on a repository',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'object',
            properties: { text: { type: 'string', description: 'Instruction text for the agent' } },
            required: ['text'],
          },
          model: { type: 'string', description: 'LLM to use (e.g. claude-4-sonnet)' },
          source: {
            type: 'object',
            properties: {
              repository: { type: 'string', description: 'GitHub repository URL' },
              ref: { type: 'string', description: 'Git ref (branch, tag, or commit)' },
            },
            required: ['repository'],
          },
          target: {
            type: 'object',
            properties: {
              autoCreatePr: { type: 'boolean' },
              openAsCursorGithubApp: { type: 'boolean' },
              skipReviewerRequest: { type: 'boolean' },
              branchName: { type: 'string' },
            },
          },
          webhook: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              secret: { type: 'string' },
            },
            required: ['url'],
          },
        },
        required: ['prompt', 'source'],
      },
    },
    {
      name: 'add_followup',
      description: 'Add a follow-up instruction to an existing cloud agent',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Cloud agent ID' },
          prompt: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
        required: ['id', 'prompt'],
      },
    },
    {
      name: 'stop_agent',
      description: 'Stop a running cloud agent (pauses without deleting)',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cloud agent ID' } },
        required: ['id'],
      },
    },
    {
      name: 'delete_agent',
      description: 'Permanently delete a cloud agent',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Cloud agent ID' } },
        required: ['id'],
      },
    },
    {
      name: 'get_api_key_info',
      description: 'Get information about the API key being used',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_models',
      description: 'List recommended models for cloud agents',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_repositories',
      description: 'List GitHub repositories accessible to the authenticated user',
      inputSchema: { type: 'object', properties: {} },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (args ?? {}) as Record<string, any>;
    try {
      switch (name) {
        case 'list_agents': {
          const r = await apiClient.listAgents(a.limit as number | undefined, a.cursor as string | undefined);
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'get_agent': {
          const r = await apiClient.getAgent(a.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'get_agent_conversation': {
          const r = await apiClient.getAgentConversation(a.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'launch_agent': {
          const req: LaunchAgentRequest = {
            prompt: { text: a.prompt.text as string, images: a.prompt.images },
            model: a.model as string | undefined,
            source: { repository: a.source.repository as string, ref: a.source.ref as string | undefined },
            target: a.target,
            webhook: a.webhook,
          };
          const r = await apiClient.launchAgent(req);
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'add_followup': {
          const req: FollowUpRequest = { prompt: { text: a.prompt.text as string, images: a.prompt.images } };
          const r = await apiClient.addFollowUp(a.id as string, req);
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'stop_agent': {
          const r = await apiClient.stopAgent(a.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'delete_agent': {
          const r = await apiClient.deleteAgent(a.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'get_api_key_info': {
          const r = await apiClient.getApiKeyInfo();
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'list_models': {
          const r = await apiClient.listModels();
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        case 'list_repositories': {
          const r = await apiClient.listRepositories();
          return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}

// Vercel serverless handler — Web API Request/Response format
// Auth: pass Cursor API key via x-cursor-api-key request header
export default async function handler(req: Request): Promise<Response> {
  const apiKey = req.headers.get('x-cursor-api-key');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing x-cursor-api-key header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const apiClient = new CursorApiClient(apiKey);
  const server = buildServer(apiClient);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — required for serverless
  });

  await server.connect(transport);
  return transport.handleRequest(req);
}
