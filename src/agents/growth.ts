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
        `Run the competitor scan for ${config.productName}. ` +
        `Check each competitor site for changes:\n` +
        config.competitors.map(c => `- ${c}`).join('\n') + '\n\n' +
        `Compare against previous scan data in your memory. Save the result to ` +
        `the competitor database in Notion using the exact document template in ` +
        `your system prompt — including the "Feature suggestions" section ` +
        `(Additions / Updates / Retirements) at the bottom, with each suggestion ` +
        `tied to a specific signal from "Changes observed". ` +
        `Only email the founder if overall significance is High.`);
      break;
  }
}
