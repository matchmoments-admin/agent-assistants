import type { Env } from '../lib/claude';
import type { BrandConfig } from '../config/types';
import { runAgentSession } from '../lib/session-runner';
import { queryNotionByStatus } from '../lib/tools';

export async function runCMOAgent(
  env: Env,
  config: BrandConfig,
  task: string,
): Promise<void> {
  switch (task) {
    case 'blog-draft':
      await runAgentSession(env, config, 'cmo', `Blog Draft — ${config.productName}`,
        `Write a new blog post for ${config.productName}. ` +
        `Search for the latest Australian scam news from the past week. ` +
        `Write a 1,200-2,000 word SEO-optimized blog post with H2/H3 headings and an FAQ section. ` +
        `Save it to the blog database in Notion as a Draft, then email the founder for review.`);
      break;

    case 'twitter-post':
      await runAgentSession(env, config, 'publisher', `Twitter Post — ${config.productName}`,
        `Draft a tweet for ${config.twitterHandle}. ` +
        `Check Scamwatch (scamwatch.gov.au) for any active scam alerts. ` +
        `Write a concise, helpful tweet (max 280 chars) with a practical tip or warning. ` +
        `Save to the social database in Notion, then request_telegram_approval.`);
      break;

    case 'linkedin-post':
      await runAgentSession(env, config, 'cmo', `LinkedIn Post — ${config.productName}`,
        `Draft a LinkedIn post for ${config.productName}'s company page. ` +
        `Target audience: B2B decision-makers at ${config.b2bAudience[0]}. ` +
        `Load the ${config.skillName} skill for B2B targeting details. ` +
        `Format: data-driven hook, problem statement, ${config.productName} angle, CTA. ` +
        `Professional tone, 200-500 words. Include relevant hashtags. ` +
        `Save to the social database in Notion, then email the founder for approval.`);
      break;

    case 'publish-approved':
      await publishApprovedPosts(env, config);
      break;
  }
}

async function publishApprovedPosts(env: Env, config: BrandConfig): Promise<void> {
  const approved = await queryNotionByStatus(env, config.notionBlogDbId, 'Approved');

  if (approved.length === 0) {
    console.log('[cmo] No approved posts to publish');
    return;
  }

  for (const post of approved) {
    await runAgentSession(env, config, 'publisher', `Publish: ${post.title}`,
      `There is an approved blog post in Notion (page ID: ${post.id}, title: "${post.title}"). ` +
      `Fetch the full content from Notion, convert it to clean HTML, then publish it to Ghost ` +
      `using the publish_to_ghost tool. Enable newsletter delivery so subscribers are emailed. ` +
      `After publishing, the Notion status will be updated to Published automatically.`);
  }
}
