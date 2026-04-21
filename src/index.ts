import { AgentMemory } from './memory';
import type { Env, AgentTaskMessage } from './lib/claude';
import { loadBrandConfig } from './config/loader';
import { checkBudgetOrAbort } from './lib/cost-control';
import { bootstrap, updateAllAgents } from './bootstrap';
import { runCPOAgent } from './agents/cpo';
import { runCMOAgent } from './agents/cmo';
import { runGrowthAgent } from './agents/growth';
import { runIRAgent } from './agents/investor-relations';
import { runCodeAgent } from './agents/code';
import { handleTelegramWebhook, sendTelegram } from './lib/telegram';

export { AgentMemory };

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const config = loadBrandConfig(env);

    ctx.waitUntil((async () => {
      try {
        await checkBudgetOrAbort(env, config);

        switch (event.cron) {
          case '0 21 * * SUN':
            await runCMOAgent(env, config, 'blog-draft');
            break;
          case '0 0 * * MON':
            await runCPOAgent(env, config, 'weekly-digest');
            break;
          case '0 1 * * TUE':
            await runCMOAgent(env, config, 'linkedin-post');
            break;
          case '0 0 * * *':
            await runGrowthAgent(env, config, 'competitor-scan');
            await runCMOAgent(env, config, 'publish-approved');
            break;
          case '0 22 1 * *':
            await runIRAgent(env, config, 'investor-update');
            break;
        }
      } catch (err) {
        console.error(`[${env.PRODUCT_ID}] Cron ${event.cron} failed:`, err);
      }
    })());
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/setup' && request.method === 'POST') {
      try {
        const results = await bootstrap(env);
        return Response.json(results, { status: 200 });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'Bootstrap failed' },
          { status: 500 },
        );
      }
    }

    if (url.pathname === '/update-agents' && request.method === 'POST') {
      try {
        const result = await updateAllAgents(env);
        return Response.json(result, { status: 200 });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'Update failed' },
          { status: 500 },
        );
      }
    }

    if (url.pathname === '/trigger' && request.method === 'POST') {
      try {
        const { agent, task } = await request.json() as { agent: string; task: string };
        const config = loadBrandConfig(env);
        await checkBudgetOrAbort(env, config);

        switch (agent) {
          case 'cmo':
            await runCMOAgent(env, config, task);
            break;
          case 'cpo':
            await runCPOAgent(env, config, task);
            break;
          case 'growth':
            await runGrowthAgent(env, config, task);
            break;
          case 'ir':
            await runIRAgent(env, config, task);
            break;
          case 'code':
            await runCodeAgent(env, config, task);
            break;
          default:
            return Response.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
        }
        return Response.json({ status: 'triggered', agent, task });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'Trigger failed' },
          { status: 500 },
        );
      }
    }

    if (url.pathname === '/illustrate/start' && request.method === 'POST') {
      const secret = request.headers.get('X-Illustrate-Secret') ?? '';
      if (!env.ILLUSTRATE_SECRET || secret !== env.ILLUSTRATE_SECRET) {
        return new Response('Unauthorized', { status: 403 });
      }
      const body = await request.json() as {
        nonce: string; slug: string; imageUrl: string; caption?: string;
      };
      if (!body.nonce || !body.slug || !body.imageUrl) {
        return Response.json({ error: 'nonce, slug, imageUrl required' }, { status: 400 });
      }
      const chatId = parseInt(env.TELEGRAM_ALLOWED_IDS.split(',')[0].trim(), 10);
      await env.AGENT_CONFIG.put(
        `illustrate:${body.nonce}`,
        JSON.stringify({ status: 'pending', slug: body.slug, createdAt: Date.now() }),
        { expirationTtl: 900 },
      );
      const kbd = {
        inline_keyboard: [[
          { text: '\u2705 Approve', callback_data: `illustrate_ok:${body.nonce}` },
          { text: '\u274C Reject', callback_data: `illustrate_no:${body.nonce}` },
          { text: '\uD83D\uDD04 Regen', callback_data: `illustrate_regen:${body.nonce}` },
        ]],
      };
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: body.imageUrl,
          caption: body.caption ?? `Illustration: ${body.slug}`,
          reply_markup: kbd,
        }),
      });
      if (!res.ok) return Response.json({ error: `Telegram: ${await res.text()}` }, { status: 502 });
      return Response.json({ ok: true, nonce: body.nonce });
    }

    if (url.pathname === '/illustrate/poll' && request.method === 'GET') {
      const secret = request.headers.get('X-Illustrate-Secret') ?? '';
      if (!env.ILLUSTRATE_SECRET || secret !== env.ILLUSTRATE_SECRET) {
        return new Response('Unauthorized', { status: 403 });
      }
      const nonce = url.searchParams.get('nonce');
      if (!nonce) return Response.json({ error: 'nonce required' }, { status: 400 });
      const raw = await env.AGENT_CONFIG.get(`illustrate:${nonce}`);
      if (!raw) return Response.json({ status: 'expired' });
      const data = JSON.parse(raw) as { status: string };
      return Response.json({ status: data.status });
    }

    if (url.pathname === '/telegram' && request.method === 'POST') {
      const config = loadBrandConfig(env);
      return handleTelegramWebhook(request, env, config, ctx);
    }

    if (url.pathname === '/status') {
      const spend = await env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:monthly_spend_usd`) ?? '0';
      const searches = await env.AGENT_CONFIG.get(`${env.PRODUCT_ID}:search_count`) ?? '0';
      return Response.json({
        product: env.PRODUCT_ID,
        month: new Date().toISOString().slice(0, 7),
        spentUSD: parseFloat(spend).toFixed(4),
        budgetUSD: env.BUDGET_LIMIT_USD,
        webSearches: searches,
        searchCap: env.WEB_SEARCH_CAP,
      });
    }

    return new Response(`${env.PRODUCT_ID} agent fleet — operational`, { status: 200 });
  },

  async queue(batch: MessageBatch<AgentTaskMessage>, env: Env): Promise<void> {
    const config = loadBrandConfig(env);
    for (const msg of batch.messages) {
      const m = msg.body;
      const label = m.kind === 'agent-command' ? `${m.agent}/${m.task}` : m.kind;
      console.log(`queue.start kind=${m.kind} label=${label} chat=${m.chatId}`);
      try {
        await checkBudgetOrAbort(env, config);
        if (m.kind === 'agent-command' && m.agent && m.task) {
          switch (m.agent) {
            case 'cmo': await runCMOAgent(env, config, m.task); break;
            case 'cpo': await runCPOAgent(env, config, m.task); break;
            case 'growth': await runGrowthAgent(env, config, m.task); break;
            case 'ir': await runIRAgent(env, config, m.task); break;
          }
          await sendTelegram(env, m.chatId, 'Done. Check Notion for results.');
        } else if (m.kind === 'feature' && m.description) {
          await runCodeAgent(env, config, m.description);
          // Code agent calls notify_founder itself with the PR URL
        }
        console.log(`queue.done label=${label}`);
        msg.ack();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        const sessionId = (err as { sessionId?: string })?.sessionId;
        const telegramMsg = sessionId
          ? `Error in ${label} (session ${sessionId}): ${errMsg}`
          : `Error in ${label}: ${errMsg}`;
        console.error(`queue.fail label=${label} session=${sessionId ?? 'n/a'} err=${errMsg}`);
        await sendTelegram(env, m.chatId, telegramMsg).catch(() => {});
        msg.ack(); // don't retry on logical errors; budget / schema issues will repro
      }
    }
  },
};
