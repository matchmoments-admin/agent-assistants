import type { Env } from './claude';
import type { BrandConfig } from '../config/types';
import { checkBudgetOrAbort } from './cost-control';
import { runCMOAgent } from '../agents/cmo';
import { runCPOAgent } from '../agents/cpo';
import { runGrowthAgent } from '../agents/growth';
import { runIRAgent } from '../agents/investor-relations';
import { runCodeAgent } from '../agents/code';

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const AGENT_COMMANDS: Record<string, { agent: string; task: string; description: string }> = {
  '/blog': { agent: 'cmo', task: 'blog-draft', description: 'Draft a new blog post' },
  '/tweet': { agent: 'cmo', task: 'twitter-post', description: 'Draft a Twitter post' },
  '/linkedin': { agent: 'cmo', task: 'linkedin-post', description: 'Draft a LinkedIn post' },
  '/publish': { agent: 'cmo', task: 'publish-approved', description: 'Publish approved posts to Ghost' },
  '/digest': { agent: 'cpo', task: 'weekly-digest', description: 'Run weekly product digest' },
  '/scan': { agent: 'growth', task: 'competitor-scan', description: 'Run competitor scan' },
  '/investor': { agent: 'ir', task: 'investor-update', description: 'Draft investor update' },
};

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  config: BrandConfig,
  ctx: ExecutionContext,
): Promise<Response> {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!constantTimeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 403 });
  }

  const update = await request.json() as TelegramUpdate;

  // Dedup Telegram webhook retries — update_id is unique per update and Telegram
  // retries for up to 24h on any 5xx. KV TTL matches that window.
  if (update.update_id != null) {
    const dedupeKey = `tg_update:${update.update_id}`;
    const seen = await env.AGENT_CONFIG.get(dedupeKey);
    if (seen) return new Response('OK', { status: 200 });
    await env.AGENT_CONFIG.put(dedupeKey, '1', { expirationTtl: 86400 });
  }

  // Handle callback queries (inline keyboard button presses)
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query, env, config, ctx);
  }

  const message = update.message;
  if (!message?.text || !message.from) {
    return new Response('OK', { status: 200 });
  }

  if (!isAllowed(env, message.from.id)) {
    await sendTelegram(env, message.chat.id, 'Unauthorized user.');
    return new Response('OK', { status: 200 });
  }

  const text = message.text.trim();
  const [commandRaw, ...args] = text.split(' ');
  const command = commandRaw.split('@')[0];

  // ── Deploy commands ─────────────────────────────────────────────────

  if (command === '/deploy') {
    // Check killswitch
    const killswitch = await env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:flag:killswitch`);
    if (killswitch === 'on') {
      await sendTelegram(env, message.chat.id, 'Deploys are disabled (killswitch is on).');
      return new Response('OK', { status: 200 });
    }

    const branch = args[0] || 'main';
    const nonce = crypto.randomUUID();
    await env.AGENT_CONFIG.put(
      `deploy:${nonce}`,
      JSON.stringify({ branch, userId: message.from.id, timestamp: Date.now() }),
      { expirationTtl: 300 },
    );

    await sendTelegramWithKeyboard(env, message.chat.id,
      `Deploy <b>${branch}</b> → production?`,
      [[
        { text: '\u2705 Confirm', callback_data: `deploy_ok:${nonce}` },
        { text: '\u274C Cancel', callback_data: `deploy_no:${nonce}` },
      ]],
    );
    return new Response('OK', { status: 200 });
  }

  if (command === '/rollback') {
    if (!env.DEPLOY_HOOK_URL) {
      await sendTelegram(env, message.chat.id, 'No DEPLOY_HOOK_URL configured.');
      return new Response('OK', { status: 200 });
    }

    const nonce = crypto.randomUUID();
    await env.AGENT_CONFIG.put(
      `deploy:${nonce}`,
      JSON.stringify({ action: 'rollback', userId: message.from.id, timestamp: Date.now() }),
      { expirationTtl: 300 },
    );

    await sendTelegramWithKeyboard(env, message.chat.id,
      'Rollback production to previous deployment?',
      [[
        { text: '\u2705 Confirm Rollback', callback_data: `rollback_ok:${nonce}` },
        { text: '\u274C Cancel', callback_data: `deploy_no:${nonce}` },
      ]],
    );
    return new Response('OK', { status: 200 });
  }

  if (command === '/feature') {
    const description = args.join(' ').trim();
    if (!description) {
      await sendTelegram(env, message.chat.id,
        'Usage: /feature &lt;description&gt;\n\nExample:\n/feature add a dark mode toggle to the header');
      return new Response('OK', { status: 200 });
    }

    const nonce = crypto.randomUUID();
    await env.AGENT_CONFIG.put(
      `feature:${nonce}`,
      JSON.stringify({ description, userId: message.from.id, timestamp: Date.now() }),
      { expirationTtl: 300 },
    );

    await sendTelegramWithKeyboard(env, message.chat.id,
      `Run code agent on:\n\n<i>${description}</i>\n\nThis will open a PR in ${env.GH_REPO}.`,
      [[
        { text: '\u2705 Run', callback_data: `feature_ok:${nonce}` },
        { text: '\u274C Cancel', callback_data: `deploy_no:${nonce}` },
      ]],
    );
    return new Response('OK', { status: 200 });
  }

  if (command === '/flag') {
    const key = args[0];
    const value = args[1];

    if (!key) {
      // List all flags
      const flags = await env.AGENT_CONFIG.list({ prefix: `${env.PRODUCT_ID}:flag:` });
      if (flags.keys.length === 0) {
        await sendTelegram(env, message.chat.id, 'No flags set.');
      } else {
        const lines: string[] = [];
        for (const k of flags.keys) {
          const val = await env.AGENT_CONFIG.get(k.name);
          const shortName = k.name.replace(`${env.PRODUCT_ID}:flag:`, '');
          lines.push(`<b>${shortName}</b> = ${val}`);
        }
        await sendTelegram(env, message.chat.id, `Feature flags:\n${lines.join('\n')}`);
      }
      return new Response('OK', { status: 200 });
    }

    if (!value) {
      // Read single flag
      const val = await env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:flag:${key}`);
      await sendTelegram(env, message.chat.id,
        val ? `<b>${key}</b> = ${val}` : `Flag <b>${key}</b> is not set.`);
      return new Response('OK', { status: 200 });
    }

    // Set flag
    await env.AGENT_CONFIG.put(`${env.PRODUCT_ID}:flag:${key}`, value);
    await sendTelegram(env, message.chat.id, `Flag <b>${key}</b> set to <b>${value}</b>.`);
    return new Response('OK', { status: 200 });
  }

  if (command === '/deploylog') {
    const logs = await env.AGENT_CONFIG.list({ prefix: `${env.PRODUCT_ID}:deploy_log:` });
    if (logs.keys.length === 0) {
      await sendTelegram(env, message.chat.id, 'No deploy history.');
      return new Response('OK', { status: 200 });
    }

    // Get last 5 (keys are sorted by name, which includes timestamp)
    const recentKeys = logs.keys.slice(-5).reverse();
    const lines: string[] = [];
    for (const k of recentKeys) {
      const raw = await env.AGENT_CONFIG.get(k.name);
      if (!raw) continue;
      const entry = JSON.parse(raw) as { branch?: string; action: string; result: string; timestamp: number };
      const date = new Date(entry.timestamp).toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`${date} — ${entry.action} ${entry.branch ?? ''} → ${entry.result}`);
    }
    await sendTelegram(env, message.chat.id, `Recent deploys:\n\n${lines.join('\n')}`);
    return new Response('OK', { status: 200 });
  }

  // ── Status ──────────────────────────────────────────────────────────

  if (command === '/status') {
    const spend = await env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:monthly_spend_usd`) ?? '0';
    const searches = await env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:search_count`) ?? '0';
    const killswitch = await env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:flag:killswitch`);
    await sendTelegram(env, message.chat.id,
      `<b>${config.productName} Agent Fleet</b>\n` +
      `Month: ${new Date().toISOString().slice(0, 7)}\n` +
      `Spent: $${parseFloat(spend).toFixed(4)} / $${env.BUDGET_LIMIT_USD}\n` +
      `Web searches: ${searches} / ${env.WEB_SEARCH_CAP}\n` +
      `Deploy killswitch: ${killswitch === 'on' ? 'ON' : 'off'}`);
    return new Response('OK', { status: 200 });
  }

  // ── Help ─────────────────────────────────────────────────────────────

  if (command === '/help' || command === '/start') {
    const agentHelp = Object.entries(AGENT_COMMANDS)
      .map(([cmd, info]) => `${cmd} — ${info.description}`)
      .join('\n');
    await sendTelegram(env, message.chat.id,
      `<b>Agent commands:</b>\n${agentHelp}\n\n` +
      `<b>Deploy commands:</b>\n` +
      `/feature &lt;description&gt; — Code agent opens a PR for a new feature\n` +
      `/deploy [branch] — Deploy to production\n` +
      `/rollback — Rollback to previous deploy\n` +
      `/flag [key] [value] — Get/set feature flags\n` +
      `/deploylog — Show recent deploys\n\n` +
      `/status — Check spend + status\n` +
      `/help — This message`);
    return new Response('OK', { status: 200 });
  }

  // ── Agent commands ──────────────────────────────────────────────────

  const cmd = AGENT_COMMANDS[command];
  if (cmd) {
    await sendTelegram(env, message.chat.id, `Running ${cmd.agent}/${cmd.task}...`);
    // Queue the agent run so it executes in a separate invocation untied to
    // Telegram's 60s webhook timeout. Queue consumer in index.ts picks it up.
    await env.AGENT_TASKS.send({
      kind: 'agent-command',
      chatId: message.chat.id,
      userId: message.from.id,
      agent: cmd.agent as 'cmo' | 'cpo' | 'growth' | 'ir',
      task: cmd.task,
    });
    return new Response('OK', { status: 200 });
  }

  await sendTelegram(env, message.chat.id, 'Unknown command. Type /help for options.');
  return new Response('OK', { status: 200 });
}

// ── Callback query handler (inline keyboard buttons) ──────────────────

async function handleCallbackQuery(
  query: NonNullable<TelegramUpdate['callback_query']>,
  env: Env,
  config: BrandConfig,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!query.data || !query.message) {
    return new Response('OK', { status: 200 });
  }

  if (!isAllowed(env, query.from.id)) {
    await answerCallback(env, query.id, 'Unauthorized.');
    return new Response('OK', { status: 200 });
  }

  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const [action, nonce] = query.data.split(':');

  // Validate nonce — check both deploy: and feature: prefixes
  let raw = await env.AGENT_CONFIG.get(`deploy:${nonce}`);
  let nonceKey = `deploy:${nonce}`;
  if (!raw) {
    raw = await env.AGENT_CONFIG.get(`feature:${nonce}`);
    nonceKey = `feature:${nonce}`;
  }
  if (!raw) {
    await answerCallback(env, query.id, 'Expired.');
    await editMessage(env, chatId, messageId, '\u23F1 Session expired.');
    return new Response('OK', { status: 200 });
  }

  // One-shot: delete nonce immediately
  await env.AGENT_CONFIG.delete(nonceKey);
  const data = JSON.parse(raw) as { branch?: string; action?: string; description?: string; userId: number; timestamp: number };

  // Cancel
  if (action === 'deploy_no') {
    await answerCallback(env, query.id, 'Cancelled.');
    await editMessage(env, chatId, messageId, '\u274C Cancelled.');
    return new Response('OK', { status: 200 });
  }

  // Confirm feature — run code agent
  if (action === 'feature_ok') {
    const description = data.description ?? '';
    await answerCallback(env, query.id, 'Running code agent...');
    await editMessage(env, chatId, messageId,
      `\uD83E\uDD16 Code agent working on:\n<i>${description}</i>\n\nThis may take 1-3 minutes. The agent will message you when the PR is ready.`);

    await env.AGENT_TASKS.send({
      kind: 'feature',
      chatId,
      userId: query.from.id,
      description,
    });
    return new Response('OK', { status: 200 });
  }

  // Confirm deploy
  if (action === 'deploy_ok') {
    const branch = data.branch ?? 'main';
    await answerCallback(env, query.id, 'Deploying...');
    await editMessage(env, chatId, messageId, `\uD83D\uDE80 Deploying <b>${branch}</b>...`);

    try {
      const res = await fetch(
        `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/deploy.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.GITHUB_PAT}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'askarthur-deploy-bot',
          },
          body: JSON.stringify({ ref: branch, inputs: { triggered_by: 'telegram' } }),
        },
      );

      if (res.status === 204) {
        await editMessage(env, chatId, messageId,
          `\u2705 Deploy triggered: <b>${branch}</b>\nCheck GitHub Actions for progress.`);
        await logDeploy(env, { action: 'deploy', branch, result: 'triggered' });
      } else {
        const errBody = await res.text();
        await editMessage(env, chatId, messageId,
          `\u274C Deploy failed (${res.status}): ${errBody.slice(0, 200)}`);
        await logDeploy(env, { action: 'deploy', branch, result: `error:${res.status}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await editMessage(env, chatId, messageId, `\u274C Deploy error: ${errMsg}`);
      await logDeploy(env, { action: 'deploy', branch, result: `exception:${errMsg}` });
    }
    return new Response('OK', { status: 200 });
  }

  // Confirm rollback
  if (action === 'rollback_ok') {
    await answerCallback(env, query.id, 'Rolling back...');
    await editMessage(env, chatId, messageId, '\u23EA Rolling back...');

    try {
      const res = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
      if (res.ok) {
        await editMessage(env, chatId, messageId, '\u2705 Rollback triggered.');
        await logDeploy(env, { action: 'rollback', result: 'triggered' });
      } else {
        await editMessage(env, chatId, messageId, `\u274C Rollback failed (${res.status}).`);
        await logDeploy(env, { action: 'rollback', result: `error:${res.status}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await editMessage(env, chatId, messageId, `\u274C Rollback error: ${errMsg}`);
    }
    return new Response('OK', { status: 200 });
  }

  return new Response('OK', { status: 200 });
}

// ── Helpers ───────────────────────────────────────────────────────────

function isAllowed(env: Env, userId: number): boolean {
  return env.TELEGRAM_ALLOWED_IDS.split(',').map(id => parseInt(id.trim(), 10)).includes(userId);
}

export async function sendTelegram(env: Env, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

async function sendTelegramWithKeyboard(
  env: Env,
  chatId: number,
  text: string,
  keyboard: Array<Array<{ text: string; callback_data: string }>>,
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

async function editMessage(env: Env, chatId: number, messageId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }),
  });
}

async function answerCallback(env: Env, callbackId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

async function logDeploy(
  env: Env,
  entry: { action: string; branch?: string; result: string },
): Promise<void> {
  const key = `${env.PRODUCT_ID}:deploy_log:${Date.now()}`;
  await env.AGENT_CONFIG.put(key, JSON.stringify({ ...entry, timestamp: Date.now() }), {
    expirationTtl: 60 * 60 * 24 * 30, // 30 days
  });
}
