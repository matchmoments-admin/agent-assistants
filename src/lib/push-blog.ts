import type { Env } from './claude';
import type { BrandConfig } from '../config/types';

// On-ramp for the founder's locally-authored markdown drafts.
//
// Calls flow: safeverify scripts/push-blog.mjs ──▶ POST /push-blog (here)
//   1. Create a Ghost post in `draft` status
//   2. Save a row in the Notion Blog Drafts DB with Status=Draft +
//      Ghost Post ID + Ghost Preview URL columns populated
//   3. Write KV approval:{nonce} with kind=push-blog so the existing
//      Telegram approval keyboard re-uses the existing callback handler
//      to flip Ghost from draft → published with newsletter delivery.
//
// The agent-originated path (CMO blog-draft cron) and this path converge at
// the approval keyboard — one approval UX, two upstream sources.

interface PushBlogInput {
  slug: string;
  title: string;
  html: string;
  tags?: string[];
  excerpt?: string;
  hero_image_url?: string;
  hero_image_alt?: string;
  send_newsletter?: boolean;
  source?: 'local' | 'backfill';
}

export async function handlePushBlog(
  request: Request,
  env: Env,
  config: BrandConfig,
): Promise<Response> {
  const provided = request.headers.get('x-webhook-secret') ?? '';
  if (!constantTimeEqual(provided, env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: PushBlogInput;
  try {
    body = (await request.json()) as PushBlogInput;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.slug || !body.title || !body.html) {
    return Response.json(
      { error: 'slug, title, and html are required' },
      { status: 400 },
    );
  }

  // 1. Ghost draft
  const draft = await createGhostDraft(config, body);
  if ('error' in draft) {
    return Response.json({ error: `Ghost: ${draft.error}` }, { status: 502 });
  }

  // 2. Notion row (best-effort: failure here doesn't void the Ghost draft —
  //    we surface the error so the operator can repair manually)
  const notion = await createNotionDraftRow(env, config, body, draft);
  if ('error' in notion) {
    return Response.json(
      {
        error: `Notion row failed (Ghost draft kept): ${notion.error}`,
        ghost_post_id: draft.ghost_post_id,
        ghost_preview_url: draft.ghost_preview_url,
      },
      { status: 502 },
    );
  }

  // 3. Approval KV + Telegram message
  const nonce = crypto.randomUUID();
  await env.AGENT_CONFIG.put(
    `approval:${nonce}`,
    JSON.stringify({
      kind: 'push-blog',
      notion_page_id: notion.notion_page_id,
      ghost_post_id: draft.ghost_post_id,
      ghost_updated_at: draft.ghost_updated_at,
      ghost_preview_url: draft.ghost_preview_url,
      slug: body.slug,
      send_newsletter: body.send_newsletter !== false,
      title: body.title,
      status: 'pending',
      created_at: Date.now(),
    }),
    { expirationTtl: 7 * 24 * 60 * 60 },
  );

  await sendApprovalKeyboard(env, body.title, body.excerpt ?? '', notion.notion_url, draft.ghost_preview_url, nonce);

  return Response.json({
    ok: true,
    ghost_post_id: draft.ghost_post_id,
    ghost_preview_url: draft.ghost_preview_url,
    notion_page_id: notion.notion_page_id,
    notion_url: notion.notion_url,
    approval_nonce: nonce,
  });
}

// Used by handleApprovalCallback when the operator taps ✅ on a push-blog
// approval message. Re-exported so telegram.ts can call it without
// importing internal helpers.
export async function publishGhostDraft(
  config: BrandConfig,
  ghostPostId: string,
  sendNewsletter: boolean,
): Promise<{ canonical_url: string; slug: string } | { error: string }> {
  const [keyId, secret] = config.ghostAdminApiKey.split(':');

  // Refresh updated_at — Ghost requires the latest value as a write-time CAS,
  // and the value cached at draft-creation may be stale if other admin edits
  // happened in between.
  const getToken = await generateGhostToken(keyId, secret);
  const getRes = await fetch(
    `${config.ghostApiUrl}/ghost/api/admin/posts/${ghostPostId}/`,
    { headers: { Authorization: `Ghost ${getToken}` } },
  );
  if (!getRes.ok) {
    return { error: `GET post failed: ${(await getRes.text()).slice(0, 200)}` };
  }
  const getData = (await getRes.json()) as {
    posts: Array<{ updated_at: string }>;
  };
  const updatedAt = getData.posts[0]?.updated_at;
  if (!updatedAt) return { error: 'No updated_at on Ghost post' };

  const publishUrl = new URL(
    `${config.ghostApiUrl}/ghost/api/admin/posts/${ghostPostId}/`,
  );
  if (sendNewsletter) {
    publishUrl.searchParams.set('newsletter', 'default-newsletter');
    publishUrl.searchParams.set('email_segment', 'all');
  }

  const putToken = await generateGhostToken(keyId, secret);
  const putRes = await fetch(publishUrl.toString(), {
    method: 'PUT',
    headers: {
      Authorization: `Ghost ${putToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      posts: [{ status: 'published', updated_at: updatedAt }],
    }),
  });
  if (!putRes.ok) {
    return { error: `PUT publish failed: ${(await putRes.text()).slice(0, 200)}` };
  }
  const putData = (await putRes.json()) as {
    posts: Array<{ slug: string }>;
  };
  const slug = putData.posts[0]?.slug ?? '';
  return {
    canonical_url: `https://askarthur.au/blog/${slug}`,
    slug,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function createGhostDraft(
  config: BrandConfig,
  body: PushBlogInput,
): Promise<
  | { ghost_post_id: string; ghost_updated_at: string; ghost_preview_url: string; ghost_slug: string }
  | { error: string }
> {
  const [keyId, secret] = config.ghostAdminApiKey.split(':');
  const token = await generateGhostToken(keyId, secret);

  const post: Record<string, unknown> = {
    title: body.title,
    slug: body.slug,
    html: body.html,
    status: 'draft',
    tags: (body.tags ?? []).map(name => ({ name })),
  };
  if (body.excerpt) post.custom_excerpt = body.excerpt;
  if (body.hero_image_url) post.feature_image = body.hero_image_url;
  if (body.hero_image_alt) post.feature_image_alt = body.hero_image_alt;

  // The `?source=html` param is required when posting raw HTML — without it,
  // Ghost expects mobiledoc/lexical and silently drops the body.
  const url = new URL(`${config.ghostApiUrl}/ghost/api/admin/posts/`);
  url.searchParams.set('source', 'html');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { Authorization: `Ghost ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ posts: [post] }),
  });
  if (!res.ok) {
    return { error: (await res.text()).slice(0, 300) };
  }
  const data = (await res.json()) as {
    posts: Array<{ id: string; uuid: string; slug: string; updated_at: string; url: string }>;
  };
  const created = data.posts[0];
  // Ghost's draft preview link uses the post UUID; keep `created.url` only as a
  // fallback because that field is empty on freshly-created drafts.
  const previewUrl = `${config.ghostApiUrl}/p/${created.uuid}/`;
  return {
    ghost_post_id: created.id,
    ghost_updated_at: created.updated_at,
    ghost_preview_url: previewUrl,
    ghost_slug: created.slug,
  };
}

async function createNotionDraftRow(
  env: Env,
  config: BrandConfig,
  body: PushBlogInput,
  draft: { ghost_post_id: string; ghost_preview_url: string; ghost_slug: string },
): Promise<{ notion_page_id: string; notion_url: string } | { error: string }> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: body.title } }] },
    Status: { select: { name: 'Draft' } },
    'Ghost Post ID': { rich_text: [{ text: { content: draft.ghost_post_id } }] },
    'Ghost Preview URL': { url: draft.ghost_preview_url },
  };

  // Children: a short summary block plus a link to the Ghost preview. Pushing
  // the full body markdown into Notion blocks is wasteful — the founder reads
  // the styled Ghost draft, not the Notion mirror.
  const children = [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: `Pushed from local markdown (source=${body.source ?? 'local'}). Review the styled draft on Ghost before approving:`,
            },
          },
        ],
      },
    },
    {
      object: 'block',
      type: 'bookmark',
      bookmark: { url: draft.ghost_preview_url },
    },
  ];

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: config.notionBlogDbId },
      properties,
      children,
    }),
  });
  if (!res.ok) {
    return { error: (await res.text()).slice(0, 300) };
  }
  const data = (await res.json()) as { id: string; url: string };
  return { notion_page_id: data.id, notion_url: data.url };
}

async function sendApprovalKeyboard(
  env: Env,
  title: string,
  excerpt: string,
  notionUrl: string,
  ghostPreviewUrl: string,
  nonce: string,
): Promise<void> {
  const allowedIds = env.TELEGRAM_ALLOWED_IDS.split(',').map(s => s.trim()).filter(Boolean);
  if (allowedIds.length === 0) return;
  const chatId = parseInt(allowedIds[0], 10);

  const lines = [
    `<b>📝 ${escapeHtml(title)}</b>`,
    excerpt ? `\n${escapeHtml(excerpt)}\n` : '',
    `<a href="${ghostPreviewUrl}">Preview on Ghost</a> · <a href="${notionUrl}">Notion row</a>`,
    `\n<i>Approve to publish + send newsletter. Reject leaves the draft on Ghost for manual cleanup.</i>`,
  ].filter(Boolean);

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `approve_ok:${nonce}` },
      { text: '❌ Reject', callback_data: `approve_no:${nonce}` },
    ]],
  };

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: keyboard,
    }),
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
