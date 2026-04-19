import { BrandConfig } from './types';

export const askarthurConfig: BrandConfig = {
  productId: 'askarthur',
  productName: 'AskArthur',
  productUrl: 'https://askarthur.au',
  productDescription: 'AI-powered scam prevention assistant for Australian consumers. Identifies scams in real time across SMS, email, phone calls, and websites. Also sells B2B intelligence dashboards to banks, telcos, and government.',
  founderName: 'Brendan Milton',
  founderEmail: 'brendan.milton1211@gmail.com',
  founderLinkedIn: 'https://linkedin.com/in/REPLACE_ME',

  // Injected from env at runtime
  ghostApiUrl: '',
  ghostAdminApiKey: '',
  notionBlogDbId: '',
  notionSocialDbId: '',
  notionInvestorDbId: '',
  notionCompetitorDbId: '',
  notionDigestsDbId: '',

  primaryAudience: 'Australian consumers aged 35-70, particularly retirees at higher risk of scams',
  b2bAudience: [
    'Australian banks: CBA, Westpac, NAB, ANZ, Macquarie',
    'Telcos: Telstra, Optus, Vodafone',
    'Government: ACCC, Services Australia, AFP, ASIC',
    'Insurers and superannuation funds',
  ],
  geographicFocus: 'Australia',
  twitterHandle: '@AskArthurAU',
  linkedinCompanyId: 'REPLACE_WITH_LINKEDIN_ORG_ID',
  newsletterName: 'The AskArthur Scam Alert',
  competitors: [
    'https://www.scamwatch.gov.au',
    'https://www.idcare.org',
    'https://www.cyber.gov.au/report-and-recover/report',
  ],
  skillName: 'askarthur-brand',
};
