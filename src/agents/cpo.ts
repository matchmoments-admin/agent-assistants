import type { Env } from '../lib/claude';
import type { BrandConfig } from '../config/types';
import { runAgentSession } from '../lib/session-runner';

export async function runCPOAgent(
  env: Env,
  config: BrandConfig,
  task: string,
): Promise<void> {
  switch (task) {
    case 'weekly-digest':
      await runAgentSession(env, config, 'cpo', `Weekly Digest — ${config.productName}`,
        `Produce the weekly product digest for ${config.productName}. ` +
        `Search for any recent support emails, app store reviews, or user feedback ` +
        `from the past 7 days. Summarize into: top 3 themes, biggest pain point ` +
        `(with a direct quote if possible), top feature request, any churn signals, ` +
        `and one recommended action. ` +
        `Save the digest to the digest database in Notion, then email the founder.`);
      break;
  }
}
