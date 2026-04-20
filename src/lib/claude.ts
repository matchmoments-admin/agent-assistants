export interface Env {
  ANTHROPIC_API_KEY: string;
  AGENT_CONFIG: KVNamespace;
  AGENT_MEMORY: DurableObjectNamespace;
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
  DEPLOY_HOOK_URL: string;
  GH_REPO: string;
  DEBUG_AGENT_API?: string;
}

const BASE = 'https://api.anthropic.com';

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

  const res = await fetch(`${BASE}/v1/environments`, {
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

  const createRes = await fetch(`${BASE}/v1/vaults`, {
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
    const credRes = await fetch(`${BASE}/v1/vaults/${vaultId}/credentials`, {
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
  const res = await fetch(`${BASE}/v1/agents`, {
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

export async function startSession(
  env: Env,
  agentId: string,
  environmentId: string,
  title: string,
  vaultIds: string[] = [],
): Promise<string> {
  const res = await fetch(`${BASE}/v1/sessions`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      agent: { type: 'agent', id: agentId },
      environment_id: environmentId,
      title,
      vault_ids: vaultIds,
    }),
  });
  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Start session failed [req ${rid}]: ${await res.text()}`);
  }
  const data = await res.json() as { id: string };
  return data.id;
}

export async function sendPrompt(
  env: Env,
  sessionId: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${BASE}/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
    }),
  });
  if (env.DEBUG_AGENT_API === '1') {
    const rid = res.headers.get('request-id') ?? 'unknown';
    console.log(`[debug] sendPrompt status=${res.status} req=${rid} body=${await res.clone().text()}`);
  }
  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Send prompt failed [req ${rid}]: ${await res.text()}`);
  }
}

export async function sendToolResult(
  env: Env,
  sessionId: string,
  toolUseId: string,
  result: string,
): Promise<void> {
  const res = await fetch(`${BASE}/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      events: [{
        type: 'user.custom_tool_result',
        custom_tool_use_id: toolUseId,
        content: [{ type: 'text', text: result }],
      }],
    }),
  });
  if (env.DEBUG_AGENT_API === '1') {
    const rid = res.headers.get('request-id') ?? 'unknown';
    console.log(`[debug] sendToolResult status=${res.status} req=${rid} body=${await res.clone().text()}`);
  }
  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Send tool result failed [req ${rid}]: ${await res.text()}`);
  }
}

export async function archiveSession(env: Env, sessionId: string): Promise<void> {
  await fetch(`${BASE}/v1/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: headers(env),
  });
}

export interface SSEEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export async function streamSession(
  env: Env,
  sessionId: string,
  onEvent: (event: SSEEvent) => Promise<void>,
): Promise<void> {
  const res = await fetch(`${BASE}/v1/sessions/${sessionId}/events/stream`, {
    headers: {
      ...headers(env),
      Accept: 'text/event-stream',
    },
  });
  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Stream failed [req ${rid}]: ${await res.text()}`);
  }
  if (!res.body) throw new Error('No response body for stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    let currentEventType = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEventType = line.slice(7).trim();
      } else if (line.startsWith('data: ') && currentEventType) {
        try {
          const data = JSON.parse(line.slice(6));
          await onEvent({ type: currentEventType, ...data });
        } catch {
          // skip malformed JSON
        }
        currentEventType = '';
      }
    }
  }
}
