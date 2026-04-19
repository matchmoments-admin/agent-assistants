import type { Env } from '../lib/claude';
import type { BrandConfig } from '../config/types';
import { runAgentSession } from '../lib/session-runner';

export async function runIRAgent(
  env: Env,
  config: BrandConfig,
  task: string,
): Promise<void> {
  switch (task) {
    case 'investor-update':
      await runAgentSession(env, config, 'ir', `Monthly Investor Update — ${config.productName}`,
        `Draft the monthly investor update for ${config.productName}. ` +
        `Load the ${config.skillName} skill — the B2B_TARGETS.md file contains ` +
        `investor targets and enterprise value propositions. ` +
        `Research recent news about the target investors listed there.\n\n` +
        `Draft an update covering: key metrics (or pre-launch milestones), ` +
        `product progress, market context (Australian scam landscape), ` +
        `B2B pipeline status, one risk with mitigation, and the ask. ` +
        `Also draft 1-2 personalized outreach emails for the highest-priority ` +
        `investors based on recent portfolio activity. ` +
        `Save everything to the investor database in Notion, then email the founder.`);
      break;
  }
}
