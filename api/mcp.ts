/**
 * Cursor Cloud Agent MCP server — Vercel serverless.
 * Implements Streamable HTTP (stateless JSON mode) by hand.
 * No SSE streams — every request gets a direct JSON response.
 * Auth: x-cursor-api-key header (only required for tool calls).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CursorApiClient } from '../src/api-client.js';
import type { LaunchAgentRequest, FollowUpRequest } from '../src/api-client.js';

const SERVER_INFO = { name: 'cursor-agent-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2025-03-26';

const TOOLS = [
  { name: 'list_agents', description: 'List all cloud agents for the authenticated user', inputSchema: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 }, cursor: { type: 'string' } } } },
  { name: 'get_agent', description: 'Retrieve the current status and results of a cloud agent', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get_agent_conversation', description: 'Retrieve the conversation history of a cloud agent', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'launch_agent', description: 'Start a new cloud agent to work on a repository', inputSchema: { type: 'object', required: ['prompt', 'source'], properties: { prompt: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, model: { type: 'string' }, source: { type: 'object', properties: { repository: { type: 'string' }, ref: { type: 'string' } }, required: ['repository'] }, target: { type: 'object', properties: { autoCreatePr: { type: 'boolean' }, openAsCursorGithubApp: { type: 'boolean' }, skipReviewerRequest: { type: 'boolean' }, branchName: { type: 'string' } } }, webhook: { type: 'object', properties: { url: { type: 'string' }, secret: { type: 'string' } }, required: ['url'] } } } },
  { name: 'add_followup', description: 'Add a follow-up instruction to an existing cloud agent', inputSchema: { type: 'object', required: ['id', 'prompt'], properties: { id: { type: 'string' }, prompt: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } } },
  { name: 'stop_agent', description: 'Stop a running cloud agent', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_agent', description: 'Permanently delete a cloud agent', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get_api_key_info', description: 'Get information about the API key being used', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_models', description: 'List recommended models for cloud agents', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_repositories', description: 'List GitHub repositories accessible to the authenticated user', inputSchema: { type: 'object', properties: {} } },
];

function jsonrpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}
function jsonrpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(name: string, args: Record<string, any>, apiKey: string) {
  const apiClient = new CursorApiClient(apiKey);
  switch (name) {
    case 'list_agents': return apiClient.listAgents(args.limit, args.cursor);
    case 'get_agent': return apiClient.getAgent(args.id);
    case 'get_agent_conversation': return apiClient.getAgentConversation(args.id);
    case 'launch_agent': {
      const r: LaunchAgentRequest = { prompt: { text: args.prompt.text, images: args.prompt.images }, model: args.model, source: { repository: args.source.repository, ref: args.source.ref }, target: args.target, webhook: args.webhook };
      return apiClient.launchAgent(r);
    }
    case 'add_followup': {
      const r: FollowUpRequest = { prompt: { text: args.prompt.text, images: args.prompt.images } };
      return apiClient.addFollowUp(args.id, r);
    }
    case 'stop_agent': return apiClient.stopAgent(args.id);
    case 'delete_agent': return apiClient.deleteAgent(args.id);
    case 'get_api_key_info': return apiClient.getApiKeyInfo();
    case 'list_models': return apiClient.listModels();
    case 'list_repositories': return apiClient.listRepositories();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.url ?? '/';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, x-cursor-api-key, mcp-session-id');

  if (method === 'OPTIONS') { res.status(200).end(); return; }
  if (url.includes('/.well-known/')) { res.status(404).json({ error: 'not_found' }); return; }

  // Health check — Poke URL validator hits GET /mcp
  if (method === 'GET') {
    res.status(200).json({ status: 'ok', server: SERVER_INFO.name, version: SERVER_INFO.version });
    return;
  }

  if (method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Parse body (Vercel auto-parses JSON when content-type is application/json)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = req.body as any;
  const id = body?.id ?? null;
  const rpcMethod = body?.method as string | undefined;
  const params = body?.params ?? {};

  res.setHeader('Content-Type', 'application/json');

  try {
    // MCP initialize handshake
    if (rpcMethod === 'initialize') {
      res.status(200).json(jsonrpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: { listChanged: false } },
      }));
      return;
    }

    // Acknowledge initialized notification
    if (rpcMethod === 'notifications/initialized') {
      res.status(202).end();
      return;
    }

    // List tools
    if (rpcMethod === 'tools/list') {
      res.status(200).json(jsonrpc(id, { tools: TOOLS }));
      return;
    }

    // Call a tool — requires API key
    if (rpcMethod === 'tools/call') {
      const apiKeyHeader = req.headers['x-cursor-api-key'];
      const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
      if (!apiKey) {
        res.status(200).json(jsonrpc(id, {
          content: [{ type: 'text', text: 'Error: Missing x-cursor-api-key header. Add it in your Poke integration settings.' }],
          isError: true,
        }));
        return;
      }
      const toolName = params.name as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolArgs = (params.arguments ?? {}) as Record<string, any>;
      try {
        const result = await callTool(toolName, toolArgs, apiKey);
        res.status(200).json(jsonrpc(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }));
      } catch (err) {
        res.status(200).json(jsonrpc(id, {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }));
      }
      return;
    }

    // Unknown method
    res.status(200).json(jsonrpcError(id, -32601, `Method not found: ${rpcMethod}`));
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json(jsonrpcError(id, -32603, `Internal error: ${String(err)}`));
  }
}
