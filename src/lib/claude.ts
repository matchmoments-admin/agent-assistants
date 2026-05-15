export interface Env {
  ANTHROPIC_API_KEY: string;
  AGENT_CONFIG: KVNamespace;
  AGENT_MEMORY: DurableObjectNamespace;
  BUDGET: DurableObjectNamespace;
  AGENT_VECTORS: VectorizeIndex;
  PRODUCT_ID: string;
  BUDGET_LIMIT_USD: string;
  WEB_SEARCH_CAP: string;
  GHOST_API_URL: string;
  GHOST_ADMIN_API_KEY: string;
  TWITTER_API_KEY: string;
  TWITTER_API_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_SECRET: string;
  LINKEDIN_ACCESS_TOKEN: string;
  MAILGUN_API_KEY: string;
  MAILGUN_DOMAIN: string;
  GMAIL_OAUTH_TOKEN: string;
  GCAL_OAUTH_TOKEN: string;
  NOTION_TOKEN: string;
  NOTION_DB_BLOG: string;
  NOTION_DB_SOCIAL: string;
  NOTION_DB_INVESTOR: string;
  NOTION_DB_COMPETITOR: string;
  NOTION_DB_DIGESTS: string;
  FOUNDER_EMAIL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_IDS: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GITHUB_PAT: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  DEPLOY_HOOK_URL: string;
  GH_REPO: string;
  ILLUSTRATE_SECRET?: string;
  // Optional: full Cloudflare AI Gateway URL ending in `/anthropic`, e.g.
  // https://gateway.ai.cloudflare.com/v1/<account>/agent-fleet/anthropic
  // When set, both the SDK and raw-fetch paths route through it for tracing.
  AI_GATEWAY_URL?: string;
  AGENT_TASKS: Queue<AgentTaskMessage>;
  DEPLOY_WORKFLOW: Workflow;
  ROLLBACK_WORKFLOW: Workflow;
}

export function anthropicBaseUrl(env: Env): string {
  return env.AI_GATEWAY_URL ?? 'https://api.anthropic.com';
}

export interface AgentTaskMessage {
  kind: 'agent-command' | 'feature';
  chatId: number;
  userId: number;
  agent?: 'cmo' | 'cpo' | 'growth' | 'ir';
  task?: string;
  description?: string;
  // SHA-256 of (chatId, messageId, command). Set by the Telegram producer so a
  // queue retry of the same message hits the dedup short-circuit in queue().
  idempotencyKey?: string;
}

export async function computeIdempotencyKey(...parts: (string | number)[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join(''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Module-level fallback used by helpers that already have an Env in scope —
// they should call anthropicBaseUrl(env) instead. Bootstrap-only paths
// (createAgent, createVault, ensureEnvironment) read this directly.
function base(env: Env): string {
  return anthropicBaseUrl(env);
}

// Retry transient failures (429 rate limit, 529 overloaded, 500/502/503/504 server)
// with exponential backoff honouring the retry-after header.
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3,
): Promise<Response> {
  let lastRes: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if (res.status === 429 || res.status === 529 || (res.status >= 500 && res.status < 600)) {
      lastRes = res;
      if (attempt === maxAttempts) break;
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '0', 10);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 500 * 2 ** (attempt - 1));
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res; // 4xx other than 429 — no retry
  }
  return lastRes!;
}

export function headers(env: Env): HeadersInit {
  return {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'managed-agents-2026-04-01',
    'Content-Type': 'application/json',
  };
}

export const kv = {
  get: (env: Env, k: string) => env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:${k}`),
  put: (env: Env, k: string, v: string) =>
    env.AGENT_CONFIG.put(`${env.PRODUCT_ID}:${k}`, v),
};

export async function ensureEnvironment(env: Env): Promise<string> {
  const cached = await kv.get(env, 'environment_id');
  if (cached) return cached;

  const res = await fetch(`${base(env)}/v1/environments`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      name: `${env.PRODUCT_ID}-env`,
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    }),
  });
  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Create environment failed [req ${rid}]: ${await res.text()}`);
  }
  const data = await res.json() as { id: string };
  await kv.put(env, 'environment_id', data.id);
  return data.id;
}

export async function createVault(
  env: Env,
  name: string,
  secrets: Record<string, string>,
): Promise<string> {
  const cached = await kv.get(env, `vault_${name}`);
  if (cached) return cached;

  const createRes = await fetch(`${base(env)}/v1/vaults`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ display_name: name }),
  });
  if (!createRes.ok) {
    const rid = createRes.headers.get('request-id') ?? 'unknown';
    throw new Error(`Create vault failed [req ${rid}]: ${await createRes.text()}`);
  }
  const { id: vaultId } = await createRes.json() as { id: string };

  for (const [key, value] of Object.entries(secrets)) {
    const credRes = await fetch(`${base(env)}/v1/vaults/${vaultId}/credentials`, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify({
        display_name: key,
        auth: { type: 'static_bearer', token: value },
      }),
    });
    if (!credRes.ok) {
      const rid = credRes.headers.get('request-id') ?? 'unknown';
      throw new Error(`Add credential "${key}" failed [req ${rid}]: ${await credRes.text()}`);
    }
  }

  await kv.put(env, `vault_${name}`, vaultId);
  return vaultId;
}

export async function createAgent(
  env: Env,
  name: string,
  systemPrompt: string,
  customTools: object[],
  skillIds: string[] = [],
  mcpServers: object[] = [],
  model = 'claude-sonnet-4-6',
): Promise<string> {
  const res = await fetch(`${base(env)}/v1/agents`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      name: `${name}-${env.PRODUCT_ID}`,
      model,
      system: systemPrompt,
      tools: [{ type: 'agent_toolset_20260401' }, ...customTools],
      skills: skillIds.map(skill_id => ({ type: 'custom', skill_id })),
      mcp_servers: [...mcpServers],
    }),
  });
  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Create agent failed [req ${rid}]: ${await res.text()}`);
  }
  const data = await res.json() as { id: string };
  return data.id;
}

export async function updateAgent(
  env: Env,
  agentId: string,
  name: string,
  systemPrompt: string,
  customTools: object[],
  skillIds: string[] = [],
  mcpServers: object[] = [],
  model = 'claude-sonnet-4-6',
): Promise<void> {
  // Fetch the current version so we can send version+1 as the new version.
  const getRes = await fetch(`${base(env)}/v1/agents/${agentId}`, { headers: headers(env) });
  if (!getRes.ok) {
    const rid = getRes.headers.get('request-id') ?? 'unknown';
    throw new Error(`Fetch agent ${agentId} failed [req ${rid}]: ${await getRes.text()}`);
  }
  const current = await getRes.json() as { version?: number };

  const res = await fetch(`${base(env)}/v1/agents/${agentId}`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      version: current.version ?? 1,
      name: `${name}-${env.PRODUCT_ID}`,
      model,
      system: systemPrompt,
      tools: [{ type: 'agent_toolset_20260401' }, ...customTools],
      skills: skillIds.map(skill_id => ({ type: 'custom', skill_id })),
      mcp_servers: [...mcpServers],
    }),
  });
  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Update agent ${agentId} failed [req ${rid}]: ${await res.text()}`);
  }
}

// ── Session API (SDK-backed) ──────────────────────────────────────────────────
//
// Hot-path session calls go through @anthropic-ai/sdk's beta.sessions.* surface.
// The SDK auto-attaches `anthropic-beta: managed-agents-2026-04-01`, accumulates
// the SSE stream into a typed AsyncIterable, and absorbs schema drift on the
// beta wire. Bootstrap-only paths (createAgent / updateAgent / createVault /
// ensureEnvironment) above stay on raw fetch — they're touched once at /setup
// and the contract test catches drift early.

import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaManagedAgentsStreamSessionEvents,
  BetaManagedAgentsSessionEvent,
} from '@anthropic-ai/sdk/resources/beta/sessions/events';

let _client: Anthropic | undefined;
let _clientKey: string | undefined;
let _clientBase: string | undefined;
function getClient(env: Env): Anthropic {
  const baseURL = anthropicBaseUrl(env);
  if (!_client || _clientKey !== env.ANTHROPIC_API_KEY || _clientBase !== baseURL) {
    _client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL,
      // Cloudflare AI Gateway uses cf-aig-metadata for searchable trace tags.
      // Sending it always is safe — direct Anthropic ignores unknown headers.
      defaultHeaders: {
        'cf-aig-metadata': JSON.stringify({ product: env.PRODUCT_ID }),
      },
    });
    _clientKey = env.ANTHROPIC_API_KEY;
    _clientBase = baseURL;
  }
  return _client;
}

function annotateRequestId(prefix: string, err: unknown): Error {
  if (err instanceof Anthropic.APIError) {
    const rid = err.requestID ?? 'unknown';
    return new Error(`${prefix} [req ${rid}]: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(`${prefix}: ${String(err)}`);
}

export async function startSession(
  env: Env,
  agentId: string,
  environmentId: string,
  title: string,
  vaultIds: string[] = [],
): Promise<string> {
  try {
    const session = await getClient(env).beta.sessions.create({
      agent: { type: 'agent', id: agentId },
      environment_id: environmentId,
      title,
      vault_ids: vaultIds,
    });
    return session.id;
  } catch (err) {
    throw annotateRequestId('Start session failed', err);
  }
}

export async function sendPrompt(
  env: Env,
  sessionId: string,
  text: string,
): Promise<void> {
  try {
    await getClient(env).beta.sessions.events.send(sessionId, {
      events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
    });
  } catch (err) {
    throw annotateRequestId('Send prompt failed', err);
  }
}

export async function sendToolResult(
  env: Env,
  sessionId: string,
  toolUseId: string,
  result: string,
): Promise<void> {
  try {
    await getClient(env).beta.sessions.events.send(sessionId, {
      events: [{
        type: 'user.custom_tool_result',
        custom_tool_use_id: toolUseId,
        content: [{ type: 'text', text: result }],
      }],
    });
  } catch (err) {
    throw annotateRequestId('Send tool result failed', err);
  }
}

export async function listSessionEvents(
  env: Env,
  sessionId: string,
  limit: number = 100,
): Promise<SSEEvent[]> {
  try {
    const events: BetaManagedAgentsSessionEvent[] = [];
    for await (const event of getClient(env).beta.sessions.events.list(sessionId, { limit })) {
      events.push(event);
      if (events.length >= limit) break;
    }
    return events as SSEEvent[];
  } catch (err) {
    throw annotateRequestId('List events failed', err);
  }
}

export async function archiveSession(env: Env, sessionId: string): Promise<void> {
  try {
    await getClient(env).beta.sessions.archive(sessionId);
  } catch {
    // best effort — caller already in finally
  }
}

// SSEEvent is the discriminated union the session-runner consumes. It's wider
// than BetaManagedAgentsSessionEvent because the streaming endpoint can emit
// span/status events that the list endpoint historically did not.
export type SSEEvent = BetaManagedAgentsStreamSessionEvents;

export async function streamSessionEvents(
  env: Env,
  sessionId: string,
  onOpen: () => Promise<void>,
  onEvent: (event: SSEEvent) => Promise<void>,
  shouldBreak?: (event: SSEEvent) => boolean,
): Promise<void> {
  try {
    // Awaiting .stream() ensures the SSE connection is established (response
    // headers received). Anything sent via sendPrompt/sendToolResult after
    // onOpen() returns is guaranteed to arrive on a live subscription.
    const stream = await getClient(env).beta.sessions.events.stream(sessionId);
    await onOpen();
    for await (const event of stream) {
      await onEvent(event);
      // The server keeps the SSE channel open after session.status_idle until
      // its own ~2-minute timeout. Without an explicit break the runner sits
      // idle between turns and burns the session watchdog.
      if (shouldBreak?.(event)) break;
    }
  } catch (err) {
    throw annotateRequestId('Stream failed', err);
  }
}
