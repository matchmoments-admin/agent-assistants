import type { Env } from './claude';
import { kv, anthropicBaseUrl } from './claude';
import type { BrandConfig } from '../config/types';

function budgetStub(env: Env) {
  // Product-scoped so dev and prod never share the same DO instance.
  const id = env.BUDGET.idFromName(`${env.PRODUCT_ID}-budget`);
  return env.BUDGET.get(id) as DurableObjectStub & {
    recordSpend(usd: number, agentId?: string, sessionId?: string): Promise<number>;
    getMonthSpend(): Promise<number>;
  };
}

export async function checkBudgetOrAbort(env: Env, config: BrandConfig): Promise<void> {
  const limit = parseFloat(env.BUDGET_LIMIT_USD);
  // Reset web-search counter at month boundary (still KV — read-mostly).
  const month = new Date().toISOString().slice(0, 7);
  const storedMonth = await kv.get(env, 'spend_month');
  if (storedMonth !== month) {
    await kv.put(env, 'spend_month', month);
    await kv.put(env, 'search_count', '0');
  }

  // Authoritative spend read: BudgetDO. KV is a stale cache used by /status only.
  const spent = await budgetStub(env).getMonthSpend();

  if (spent >= limit) {
    await sendBudgetAlert(env, config,
      `HARD STOP: $${spent.toFixed(2)} spent vs $${limit} budget. All agents paused.`);
    throw new Error('Monthly budget exceeded — agent run aborted');
  }

  if (spent >= limit * 0.8) {
    await sendBudgetAlert(env, config,
      `Budget at ${Math.round(spent / limit * 100)}%: $${spent.toFixed(2)} of $${limit}`);
  }
}

export async function trackCostFromSession(env: Env, sessionId: string, agentId?: string): Promise<void> {
  try {
    const res = await fetch(`${anthropicBaseUrl(env)}/v1/sessions/${sessionId}`, {
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'managed-agents-2026-04-01',
      },
    });
    if (!res.ok) {
      const rid = res.headers.get('request-id') ?? 'unknown';
      console.warn(`trackCostFromSession: status=${res.status} req=${rid}`);
      return;
    }
    const session = await res.json() as {
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    if (!session.usage) return;

    const { input_tokens, output_tokens } = session.usage;
    const cacheWrite = session.usage.cache_creation_input_tokens ?? 0;
    const cacheRead = session.usage.cache_read_input_tokens ?? 0;
    const freshInput = input_tokens - cacheWrite - cacheRead;
    // Sonnet 4.6 rates: base $3/M, cache write $3.75/M, cache read $0.30/M, output $15/M
    const cost =
      (freshInput * 3 / 1_000_000) +
      (cacheWrite * 3.75 / 1_000_000) +
      (cacheRead * 0.3 / 1_000_000) +
      (output_tokens * 15 / 1_000_000);

    await budgetStub(env).recordSpend(cost, agentId, sessionId);
  } catch {
    // non-critical — don't block agent runs
  }
}

async function sendBudgetAlert(env: Env, config: BrandConfig, message: string): Promise<void> {
  const form = new URLSearchParams();
  form.set('from', `${config.productName} Agents <agents@${env.MAILGUN_DOMAIN}>`);
  form.set('to', config.founderEmail);
  form.set('subject', `Agent Fleet Budget Alert — ${config.productName}`);
  form.set('text', message);

  await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}`,
    },
    body: form,
  });
}
