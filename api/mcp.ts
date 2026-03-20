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

function buildServer(): Server {
  const server = new Server(
    { name: 'cursor-agent-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  const tools: Tool[] = [
    {
      name: 'list_agents',
      description: 'List all cloud agents for the authenticated user',
      inputSchema: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 }, cursor: { type: 'string' } } },
    },
    {
      name: 'get_agent',
      description: 'Retrieve the current status and results of a cloud agent',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'get_agent_conversation',
      description: 'Retrieve the conversation history of a cloud agent',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'launch_agent',
      description: 'Start a new cloud agent to work on a repository',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          model: { type: 'string' },
          source: { type: 'object', properties: { repository: { type: 'string' }, ref: { type: 'string' } }, required: ['repository'] },
          target: { type: 'object', properties: { autoCreatePr: { type: 'boolean' }, openAsCursorGithubApp: { type: 'boolean' }, skipReviewerRequest: { type: 'boolean' }, branchName: { type: 'string' } } },
          webhook: { type: 'object', properties: { url: { type: 'string' }, secret: { type: 'string' } }, required: ['url'] },
        },
        required: ['prompt', 'source'],
      },
    },
    {
      name: 'add_followup',
      description: 'Add a follow-up instruction to an existing cloud agent',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, prompt: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }, required: ['id', 'prompt'] },
    },
    { name: 'stop_agent', description: 'Stop a running cloud agent', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'delete_agent', description: 'Permanently delete a cloud agent', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'get_api_key_info', description: 'Get information about the API key being used', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_models', description: 'List recommended models for cloud agents', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_repositories', description: 'List GitHub repositories accessible to the authenticated user', inputSchema: { type: 'object', properties: {} } },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const rawKey = extra?.requestInfo?.headers?.get?.('x-cursor-api-key');
    if (!rawKey) {
      return { content: [{ type: 'text', text: 'Error: Missing x-cursor-api-key header. Add it in your Poke integration settings.' }], isError: true };
    }
    const apiClient = new CursorApiClient(rawKey);
    const { name, arguments: args } = request.params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (args ?? {}) as Record<string, any>;
    try {
      switch (name) {
        case 'list_agents': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.listAgents(a.limit, a.cursor), null, 2) }] };
        case 'get_agent': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.getAgent(a.id), null, 2) }] };
        case 'get_agent_conversation': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.getAgentConversation(a.id), null, 2) }] };
        case 'launch_agent': {
          const r: LaunchAgentRequest = { prompt: { text: a.prompt.text, images: a.prompt.images }, model: a.model, source: { repository: a.source.repository, ref: a.source.ref }, target: a.target, webhook: a.webhook };
          return { content: [{ type: 'text', text: JSON.stringify(await apiClient.launchAgent(r), null, 2) }] };
        }
        case 'add_followup': {
          const r: FollowUpRequest = { prompt: { text: a.prompt.text, images: a.prompt.images } };
          return { content: [{ type: 'text', text: JSON.stringify(await apiClient.addFollowUp(a.id, r), null, 2) }] };
        }
        case 'stop_agent': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.stopAgent(a.id), null, 2) }] };
        case 'delete_agent': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.deleteAgent(a.id), null, 2) }] };
        case 'get_api_key_info': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.getApiKeyInfo(), null, 2) }] };
        case 'list_models': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.listModels(), null, 2) }] };
        case 'list_repositories': return { content: [{ type: 'text', text: JSON.stringify(await apiClient.listRepositories(), null, 2) }] };
        default: throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  });

  return server;
}

async function toWebRequest(req: VercelRequest): Promise<Request> {
  const protocol = req.headers['x-forwarded-proto'] ?? 'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const url = `${protocol}://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) { for (const v of value) headers.append(key, v); }
    else { headers.set(key, value); }
  }
  const method = (req.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  let body: BodyInit | null = null;
  if (hasBody) {
    if (req.body !== undefined && req.body !== null) {
      body = JSON.stringify(req.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    } else {
      body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
    }
  }
  return new Request(url, { method, headers, body });
}

/**
 * Send a Web API Response via the Vercel/Node.js ServerResponse.
 * VercelResponse does not support res.write() streaming — we must
 * collect the full body buffer then send it in one shot via res.send().
 */
async function sendWebResponse(webRes: Response, res: VercelResponse): Promise<void> {
  // Set status
  res.status(webRes.status);

  // Copy headers (skip content-length — Node will recalculate)
  webRes.headers.forEach((value: string, key: string) => {
    if (key.toLowerCase() !== 'content-length') {
      res.setHeader(key, value);
    }
  });

  // Collect full body then send once
  if (webRes.body) {
    const reader = webRes.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = Buffer.allocUnsafe(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.length; }
    res.send(buf);
  } else {
    res.end();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.url ?? '/';

  // OPTIONS — CORS preflight
  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, x-cursor-api-key, mcp-session-id');
    res.status(200).end();
    return;
  }

  // OAuth discovery probes — return 404 JSON so validators know no OAuth is used
  if (url.includes('/.well-known/')) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  // Plain GET without SSE Accept — health check for URL validators
  if (method === 'GET') {
    const accept = (req.headers['accept'] as string | undefined) ?? '';
    if (!accept.includes('text/event-stream')) {
      res.status(200).json({ status: 'ok', server: 'cursor-agent-mcp', version: '1.0.0' });
      return;
    }
  }

  // All MCP traffic: POST (initialize + tool calls), DELETE, SSE GET
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    const webReq = await toWebRequest(req);
    const webRes = await transport.handleRequest(webReq);
    await sendWebResponse(webRes, res);
  } catch (err) {
    console.error('MCP handler error:', err);
    res.status(500).json({ error: 'Internal server error', detail: String(err) });
  }
}
