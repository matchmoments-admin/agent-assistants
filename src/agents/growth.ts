import type { Env } from '../lib/claude';
import type { BrandConfig } from '../config/types';
import { runAgentSession } from '../lib/session-runner';

export async function runGrowthAgent(
  env: Env,
  config: BrandConfig,
  task: string,
): Promise<void> {
  switch (task) {
    case 'competitor-scan':
      await runAgentSession(env, config, 'growth', `Competitor Scan — ${config.productName}`,
        `Perform the daily competitor scan for ${config.productName}. ` +
        `Check each competitor site for changes:\n` +
        config.competitors.map(c => `- ${c}`).join('\n') + '\n\n' +
        `For each, note: new content, feature changes, pricing changes, ` +
        `new partnerships or announcements. Compare against previous scan data ` +
        `in your memory. Rate significance: Low/Medium/High. ` +
        `Save summary to the competitor database in Notion. ` +
        `Only email the founder if something is rated High significance.`);
      break;
  }
}
