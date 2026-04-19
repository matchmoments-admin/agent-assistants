import type { Env } from './claude';
import type { BrandConfig } from '../config/types';
import OAuth from 'oauth-1.0a';
import * as gh from './github';

export async function executeCustomTool(
  env: Env,
  config: BrandConfig,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
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

  const extraProps = (input.properties as Record<string, unknown>) ?? {};

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2025-09-03',
    },
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        Name: {
          title: [{ text: { content: input.title as string } }],
        },
        Status: {
          select: { name: 'Draft' },
        },
        Product: {
          select: { name: config.productName },
        },
        ...extraProps,
      },
      children: splitToBlocks(input.content as string),
    }),
  });

  if (!res.ok) return `Notion error: ${await res.text()}`;
  const data = await res.json() as { url: string; id: string };
  return `Saved to Notion: ${data.url} (ID: ${data.id})`;
}

function splitToBlocks(text: string): object[] {
  // Notion blocks have a 2000 character limit per rich_text element
  const chunks: object[] = [];
  for (let i = 0; i < text.length; i += 2000) {
    chunks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: text.slice(i, i + 2000) },
        }],
      },
    });
  }
  return chunks.length > 0 ? chunks : [{
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: '' } }] },
  }];
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
      'Notion-Version': '2025-09-03',
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
      'Notion-Version': '2025-09-03',
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
    posts: Array<{ url: string; id: string }>;
  };
  const published = publishData.posts[0];

  // Update Notion status to Published
  if (input.notion_page_id) {
    await updateNotionStatus(env, input.notion_page_id as string, 'Published', published.url);
  }

  const emailNote = sendNewsletter ? ' — newsletter sent to all subscribers' : '';
  return `Published to Ghost: ${published.url}${emailNote}`;
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
