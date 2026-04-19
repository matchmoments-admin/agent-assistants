import type { Env } from './claude';

const BASE = 'https://api.github.com';

function ghHeaders(env: Env): HeadersInit {
  return {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'askarthur-agent-fleet',
  };
}

export async function getRepoTree(env: Env, ref = 'main'): Promise<string[]> {
  const res = await fetch(
    `${BASE}/repos/${env.GH_REPO}/git/trees/${ref}?recursive=1`,
    { headers: ghHeaders(env) },
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
    { headers: ghHeaders(env) },
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
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`listDir(${path}) failed: ${await res.text()}`);
  const data = await res.json() as Array<{ name: string; type: string; path: string }>;
  return data;
}

export async function createBranch(env: Env, branchName: string, fromBranch = 'main'): Promise<string> {
  // Get SHA of source branch
  const refRes = await fetch(
    `${BASE}/repos/${env.GH_REPO}/git/refs/heads/${fromBranch}`,
    { headers: ghHeaders(env) },
  );
  if (!refRes.ok) throw new Error(`Get ref failed: ${await refRes.text()}`);
  const refData = await refRes.json() as { object: { sha: string } };
  const sourceSha = refData.object.sha;

  // Create new ref
  const createRes = await fetch(`${BASE}/repos/${env.GH_REPO}/git/refs`, {
    method: 'POST',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: sourceSha }),
  });
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
      headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
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
  const res = await fetch(`${BASE}/repos/${env.GH_REPO}/pulls`, {
    method: 'POST',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!res.ok) throw new Error(`createPR failed: ${await res.text()}`);
  const data = await res.json() as { html_url: string; number: number };
  return data.html_url;
}
