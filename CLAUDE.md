# Agent Fleet

Multi-agent system running on Cloudflare Workers. Six agents: five content/ops agents built on Claude Managed Agents, plus a Deploy Agent wired directly into the Telegram handler.

Everything the fleet produces lands in Notion for founder review before anything goes public.

## Architecture

```
Telegram bot ──▶ Cloudflare Worker (agent-fleet) ──▶ Claude Managed Agents API
                      │                                    │
                      ├─ KV: agent IDs, spend, flags, logs │
                      ├─ DO: AgentMemory (SQLite)           │
                      ├─ Vectorize: semantic memory         │
                      └─ Cron triggers                      │
                                                            │
                      Custom tools call out to:             │
                      - Notion API (drafts, approvals)      │
                      - Ghost Admin API (publish)           │
                      - Twitter/X API v2 (tweet)            │
                      - LinkedIn Posts API (company post)   │
                      - Mailgun (founder alerts)            │
                      - GitHub API (Code agent PRs)         │
```

## The six agents

| Agent | Type | Runs via | Purpose |
|---|---|---|---|
| CMO | Managed | Cron + Telegram | Blog/social drafts, publish approved to Ghost |
| CPO | Managed | Cron + Telegram | Weekly product digest from support emails |
| Growth | Managed | Cron + Telegram | Daily competitor monitoring |
| IR | Managed | Cron + Telegram | Investor updates, outreach drafts |
| Code | Managed | Telegram only | Takes feature descriptions → opens PRs against `ask-arthur` repo |
| Deploy | Built into bot | Telegram only | Triggers GitHub Actions, flags, rollback |

## File structure

```
agent-fleet/
├── CLAUDE.md                       This file
├── STATUS.md                       Living deployment status + outstanding setup
├── wrangler.toml                   Cloudflare Worker config
├── package.json
├── tsconfig.json
├── .dev.vars                       Local secrets (gitignored)
├── .gitignore
│
├── skills/askarthur/               Brand context for Managed Agents
│   ├── SKILL.md                    Main brand skill (triggers on AskArthur mention)
│   ├── COMPLIANCE.md               Australian regulatory rules
│   └── B2B_TARGETS.md              Enterprise targeting details
│
├── ghost-setup/                    Configs for the Ghost VPS (Vultr)
│   ├── docker-compose.yml
│   ├── .env.example
│   └── nginx/conf.d/askarthur.conf.example
│
└── src/
    ├── index.ts                    Worker entry: cron router + /setup /trigger /telegram /status
    ├── bootstrap.ts                Creates all 5 Managed Agents + uploads skill
    ├── memory.ts                   AgentMemory Durable Object (SQLite)
    │
    ├── config/
    │   ├── types.ts                BrandConfig interface
    │   ├── askarthur.ts            AskArthur config
    │   └── loader.ts               Config loader + env injection
    │
    ├── agents/
    │   ├── cmo.ts                  CMO runner (blog-draft, twitter-post, linkedin-post, publish-approved)
    │   ├── cpo.ts                  CPO runner (weekly-digest)
    │   ├── growth.ts               Growth runner (competitor-scan)
    │   ├── investor-relations.ts   IR runner (investor-update)
    │   └── code.ts                 Code runner (feature)
    │
    └── lib/
        ├── claude.ts               Managed Agents API client + Env interface + KV helpers
        ├── session-runner.ts       SSE stream handler + buffered tool execution
        ├── tools.ts                Content + Code custom tool implementations
        ├── agent-tools.ts          Tool schemas: CONTENT_TOOLS + CODE_TOOLS
        ├── prompts.ts              System prompt builders per agent
        ├── skills.ts               Skill upload to Anthropic API
        ├── skill-content.ts        Bundled skill markdown (Workers has no fs)
        ├── cost-control.ts         Monthly budget enforcement + reset
        ├── telegram.ts             Telegram webhook handler + deploy commands
        └── github.ts               GitHub REST API helpers for Code agent
```

## Telegram commands

| Command | Agent | Output |
|---|---|---|
| `/blog` | CMO | Blog draft → Notion |
| `/tweet` | CMO | Twitter draft → Notion |
| `/linkedin` | CMO | LinkedIn draft → Notion |
| `/publish` | CMO | Publishes Approved posts to Ghost |
| `/digest` | CPO | Weekly digest → Notion |
| `/scan` | Growth | Competitor scan → Notion |
| `/investor` | IR | Investor update → Notion |
| `/feature <desc>` | Code | Opens PR in ask-arthur repo |
| `/deploy [branch]` | Deploy | Triggers GitHub Actions |
| `/rollback` | Deploy | Rollback via deploy hook |
| `/flag [key] [val]` | Deploy | Get/set/list feature flags |
| `/deploylog` | Deploy | Last 5 deploys |
| `/status` | — | Spend + budget |
| `/help` | — | Command list |

## Automated schedule (UTC)

Five crons (Workers Free plan limit):

| Cron | Agent | Task | Local (AEST) |
|---|---|---|---|
| `0 21 * * SUN` | CMO | blog-draft | Sun 7am |
| `0 0 * * MON` | CPO | weekly-digest | Mon 10am |
| `0 1 * * TUE` | CMO | linkedin-post | Tue 11am |
| `0 0 * * *` | Growth + CMO | competitor-scan + publish-approved | Daily 10am |
| `0 22 1 * *` | IR | investor-update | 1st of month 8am |

## KV key conventions

All keys prefixed with `${PRODUCT_ID}:` to isolate products. Exception: deploy nonces use global `deploy:` and `feature:` prefixes (short TTL anyway).

| Key pattern | Purpose |
|---|---|
| `{productId}:environment_id` | Managed Agents environment ID |
| `{productId}:agent_{name}` | Each agent's ID (cmo, cpo, growth, ir, code) |
| `{productId}:skill_id:{name}` | Uploaded skill ID |
| `{productId}:monthly_spend_usd` | Running cost tracker |
| `{productId}:spend_month` | Current month marker (for reset) |
| `{productId}:search_count` | Web search counter |
| `{productId}:flag:{key}` | Feature flag values |
| `{productId}:deploy_log:{ts}` | Deploy audit log (30-day TTL) |
| `deploy:{nonce}` | Deploy confirm nonce (300s TTL) |
| `feature:{nonce}` | Feature confirm nonce (300s TTL) |

## Build + deploy

```bash
# Type check
npx tsc --noEmit

# Deploy to Cloudflare
npx wrangler deploy

# Bootstrap agents (creates them in Anthropic, caches IDs in KV)
curl -X POST https://agent-fleet.matchmoments.workers.dev/setup

# Tail live logs
npx wrangler tail

# Set a secret
npx wrangler secret put SECRET_NAME
```

## Environment variables

Public (in `wrangler.toml` `[vars]`):
- `PRODUCT_ID` = askarthur
- `BUDGET_LIMIT_USD` = 150
- `WEB_SEARCH_CAP` = 150
- `GHOST_API_URL` = https://blog.askarthur.au

Secrets (set via `wrangler secret put`):
- Anthropic: `ANTHROPIC_API_KEY`
- Twitter: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- LinkedIn: `LINKEDIN_ACCESS_TOKEN`
- Mailgun: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`
- Notion: `NOTION_TOKEN`, `NOTION_DB_BLOG`, `NOTION_DB_SOCIAL`, `NOTION_DB_INVESTOR`, `NOTION_DB_COMPETITOR`, `NOTION_DB_DIGESTS`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_IDS`, `TELEGRAM_WEBHOOK_SECRET`
- GitHub: `GITHUB_PAT`, `GH_REPO`
- Ghost: `GHOST_ADMIN_API_KEY`
- Founder: `FOUNDER_EMAIL`
- Optional: `GMAIL_OAUTH_TOKEN`, `GCAL_OAUTH_TOKEN`, `DEPLOY_HOOK_URL`

## Key implementation details

**Managed Agents API** uses the beta header `managed-agents-2026-04-01`. Session creation passes `agent` (not `agent_id`). Custom tool results use `user.custom_tool_result` events. SSE stream at `/v1/sessions/{id}/stream` — the session runner buffers `agent.custom_tool_use` events and executes them when `session.status_idle` with `requires_action` fires, then re-opens the stream.

**Skills** are uploaded via multipart form with `files[]` fields. The SKILL.md file must be inside a top-level folder named after the skill (e.g., `askarthur-brand/SKILL.md`). Agents reference skills via `{type: 'custom', skill_id}`.

**Content tools vs Code tools** — split into two arrays in `agent-tools.ts`. CMO/CPO/Growth/IR get `CONTENT_TOOLS` (Notion, Ghost, Twitter, LinkedIn, email). Code agent gets `CODE_TOOLS` (GitHub read/write/branch/commit/PR, notify_founder).

**Cron limit** — Cloudflare Workers Free plan allows only 5 cron triggers. Twitter posts are Telegram-only as a result. Upgrading to Paid plan ($5/month) removes this cap.

**LinkedIn API** — uses the current Posts API (`POST /rest/posts`) with `Linkedin-Version: 202504` header. The legacy `/v2/ugcPosts` endpoint is deprecated.

**Ghost publish flow** — two-step: POST creates a draft, then PUT to publish with `?newsletter=&email_segment=` query params. `email_segment` is a query param on the publish PUT, not a body param on the create POST.

**Notion API** uses version `2025-09-03`. The older `2022-06-28` still works at the API level but is dropped in SDK v5+.

**MCP vaults** — the fleet originally used vault-based auth for Gmail/GCal MCP servers, but MCP servers were removed from agent definitions since the Gmail/GCal OAuth tokens aren't set yet. Re-add them when those tokens are available.

## Adding a new agent

1. Write a system prompt in `src/lib/prompts.ts`
2. Create `src/agents/newagent.ts` with a runner function
3. Register in `src/bootstrap.ts` `agentDefs` array — pick `CONTENT_TOOLS` or `CODE_TOOLS`
4. Add Telegram command in `src/lib/telegram.ts`
5. Add to `/trigger` switch in `src/index.ts`
6. Add cron case in `src/index.ts` if automated
7. Deploy + re-bootstrap

## Adding a new product

1. Create `src/config/newproduct.ts` (copy askarthur.ts, edit)
2. Create `skills/newproduct/` directory with SKILL.md etc.
3. Register in `src/config/loader.ts` CONFIG_MAP
4. Add to `src/lib/skill-content.ts` bundled content
5. Add `[env.newproduct]` section to wrangler.toml with PRODUCT_ID + GHOST_API_URL
6. Set secrets with `--env newproduct` flag
7. Deploy with `wrangler deploy --env newproduct`
8. Bootstrap via the new product's URL

See STATUS.md for current deployment state and outstanding setup.
