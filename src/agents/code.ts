import type { Env } from '../lib/claude';
import type { BrandConfig } from '../config/types';
import { runAgentSession } from '../lib/session-runner';

export async function runCodeAgent(
  env: Env,
  config: BrandConfig,
  description: string,
): Promise<void> {
  await runAgentSession(env, config, 'code', `Feature: ${description.slice(0, 60)}`,
    `A user has requested the following feature for the ${env.GH_REPO} repo:\n\n` +
    `"${description}"\n\n` +
    `Implement this as a GitHub pull request following the workflow in your system prompt. ` +
    `Start by listing the root directory to understand the project structure, then read relevant files, ` +
    `then make minimal focused changes. Always create a branch, commit to it, and open a PR. ` +
    `After opening the PR, call notify_founder with the PR URL so the founder knows it's ready.`);
}
