export interface BrandConfig {
  // Identity
  productId: string;
  productName: string;
  productUrl: string;
  productDescription: string;
  founderName: string;
  founderEmail: string;
  founderLinkedIn: string;

  // Ghost CMS (injected from env at runtime)
  ghostApiUrl: string;
  ghostAdminApiKey: string;

  // Notion databases (injected from env at runtime)
  notionBlogDbId: string;
  notionSocialDbId: string;
  notionInvestorDbId: string;
  notionCompetitorDbId: string;
  notionDigestsDbId: string;

  // Audience
  primaryAudience: string;
  b2bAudience: string[];
  geographicFocus: string;

  // Channels
  twitterHandle: string;
  linkedinCompanyId: string;
  newsletterName: string;

  // Competitors
  competitors: string[];

  // Skill (brand context loaded on demand)
  skillName: string;
}
