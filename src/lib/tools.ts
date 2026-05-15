import type { Env } from './claude';
import type { BrandConfig } from '../config/types';
import OAuth from 'oauth-1.0a';
import * as gh from './github';

// Tools that perform irreversible external writes go through requireApproval()
// before executing. The agent makes a single tool call as before; the wrapper
// posts a Telegram approval keyboard and polls KV for the founder's tap. The
// approval gate is invisible to the agent — it sees a normal tool result.
const GATED_TOOLS = new Set([
  'publish_to_ghost',
  'post_to_twitter',
  'post_to_linkedin',
  'gh_create_pr',
  'email_founder',
]);

function summarizeForApproval(tool: string, input: Record<string, unknown>): string {
  const text = (input.text as string) ?? (input.body as string) ?? (input.title as string) ?? '';
  const slug = (input.slug as string) ?? (input.dbType as string) ?? (input.branch as string) ?? '';
  const head = text ? `\n\n${text.slice(0, 280)}${text.length > 280 ? '…' : ''}` : '';
  return `Tool: <b>${tool}</b>${slug ? ` (${slug})` : ''}${head}`;
}

async function requireApproval(
  env: Env,
  tool: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  const nonce = crypto.randomUUID();
  const key = `confirm:${nonce}`;
  await env.AGENT_CONFIG.put(
    key,
    JSON.stringify({ tool, status: 'pending', createdAt: Date.now() }),
    { expirationTtl: 900 }, // 15 min — must complete within session watchdog
  );

  const chatId = parseInt(env.TELEGRAM_ALLOWED_IDS.split(',')[0].trim(), 10);
  const summary = summarizeForApproval(tool, input);
  const message = `🔒 Approval needed before <b>${tool}</b> runs.\n\n${summary}\n\nTap to allow or reject.`;
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Allow', callback_data: `tool_ok:${nonce}` },
      { text: '❌ Reject', callback_data: `tool_no:${nonce}` },
    ]],
  };
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', reply_markup: keyboard }),
  });

  // Poll KV every 5s for up to ~5 minutes. Session watchdog is 10 min so this
  // leaves ~5 min for the tool itself. Falls back to "rejected" on timeout.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const raw = await env.AGENT_CONFIG.get(key);
    if (!raw) return false; // expired
    const record = JSON.parse(raw) as { status: string };
    if (record.status === 'approved') return true;
    if (record.status === 'rejected') return false;
  }
  return false;
}

export async function executeCustomTool(
  env: Env,
  config: BrandConfig,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (GATED_TOOLS.has(name)) {
    const approved = await requireApproval(env, name, input);
    if (!approved) {
      return `Aborted: ${name} was not approved by the founder. Do not retry. Continue with any non-gated work or end the turn.`;
    }
  }
  switch (name) {
    // Content tools
    case 'save_to_notion':
      return saveToNotion(env, config, input);
    case 'publish_to_ghost':
      return publishToGhost(env, config, input);
    case 'post_to_twitter':
      return postToTwitter(env, config, input.text as string);
    case 'post_to_linkedin':
      return postToLinkedIn(env, config, input.text as string);
    case 'email_founder':
      return emailFounder(env, config, input);
    case 'request_telegram_approval':
      return requestTelegramApproval(env, input);

    // Code agent tools
    case 'gh_list_dir':
      return ghListDir(env, input.path as string);
    case 'gh_read_file':
      return ghReadFile(env, input.path as string);
    case 'gh_create_branch':
      return ghCreateBranch(env, input.name as string);
    case 'gh_commit_file':
      return ghCommitFile(env, input);
    case 'gh_create_pr':
      return ghCreatePR(env, input);
    case 'notify_founder':
      return notifyFounder(env, input.message as string);

    default:
      return `Error: Unknown tool "${name}"`;
  }
}

// ── GitHub / Code Agent tools ─────────────────────────────────────────────────

async function ghListDir(env: Env, path: string): Promise<string> {
  try {
    const items = await gh.listDir(env, path ?? '');
    return items.map(i => `${i.type === 'dir' ? 'D' : 'F'} ${i.path}`).join('\n');
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function ghReadFile(env: Env, path: string): Promise<string> {
  try {
    const { content } = await gh.readFile(env, path);
    return content;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function ghCreateBranch(env: Env, name: string): Promise<string> {
  try {
    const branch = await gh.createBranch(env, name);
    return `Branch created: ${branch}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function ghCommitFile(env: Env, input: Record<string, unknown>): Promise<string> {
  try {
    const sha = await gh.commitFile(
      env,
      input.branch as string,
      input.path as string,
      input.content as string,
      input.message as string,
    );
    return `Committed ${input.path} to ${input.branch} (${sha.slice(0, 7)})`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function ghCreatePR(env: Env, input: Record<string, unknown>): Promise<string> {
  try {
    const url = await gh.createPR(
      env,
      input.title as string,
      input.body as string,
      input.branch as string,
    );
    return `PR opened: ${url}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function notifyFounder(env: Env, message: string): Promise<string> {
  try {
    const allowedIds = env.TELEGRAM_ALLOWED_IDS.split(',').map(id => parseInt(id.trim(), 10));
    const chatId = allowedIds[0];
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    if (!res.ok) return `Telegram error: ${await res.text()}`;
    return `Notified founder via Telegram`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Notion ────────────────────────────────────────────────────────────────────

async function saveToNotion(
  env: Env,
  config: BrandConfig,
  input: Record<string, unknown>,
): Promise<string> {
  const dbMap: Record<string, string> = {
    blog: config.notionBlogDbId,
    social: config.notionSocialDbId,
    investor: config.notionInvestorDbId,
    competitor: config.notionCompetitorDbId,
    digest: config.notionDigestsDbId,
  };

  const dbId = dbMap[input.database as string];
  if (!dbId) return `Error: Unknown database "${input.database}"`;

  const rawExtraProps = (input.properties as Record<string, unknown>) ?? {};
  // Drop `Name` from extraProps — we always write our own Name (the title).
  // If the agent sends {Name: ...} in properties, its shape is usually wrong
  // and would override ours, producing validation_error from Notion.
  const extraProps = Object.fromEntries(
    Object.entries(rawExtraProps).filter(([k]) => k !== 'Name'),
  );

  // Always write Name (Notion requires a title). Status/Product are optional —
  // include them only if the target DB has those columns (pass via extraProps).
  // The /publish workflow needs a Status column with values Draft/Approved.
  const titleProp = {
    Name: { title: [{ text: { content: input.title as string } }] },
  };
  const children = markdownToBlocks(input.content as string);

  const sendPage = (props: Record<string, unknown>) => fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({ parent: { database_id: dbId }, properties: props, children }),
  });

  let res = await sendPage({ ...extraProps, ...titleProp });

  // Agents often guess columns ("Significance", "Scan Date", ...) that don't
  // exist in the target DB. Notion rejects the whole page with a 400
  // validation_error on body.properties.<col>. Strip extraProps and retry
  // once with the title only — same fallback the agent would do organically,
  // but cuts a 2-minute round-trip out of the session.
  if (!res.ok && res.status === 400 && Object.keys(extraProps).length > 0) {
    const errText = await res.clone().text();
    if (/validation_error/.test(errText) && /body\.properties\./.test(errText)) {
      console.warn(`[save_to_notion] stripping unknown properties after 400: ${Object.keys(extraProps).join(',')}`);
      res = await sendPage(titleProp);
    }
  }

  if (!res.ok) return `Notion error: ${await res.text()}`;
  const data = await res.json() as { url: string; id: string };
  return `Saved to Notion: ${data.url} (ID: ${data.id})`;
}

// Parse the agent's markdown into typed Notion blocks so headings, lists,
// dividers, and inline bold/italic/code/links render properly. Agents emit
// markdown directly, but Notion requires structured block objects — the
// previous splitToBlocks dumped everything as plain paragraphs, so `#`,
// `**bold**` and `---` showed up as literal text.
function markdownToBlocks(text: string): object[] {
  const lines = text.split('\n');
  const blocks: object[] = [];
  let paragraphBuffer: string[] = [];
  let inCodeFence = false;
  let codeFenceLang = '';
  let codeFenceLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    blocks.push(makeBlock('paragraph', parseInline(paragraphBuffer.join('\n'))));
    paragraphBuffer = [];
  };

  const flushCodeFence = () => {
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        rich_text: [{ type: 'text', text: { content: codeFenceLines.join('\n').slice(0, 2000) } }],
        language: notionCodeLang(codeFenceLang),
      },
    });
    codeFenceLines = [];
    codeFenceLang = '';
    inCodeFence = false;
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCodeFence) { flushCodeFence(); continue; }
      flushParagraph();
      inCodeFence = true;
      codeFenceLang = line.trim().slice(3).trim();
      continue;
    }
    if (inCodeFence) { codeFenceLines.push(line); continue; }

    if (line.trim() === '') { flushParagraph(); continue; }

    const h3 = line.match(/^### (.+)$/);
    const h2 = !h3 && line.match(/^## (.+)$/);
    const h1 = !h3 && !h2 && line.match(/^# (.+)$/);
    if (h1 || h2 || h3) {
      flushParagraph();
      const type = h1 ? 'heading_1' : h2 ? 'heading_2' : 'heading_3';
      const content = (h1 || h2 || h3)![1];
      blocks.push(makeBlock(type, parseInline(content)));
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }

    const bullet = line.match(/^[-*] (.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push(makeBlock('bulleted_list_item', parseInline(bullet[1])));
      continue;
    }

    const numbered = line.match(/^\d+\. (.+)$/);
    if (numbered) {
      flushParagraph();
      blocks.push(makeBlock('numbered_list_item', parseInline(numbered[1])));
      continue;
    }

    const quote = line.match(/^> (.+)$/);
    if (quote) {
      flushParagraph();
      blocks.push(makeBlock('quote', parseInline(quote[1])));
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  if (inCodeFence) flushCodeFence();

  if (blocks.length === 0) {
    return [makeBlock('paragraph', [{ type: 'text', text: { content: '' } }])];
  }
  return blocks;
}

function makeBlock(type: string, richText: object[]): object {
  return { object: 'block', type, [type]: { rich_text: richText } };
}

// Convert inline markdown (**bold**, *italic*, `code`, [text](url)) into
// Notion rich_text elements. Underscore italics are intentionally not
// supported to avoid false positives on snake_case identifiers and URLs.
function parseInline(text: string): object[] {
  const out: object[] = [];
  const pattern = /(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (s: string) => {
    if (!s) return;
    for (let i = 0; i < s.length; i += 2000) {
      out.push({ type: 'text', text: { content: s.slice(i, i + 2000) } });
    }
  };

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) pushPlain(text.slice(cursor, match.index));
    if (match[1]) {
      out.push({ type: 'text', text: { content: match[2] }, annotations: { code: true } });
    } else if (match[3]) {
      out.push({ type: 'text', text: { content: match[4], link: { url: match[5] } } });
    } else if (match[6]) {
      out.push({ type: 'text', text: { content: match[7] }, annotations: { bold: true } });
    } else if (match[8]) {
      out.push({ type: 'text', text: { content: match[9] }, annotations: { italic: true } });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) pushPlain(text.slice(cursor));
  if (out.length === 0) out.push({ type: 'text', text: { content: '' } });
  return out;
}

// Notion's `code` block language enum accepts these common values; anything
// unrecognised falls back to 'plain text' which Notion always accepts.
const NOTION_CODE_LANGS = new Set([
  'bash', 'c', 'css', 'docker', 'go', 'graphql', 'html', 'java', 'javascript',
  'json', 'markdown', 'php', 'python', 'ruby', 'rust', 'shell', 'sql',
  'swift', 'typescript', 'yaml',
]);
function notionCodeLang(lang: string): string {
  const normalised = lang.toLowerCase().trim();
  if (normalised === 'ts') return 'typescript';
  if (normalised === 'js') return 'javascript';
  if (normalised === 'py') return 'python';
  if (normalised === 'sh') return 'shell';
  if (NOTION_CODE_LANGS.has(normalised)) return normalised;
  return 'plain text';
}

async function updateNotionStatus(
  env: Env,
  pageId: string,
  status: string,
  publishedUrl?: string,
): Promise<void> {
  const props: Record<string, unknown> = {
    Status: { select: { name: status } },
  };
  if (publishedUrl) {
    props['Published URL'] = { url: publishedUrl };
  }
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({ properties: props }),
  });
}

export async function queryNotionByStatus(
  env: Env,
  databaseId: string,
  status: string,
): Promise<Array<{ id: string; title: string; content: string }>> {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      filter: { property: 'Status', select: { equals: status } },
    }),
  });

  if (!res.ok) return [];
  const data = await res.json() as {
    results: Array<{
      id: string;
      properties: {
        Name?: { title: Array<{ plain_text: string }> };
      };
    }>;
  };

  return data.results.map(page => ({
    id: page.id,
    title: page.properties.Name?.title?.[0]?.plain_text ?? 'Untitled',
    content: '', // content fetched separately if needed
  }));
}

// ── Ghost ─────────────────────────────────────────────────────────────────────

async function publishToGhost(
  env: Env,
  config: BrandConfig,
  input: Record<string, unknown>,
): Promise<string> {
  const [keyId, secret] = config.ghostAdminApiKey.split(':');
  const token = await generateGhostToken(keyId, secret);
  const authHeaders = {
    'Authorization': `Ghost ${token}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Create post as draft
  const createRes = await fetch(`${config.ghostApiUrl}/ghost/api/admin/posts/`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      posts: [{
        title: input.title as string,
        html: input.html as string,
        status: 'draft',
        tags: ((input.tags as string[]) ?? []).map(name => ({ name })),
      }],
    }),
  });

  if (!createRes.ok) return `Ghost create error: ${await createRes.text()}`;
  const createData = await createRes.json() as {
    posts: Array<{ id: string; uuid: string; updated_at: string }>;
  };
  const post = createData.posts[0];

  // Step 2: Publish with newsletter delivery via PUT
  const sendNewsletter = input.send_email_newsletter !== false;
  const publishUrl = new URL(`${config.ghostApiUrl}/ghost/api/admin/posts/${post.id}/`);
  if (sendNewsletter) {
    publishUrl.searchParams.set('newsletter', 'default-newsletter');
    publishUrl.searchParams.set('email_segment', 'all');
  }

  // Refresh token for the second request
  const token2 = await generateGhostToken(keyId, secret);
  const publishRes = await fetch(publishUrl.toString(), {
    method: 'PUT',
    headers: {
      'Authorization': `Ghost ${token2}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      posts: [{
        status: 'published',
        updated_at: post.updated_at,
      }],
    }),
  });

  if (!publishRes.ok) return `Ghost publish error: ${await publishRes.text()}`;
  const publishData = await publishRes.json() as {
    posts: Array<{ url: string; id: string; slug: string }>;
  };
  const published = publishData.posts[0];

  // Write the canonical askarthur.au URL (mirrored via nginx) to Notion, not the Ghost origin
  const canonicalUrl = `https://askarthur.au/blog/${published.slug}`;
  if (input.notion_page_id) {
    await updateNotionStatus(env, input.notion_page_id as string, 'Published', canonicalUrl);
  }

  const emailNote = sendNewsletter ? ' — newsletter sent to all subscribers' : '';
  return `Published to Ghost: ${canonicalUrl}${emailNote}`;
}

async function generateGhostToken(keyId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const encodeBase64Url = (str: string) =>
    btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: keyId }));
  const payload = encodeBase64Url(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' }));

  const key = await crypto.subtle.importKey(
    'raw',
    hexToBuffer(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  const sig = encodeBase64Url(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return `${header}.${payload}.${sig}`;
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}

// ── Twitter/X ─────────────────────────────────────────────────────────────────

async function postToTwitter(
  env: Env,
  config: BrandConfig,
  text: string,
): Promise<string> {
  const endpoint = 'https://api.twitter.com/2/tweets';

  const oauth = new OAuth({
    consumer: { key: env.TWITTER_API_KEY, secret: env.TWITTER_API_SECRET },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      // oauth-1.0a expects sync, but Workers crypto is async.
      // We pre-compute the signature outside and pass it in.
      // This is a simplified approach — for production, use a
      // Web Crypto compatible OAuth library or pre-sign.
      throw new Error('Use buildOAuth1Header instead');
    },
  });

  const authHeader = await buildOAuth1Header(env, 'POST', endpoint);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) return `Twitter error: ${await res.text()}`;
  const data = await res.json() as { data: { id: string } };
  const handle = config.twitterHandle.replace('@', '');
  return `Posted: https://twitter.com/${handle}/status/${data.data.id}`;
}

async function buildOAuth1Header(
  env: Env,
  method: string,
  url: string,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const params: Record<string, string> = {
    oauth_consumer_key: env.TWITTER_API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: env.TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // Create signature base string
  const paramString = Object.keys(params)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join('&');

  // Sign with HMAC-SHA1
  const signingKey = `${encodeURIComponent(env.TWITTER_API_SECRET)}&${encodeURIComponent(env.TWITTER_ACCESS_SECRET)}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(baseString),
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  params['oauth_signature'] = signature;

  const headerString = Object.keys(params)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`)
    .join(', ');

  return `OAuth ${headerString}`;
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

async function postToLinkedIn(
  env: Env,
  config: BrandConfig,
  text: string,
): Promise<string> {
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202504',
    },
    body: JSON.stringify({
      author: `urn:li:organization:${config.linkedinCompanyId}`,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
    }),
  });

  if (!res.ok) return `LinkedIn error: ${await res.text()}`;
  return 'Posted to LinkedIn successfully';
}

// ── Email founder (Mailgun) ───────────────────────────────────────────────────

async function requestTelegramApproval(
  env: Env,
  input: Record<string, unknown>,
): Promise<string> {
  const notionPageId = input.notion_page_id as string;
  const notionUrl = input.notion_url as string;
  const title = (input.title as string) ?? 'Draft ready for review';
  const preview = (input.preview as string) ?? '';

  if (!notionPageId || !notionUrl) {
    return 'Error: notion_page_id and notion_url are required';
  }

  const allowedIds = env.TELEGRAM_ALLOWED_IDS.split(',').map(s => s.trim()).filter(Boolean);
  if (allowedIds.length === 0) return 'Error: no TELEGRAM_ALLOWED_IDS configured';
  const chatId = parseInt(allowedIds[0], 10);

  const nonce = crypto.randomUUID();
  await env.AGENT_CONFIG.put(
    `approval:${nonce}`,
    JSON.stringify({
      notion_page_id: notionPageId,
      status: 'pending',
      title,
      created_at: Date.now(),
    }),
    { expirationTtl: 7 * 24 * 60 * 60 }, // 7 days
  );

  const body = preview
    ? `<b>📋 ${escapeHtml(title)}</b>\n\n${escapeHtml(preview)}\n\n<a href="${notionUrl}">Review full draft in Notion</a>`
    : `<b>📋 ${escapeHtml(title)}</b>\n\n<a href="${notionUrl}">Review full draft in Notion</a>`;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `approve_ok:${nonce}` },
      { text: '❌ Reject', callback_data: `approve_no:${nonce}` },
    ]],
  };

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: body,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: keyboard,
    }),
  });

  if (!res.ok) return `Telegram error: ${await res.text()}`;
  return `Approval request sent to Telegram (nonce ${nonce.slice(0, 8)}). Waiting for human decision; this tool does not block — continue with your other tasks.`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function emailFounder(
  env: Env,
  config: BrandConfig,
  input: Record<string, unknown>,
): Promise<string> {
  const subject = (input.subject as string).startsWith('[REVIEW REQUIRED]')
    ? input.subject as string
    : `[REVIEW REQUIRED] ${input.subject}`;

  const form = new URLSearchParams();
  form.set('from', `${config.productName} Agent Fleet <agents@${env.MAILGUN_DOMAIN}>`);
  form.set('to', config.founderEmail);
  form.set('subject', subject);
  form.set('text', input.body as string);

  const res = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}`,
    },
    body: form,
  });

  if (!res.ok) return `Mailgun error: ${await res.text()}`;
  return `Email sent to ${config.founderEmail}`;
}
