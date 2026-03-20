/**
 * Cursor Cloud Agent MCP server — Vercel serverless.
 * API key read from CURSOR_API_KEY environment variable.
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
  const client = new CursorApiClient(apiKey);
  switch (name) {
    case 'list_agents': return client.listAgents(args.limit, args.cursor);
    case 'get_agent': return client.getAgent(args.id);
    case 'get_agent_conversation': return client.getAgentConversation(args.id);
    case 'launch_agent': {
      const r: LaunchAgentRequest = { prompt: { text: args.prompt.text, images: args.prompt.images }, model: args.model, source: { repository: args.source.repository, ref: args.source.ref }, target: args.target, webhook: args.webhook };
      return client.launchAgent(r);
    }
    case 'add_followup': {
      const r: FollowUpRequest = { prompt: { text: args.prompt.text, images: args.prompt.images } };
      return client.addFollowUp(args.id, r);
    }
    case 'stop_agent': return client.stopAgent(args.id);
    case 'delete_agent': return client.deleteAgent(args.id);
    case 'get_api_key_info': return client.getApiKeyInfo();
    case 'list_models': return client.listModels();
    case 'list_repositories': return client.listRepositories();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.url ?? '/';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, mcp-session-id');

  if (method === 'OPTIONS') { res.status(200).end(); return; }
  if (url.includes('/.well-known/')) { res.status(404).json({ error: 'not_found' }); return; }
  if (method === 'GET') { res.status(200).json({ status: 'ok', server: SERVER_INFO.name, version: SERVER_INFO.version }); return; }
  if (method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = req.body as any;
  const id = body?.id ?? null;
  const rpcMethod = body?.method as string | undefined;
  const params = body?.params ?? {};

  res.setHeader('Content-Type', 'application/json');

  try {
    if (rpcMethod === 'initialize') {
      res.status(200).json(jsonrpc(id, { protocolVersion: PROTOCOL_VERSION, serverInfo: SERVER_INFO, capabilities: { tools: { listChanged: false } } }));
      return;
    }
    if (rpcMethod === 'notifications/initialized') { res.status(202).end(); return; }
    if (rpcMethod === 'tools/list') { res.status(200).json(jsonrpc(id, { tools: TOOLS })); return; }

    if (rpcMethod === 'tools/call') {
      // Read API key from environment variable — set in Vercel project settings
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        res.status(200).json(jsonrpc(id, { content: [{ type: 'text', text: 'Error: CURSOR_API_KEY environment variable not set on the Vercel project.' }], isError: true }));
        return;
      }
      const toolName = params.name as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolArgs = (params.arguments ?? {}) as Record<string, any>;
      try {
        const result = await callTool(toolName, toolArgs, apiKey);
        res.status(200).json(jsonrpc(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }));
      } catch (err) {
        res.status(200).json(jsonrpc(id, { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }));
      }
      return;
    }

    res.status(200).json(jsonrpcError(id, -32601, `Method not found: ${rpcMethod}`));
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json(jsonrpcError(id, -32603, `Internal error: ${String(err)}`));
  }
}
