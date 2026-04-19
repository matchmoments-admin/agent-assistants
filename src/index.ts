import { AgentMemory } from './memory';
import type { Env } from './lib/claude';
import { loadBrandConfig } from './config/loader';
import { checkBudgetOrAbort } from './lib/cost-control';
import { bootstrap } from './bootstrap';
import { runCPOAgent } from './agents/cpo';
import { runCMOAgent } from './agents/cmo';
import { runGrowthAgent } from './agents/growth';
import { runIRAgent } from './agents/investor-relations';
import { runCodeAgent } from './agents/code';
import { handleTelegramWebhook } from './lib/telegram';

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

  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (url.pathname === '/telegram' && request.method === 'POST') {
      const config = loadBrandConfig(env);
      return handleTelegramWebhook(request, env, config);
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
};
