---
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
Australian consumers aged 35–70. Particularly retirees and people less familiar
with digital fraud. Higher risk of being scammed than average.

## Brand voice
Warm, protective, and plainspoken. Never alarmist. Empowering — give people
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
- Twitter: @AskArthurAU — consumer audience, friendly and practical
- LinkedIn: AskArthur company page — B2B audience, banks/telcos/government
- Blog: https://askarthur.au/blog — SEO articles, 1200–2000 words
- Newsletter: "The AskArthur Scam Alert" — sent via Ghost to subscribers

## Mandatory approval workflow

Every content task MUST follow these steps — NEVER skip them:

1. Load this skill before starting any content task.
2. Complete the task.
3. Call `save_to_notion` with the full content. It returns a string of the form:
   `Saved to Notion: <url> (ID: <id>)`
4. Call `request_telegram_approval` with `{ notion_page_id, notion_url, title, preview }`.
   Extract `notion_page_id` and `notion_url` from the `save_to_notion` return string.
   `title` should be short (e.g. "Tweet: mobile fraud alert"). `preview` should be 1–3
   sentences so the founder can skim. The tool returns immediately — approval is applied
   asynchronously when the founder taps a button.
5. End your turn after step 4. Do NOT post, publish, or send anything yourself.
   The `/publish` flow picks up Approved items from Notion.
6. `email_founder` is deprecated (Mailgun is not activated). Prefer
   `request_telegram_approval`. Fall back to `email_founder` ONLY if
   `request_telegram_approval` returns an error string.

Never publish, post, or send anything without completing steps 3 and 4 first.

See COMPLIANCE.md for Australian regulatory requirements.
See B2B_TARGETS.md for enterprise targeting details.
