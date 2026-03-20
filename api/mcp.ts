import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { CursorApiClient } from '../src/api-client.js';
import type { LaunchAgentRequest, FollowUpRequest } from '../src/api-client.js';

/**
 * Build an MCP Server whose tool handlers read the Cursor API key
 * lazily from requestInfo.headers at call time.
 * This means initialize / capability negotiation works with no key,
 * and actual tool calls pick up x-cursor-api-key from the request.
 */
function buildServer(): Server {
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
          limit: { type: 'number', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
        },
      },
    },
    {
      name: 'get_agent',
      description: 'Retrieve the current status and results of a cloud agent',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'get_agent_conversation',
      description: 'Retrieve the conversation history of a cloud agent',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
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
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
          model: { type: 'string' },
          source: {
            type: 'object',
            properties: {
              repository: { type: 'string' },
              ref: { type: 'string' },
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
            properties: { url: { type: 'string' }, secret: { type: 'string' } },
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
          prompt: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
        required: ['id', 'prompt'],
      },
    },
    {
      name: 'stop_agent',
      description: 'Stop a running cloud agent',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'delete_agent',
      description: 'Permanently delete a cloud agent',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
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

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    // Read the API key from the request headers at call time
    const rawKey = extra?.requestInfo?.headers?.get?.('x-cursor-api-key');
    if (!rawKey) {
      return {
        content: [{ type: 'text', text: 'Error: Missing x-cursor-api-key header. Set it in your Poke integration settings.' }],
        isError: true,
      };
    }

    const apiClient = new CursorApiClient(rawKey);
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

/**
 * Convert a Node.js VercelRequest into a Web API Request.
 */
async function toWebRequest(req: VercelRequest): Promise<Request> {
  const protocol = req.headers['x-forwarded-proto'] ?? 'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const url = `${protocol}://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const method = (req.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  let body: BodyInit | null = null;
  if (hasBody) {
    if (req.body !== undefined && req.body !== null) {
      body = JSON.stringify(req.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    } else {
      body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
    }
  }

  return new Request(url, { method, headers, body });
}

/**
 * Pipe a Web API Response back into the Vercel/Node.js ServerResponse.
 */
async function sendWebResponse(webRes: Response, res: VercelResponse): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

// Vercel Node.js serverless handler.
// No HTTP-level auth gate — the API key is read lazily inside each tool
// handler from requestInfo.headers, so MCP initialization and capability
// negotiation work without a key. Tool calls require x-cursor-api-key.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();

  // OPTIONS — CORS preflight
  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, x-cursor-api-key, mcp-session-id');
    res.status(200).end();
    return;
  }

  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const webReq = await toWebRequest(req);
    const webRes = await transport.handleRequest(webReq);
    await sendWebResponse(webRes, res);
  } catch (err) {
    console.error('MCP handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', detail: String(err) });
    }
  }
}
