import type { Env } from './claude';

const BASE = 'https://api.github.com';

// Installation-token cache (module-level; shared across invocations in the same isolate).
// GitHub App installation tokens are valid ~1 hour; we refresh 1 minute early.
let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(input: string | Uint8Array): string {
  const str = typeof input === 'string' ? input : String.fromCharCode(...input);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  // Strip PEM headers (accept both PKCS#1 "RSA PRIVATE KEY" and PKCS#8 "PRIVATE KEY")
  const pemBody = privateKeyPem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/, '')
    .replace(/\\n/g, '\n')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

async function getInstallationToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const jwt = await generateAppJwt(env.GITHUB_APP_ID!, env.GITHUB_APP_PRIVATE_KEY!);
  const res = await fetch(
    `${BASE}/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'askarthur-agent-fleet',
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub App token exchange failed: ${await res.text()}`);
  const data = await res.json() as { token: string; expires_at: string };
  cachedToken = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
  return data.token;
}

async function ghHeaders(env: Env): Promise<HeadersInit> {
  const usingApp = env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY;
  const token = usingApp ? await getInstallationToken(env) : env.GITHUB_PAT;
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'askarthur-agent-fleet',
  };
}

export async function getRepoTree(env: Env, ref = 'main'): Promise<string[]> {
  const res = await fetch(
    `${BASE}/repos/${env.GH_REPO}/git/trees/${ref}?recursive=1`,
    { headers: await ghHeaders(env) },
  );
  if (!res.ok) throw new Error(`getRepoTree failed: ${await res.text()}`);
  const data = await res.json() as { tree: Array<{ path: string; type: string }> };
  return data.tree.filter(t => t.type === 'blob').map(t => t.path);
}

interface FileContent {
  content: string;
  sha: string;
}

export async function readFile(env: Env, path: string, ref = 'main'): Promise<FileContent> {
  const res = await fetch(
    `${BASE}/repos/${env.GH_REPO}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    { headers: await ghHeaders(env) },
  );
  if (!res.ok) throw new Error(`readFile(${path}) failed: ${await res.text()}`);
  const data = await res.json() as { content: string; encoding: string; sha: string };
  const content = data.encoding === 'base64'
    ? atob(data.content.replace(/\n/g, ''))
    : data.content;
  return { content, sha: data.sha };
}

export async function listDir(env: Env, path: string, ref = 'main'): Promise<Array<{ name: string; type: string; path: string }>> {
  const url = path
    ? `${BASE}/repos/${env.GH_REPO}/contents/${encodeURIComponent(path)}?ref=${ref}`
    : `${BASE}/repos/${env.GH_REPO}/contents?ref=${ref}`;
  const res = await fetch(url, { headers: await ghHeaders(env) });
  if (!res.ok) throw new Error(`listDir(${path}) failed: ${await res.text()}`);
  const data = await res.json() as Array<{ name: string; type: string; path: string }>;
  return data;
}

export async function createBranch(env: Env, branchName: string, fromBranch = 'main'): Promise<string> {
  // Get SHA of source branch
  const refRes = await fetch(
    `${BASE}/repos/${env.GH_REPO}/git/refs/heads/${fromBranch}`,
    { headers: await ghHeaders(env) },
  );
  if (!refRes.ok) throw new Error(`Get ref failed: ${await refRes.text()}`);
  const refData = await refRes.json() as { object: { sha: string } };
  const sourceSha = refData.object.sha;

  // Create new ref
  const createRes = await fetch(`${BASE}/repos/${env.GH_REPO}/git/refs`, {
    method: 'POST',
    headers: { ...(await ghHeaders(env)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: sourceSha }),
  });
  // Idempotent on collision: GitHub returns 422 with "Reference already exists"
  // when the ref is present. Treat as success — a queue/agent retry should
  // reuse the existing branch instead of erroring out and opening a duplicate.
  if (createRes.status === 422) {
    const body = await createRes.text();
    if (body.includes('Reference already exists')) {
      return branchName;
    }
    throw new Error(`createBranch failed: ${body}`);
  }
  if (!createRes.ok) throw new Error(`createBranch failed: ${await createRes.text()}`);
  return branchName;
}

export async function commitFile(
  env: Env,
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<string> {
  // Check if file exists (to get SHA for update)
  let existingSha: string | undefined;
  try {
    const existing = await readFile(env, path, branch);
    existingSha = existing.sha;
  } catch {
    // File doesn't exist — creating new
  }

  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  if (existingSha) body.sha = existingSha;

  const res = await fetch(
    `${BASE}/repos/${env.GH_REPO}/contents/${encodeURIComponent(path)}`,
    {
      method: 'PUT',
      headers: { ...(await ghHeaders(env)), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`commitFile(${path}) failed: ${await res.text()}`);
  const data = await res.json() as { commit: { sha: string } };
  return data.commit.sha;
}

export async function createPR(
  env: Env,
  title: string,
  body: string,
  head: string,
  base = 'main',
): Promise<string> {
  // Idempotent on retry: if a PR already exists for this head branch, return
  // its URL instead of attempting a duplicate POST (which 422s).
  const owner = env.GH_REPO.split('/')[0];
  const existing = await fetch(
    `${BASE}/repos/${env.GH_REPO}/pulls?state=open&head=${owner}:${head}`,
    { headers: await ghHeaders(env) },
  );
  if (existing.ok) {
    const prs = await existing.json() as Array<{ html_url: string; number: number }>;
    if (prs.length > 0) return prs[0].html_url;
  }

  const res = await fetch(`${BASE}/repos/${env.GH_REPO}/pulls`, {
    method: 'POST',
    headers: { ...(await ghHeaders(env)), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!res.ok) throw new Error(`createPR failed: ${await res.text()}`);
  const data = await res.json() as { html_url: string; number: number };
  return data.html_url;
}
