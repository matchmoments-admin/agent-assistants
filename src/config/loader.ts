import { BrandConfig } from './types';
import { askarthurConfig } from './askarthur';
import type { Env } from '../lib/claude';

const CONFIG_MAP: Record<string, BrandConfig> = {
  askarthur: askarthurConfig,
};

export function loadBrandConfig(env: Env): BrandConfig {
  const base = CONFIG_MAP[env.PRODUCT_ID];
  if (!base) throw new Error(`No config found for PRODUCT_ID: ${env.PRODUCT_ID}`);

  return {
    ...base,
    ghostApiUrl: env.GHOST_API_URL,
    ghostAdminApiKey: env.GHOST_ADMIN_API_KEY,
    notionBlogDbId: env.NOTION_DB_BLOG,
    notionSocialDbId: env.NOTION_DB_SOCIAL,
    notionInvestorDbId: env.NOTION_DB_INVESTOR,
    notionCompetitorDbId: env.NOTION_DB_COMPETITOR,
    notionDigestsDbId: env.NOTION_DB_DIGESTS,
  };
}
