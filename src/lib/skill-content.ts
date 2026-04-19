// Skill file contents bundled for Workers (no filesystem access at runtime)
// These mirror the files in skills/askarthur/

export const ASKARTHUR_SKILL_MD = `---
name: askarthur-brand
description: Brand context, voice, content topics, SEO keywords, and publishing rules
  for AskArthur (askarthur.au). Load this skill whenever working on any AskArthur
  content, social posts, blog articles, emails, or outreach.
---

# AskArthur Brand Context

## Product
AskArthur is an AI-powered scam prevention assistant for Australian consumers.
It identifies scams in real time across SMS, email, phone calls, and websites.
AskArthur also sells aggregated scam intelligence dashboards to Australian banks,
telcos, and government agencies as a B2B product.

## Primary audience
Australian consumers aged 35\u201370. Particularly retirees and people less familiar
with digital fraud. Higher risk of being scammed than average.

## Brand voice
Warm, protective, and plainspoken. Never alarmist. Empowering \u2014 give people
confidence, not anxiety. Clear Australian English. No jargon.
Think: trusted friend who knows about scams.
For B2B LinkedIn content only: shift to professional and evidence-based, lead with data.

## Never use these phrases
game-changer, leverage, synergy, revolutionary, seamless, unlock,
"in today's digital age", 100% protection, guaranteed, disruptive, world-class

## Every piece of content must include
- At least one specific Australian statistic or data point with named source
- A concrete action the reader can take right now
- Reference to an Australian authority where relevant (Scamwatch, ACCC, ASD, IDCARE)

## Content topics
- SMS scam trends in Australia (Scamwatch data)
- Bank impersonation scams targeting Australians
- ATO tax scam season alerts
- MyGov account takeover scams
- Investment scam red flags (ASIC MoneySmart)
- Romance scam awareness
- Parcel delivery scams (Australia Post impersonation)
- How to report: Scamwatch, ReportCyber, IDCARE
- Protecting elderly Australians from phone scams
- Business email compromise targeting Australian SMEs
- Cryptocurrency scams in Australia

## SEO target keywords
scam checker Australia, how to spot a scam Australia, SMS scam Australia,
ATO scam alert, MyGov scam, bank scam Australia, investment scam red flags
Australia, scam prevention app Australia, phone scam Australia

## Publishing channels
- Twitter: @AskArthurAU \u2014 consumer audience, friendly and practical
- LinkedIn: AskArthur company page \u2014 B2B audience, banks/telcos/government
- Blog: https://askarthur.au/blog \u2014 SEO articles, 1200\u20132000 words
- Newsletter: "The AskArthur Scam Alert" \u2014 sent via Ghost to subscribers

## Approval rule
Every piece of content MUST be saved to Notion and emailed to the founder
with [REVIEW REQUIRED] before publishing, posting, or sending anything.
See COMPLIANCE.md for Australian regulatory requirements.
See B2B_TARGETS.md for enterprise targeting details.`;

export const ASKARTHUR_COMPLIANCE_MD = `# AskArthur \u2014 Australian Compliance Requirements

Load this file when drafting any public content, emails, or B2B outreach.

## Spam Act 2003
- All marketing emails sent via Ghost must include: unsubscribe link, physical address
- Ghost handles unsubscribe automatically \u2014 do not disable this
- Unsubscribe requests must be actioned within 5 business days
- No misleading subject lines in any email

## Australian Consumer Law (ACL)
- Never claim AskArthur will catch all scams or guarantee protection
- All statistics must cite their source by name
- "AI-powered" is acceptable language; "100% accurate" or "guaranteed" is not
- Fear-based claims that could be considered misleading are prohibited
- Do not compare AskArthur to specific competitors in a disparaging way

## Privacy Act 1988 (APP)
- Never include personal user data in agent prompts \u2014 aggregated metrics only
- Never reference individual users by name or email in any content
- Data breach notification required within 30 days if applicable

## ASIC (for bank and finance B2B outreach)
- Do not imply ASIC endorsement or regulatory approval of AskArthur
- Flag to founder if B2B intelligence product discussions involve AFSL questions

## AI disclosure (emerging state laws)
- Add "AI-assisted" label to clearly automated content
- NSW and VIC have active AI marketing regulation \u2014 default to disclosure
- Do not describe AskArthur as a human service or remove AI references when asked

## Hard rule
Always save as Notion draft. Always email founder [REVIEW REQUIRED].
Never publish, post, or send without founder approval in Notion.`;

export const ASKARTHUR_B2B_MD = `# AskArthur \u2014 B2B Enterprise Targeting

Load this file when drafting LinkedIn posts, investor outreach, or enterprise
partnership proposals.

## Target organisations
- Australian banks: CBA, Westpac, NAB, ANZ, Macquarie Bank
- Telcos: Telstra, Optus, Vodafone Australia
- Government: ACCC, Services Australia, AFP, ASIC, state fair trading offices
- Insurers and superannuation funds

## Target roles per sector
- Banks: Chief Risk Officer, Head of Fraud, CISO, Chief Digital Officer
- Telcos: Head of Trust and Safety, Chief Risk Officer, VP Product
- Government: Assistant Secretary (Services Australia), ACCC Commissioner,
  AFP Cybercrime Director, state consumer protection heads
- Insurance: Chief Risk Officer, Head of Fraud Intelligence

## Value proposition by sector

### Banks
AskArthur's real-time scam intelligence helps banks reduce fraud losses,
meet ASIC and APRA obligations on scam handling, and demonstrate duty of
care to customers.

### Telcos
Telcos face mandatory requirements under the Telecommunications (Scam Code).
AskArthur pattern data enables proactive network-level blocking of scam
calls and SMS, reducing compliance risk and protecting customers.

### Government
AskArthur provides population-scale scam awareness data to support policy
evidence, Scams Awareness Week campaigns, and the National Anti-Scam Centre
(NASC) mandate.

### Insurers
Scam-related insurance claims are rising. AskArthur intelligence helps
insurers understand fraud vectors, price risk accurately, and offer scam
prevention as a value-added policyholder benefit.

## Outreach approach
1. Research the specific person: their role, recent public statements, LinkedIn
2. Reference a relevant Australian regulatory event or enforcement action
3. Lead with their problem, not AskArthur's features
4. Propose a 20-minute call \u2014 never a demo as first step

## Investor targets (for IR agent)
- Reinventure \u2014 Westpac-backed, fintech specialist, highest strategic fit
- Blackbird Ventures \u2014 consumer/enterprise AI, invested in Canva, Safety Culture
- Square Peg Capital \u2014 fintech focus, Australian portfolio
- AirTree Ventures \u2014 consumer tech, B2B SaaS, AU/NZ focus
- Folklore Ventures \u2014 early-stage Australian tech
- AfterWork Ventures \u2014 pre-seed, Australian founders
- OIF Ventures \u2014 growth stage, Australian`;
