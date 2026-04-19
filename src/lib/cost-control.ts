import type { Env } from './claude';
import { kv } from './claude';
import type { BrandConfig } from '../config/types';

export async function checkBudgetOrAbort(env: Env, config: BrandConfig): Promise<void> {
  const limit = parseFloat(env.BUDGET_LIMIT_USD);
  const month = new Date().toISOString().slice(0, 7);

  const storedMonth = await kv.get(env, 'spend_month');
  if (storedMonth !== month) {
    await kv.put(env, 'spend_month', month);
    await kv.put(env, 'monthly_spend_usd', '0');
    await kv.put(env, 'search_count', '0');
  }

  const spent = parseFloat(await kv.get(env, 'monthly_spend_usd') ?? '0');

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

export async function trackCostFromSession(env: Env, sessionId: string): Promise<void> {
  try {
    const res = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}`, {
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'managed-agents-2026-04-01',
      },
    });
    const session = await res.json() as {
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
      };
    };
    if (!session.usage) return;

    const { input_tokens, output_tokens, cache_read_input_tokens } = session.usage;
    const freshInput = input_tokens - (cache_read_input_tokens ?? 0);
    // Sonnet 4.6 rates as default estimate
    const cost =
      (freshInput * 3 / 1_000_000) +
      ((cache_read_input_tokens ?? 0) * 0.3 / 1_000_000) +
      (output_tokens * 15 / 1_000_000);

    const current = parseFloat(await kv.get(env, 'monthly_spend_usd') ?? '0');
    await kv.put(env, 'monthly_spend_usd', (current + cost).toFixed(6));
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
