import { Hono } from 'hono';
import { handle } from '@hono/node-server/vercel';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { CursorApiClient } from '../src/api-client.js';

const app = new Hono();

function buildMcpServer(apiKey: string): Server {
  const apiClient = new CursorApiClient(apiKey);

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
          limit: { type: 'number', description: 'Number of cloud agents to return (default: 20, max: 100)', minimum: 1, maximum: 100 },
          cursor: { type: 'string', description: 'Pagination cursor from the previous response' },
        },
      },
    },
    {
      name: 'get_agent',
      description: 'Retrieve the current status and results of a cloud agent',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Unique identifier for the cloud agent (e.g., bc_abc123)' } },
        required: ['id'],
      },
    },
    {
      name: 'get_agent_conversation',
      description: 'Retrieve the conversation history of a cloud agent',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Unique identifier for the cloud agent' } },
        required: ['id'],
      },
    },
    {
      name: 'launch_agent',
      description: 'Start a new cloud agent to work on your repository',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The instruction text for the agent' },
              images: { type: 'array', description: 'Array of image objects with base64 data and dimensions (max 5)', items: { type: 'object', properties: { data: { type: 'string' }, dimension: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] } }, required: ['data', 'dimension'] }, maxItems: 5 },
            },
            required: ['text'],
          },
          model: { type: 'string', description: 'The LLM to use (e.g., claude-4-sonnet)' },
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
          id: { type: 'string' },
          prompt: { type: 'object', properties: { text: { type: 'string' }, images: { type: 'array', items: { type: 'object', properties: { data: { type: 'string' }, dimension: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] } }, required: ['data', 'dimension'] }, maxItems: 5 } }, required: ['text'] },
        },
        required: ['id', 'prompt'],
      },
    },
    {
      name: 'stop_agent',
      description: "Stop a running cloud agent",
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'delete_agent',
      description: 'Delete a cloud agent permanently',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'get_api_key_info',
      description: 'Retrieve information about the API key being used',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_models',
      description: 'Retrieve a list of recommended models for cloud agents',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_repositories',
      description: 'Retrieve a list of GitHub repositories accessible to the authenticated user',
      inputSchema: { type: 'object', properties: {} },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'list_agents': {
          const result = await apiClient.listAgents(args?.limit as number | undefined, args?.cursor as string | undefined);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'get_agent': {
          const result = await apiClient.getAgent(args?.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'get_agent_conversation': {
          const result = await apiClient.getAgentConversation(args?.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'launch_agent': {
          const result = await apiClient.launchAgent({
            prompt: args?.prompt as { text: string; images?: unknown[] },
            model: args?.model as string | undefined,
            source: args?.source as { repository: string; ref?: string },
            target: args?.target as { autoCreatePr?: boolean; openAsCursorGithubApp?: boolean; skipReviewerRequest?: boolean; branchName?: string } | undefined,
            webhook: args?.webhook as { url: string; secret?: string } | undefined,
          });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'add_followup': {
          const result = await apiClient.addFollowUp(args?.id as string, { prompt: args?.prompt as { text: string; images?: unknown[] } });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'stop_agent': {
          const result = await apiClient.stopAgent(args?.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'delete_agent': {
          const result = await apiClient.deleteAgent(args?.id as string);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'get_api_key_info': {
          const result = await apiClient.getApiKeyInfo();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'list_models': {
          const result = await apiClient.listModels();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'list_repositories': {
          const result = await apiClient.listRepositories();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error: ${errorMessage}` }], isError: true };
    }
  });

  return server;
}

app.all('/mcp', async (c) => {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'CURSOR_API_KEY environment variable is not set' }, 500);
  }

  const server = buildMcpServer(apiKey);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  await server.connect(transport);

  const req = c.req.raw;
  const res = await transport.handleRequest(req);
  return res;
});

export default handle(app);
