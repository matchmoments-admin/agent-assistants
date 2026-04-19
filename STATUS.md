# Agent Fleet — Deployment Status

> Living document. Update this as setup progresses.

Last updated: 2026-04-19

## Deployed infrastructure

| Component | Status | Notes |
|---|---|---|
| Worker | ✅ Live | `https://agent-fleet.matchmoments.workers.dev` |
| KV namespace | ✅ | `b795557a60614036bc21b9997b3598aa` |
| Vectorize index | ✅ | `agent-memory` |
| Durable Object | ✅ | AgentMemory (SQLite) |
| Cron schedules | ✅ | 5 active |
| Telegram bot | ✅ | `@AskArthurOps_Bot`, webhook registered |
| Mailgun DNS | Pending verification | DNS records in GoDaddy |
| Ghost VPS | ✅ Live | `https://blog.askarthur.au` on Vultr Sydney |
| Ghost admin | ✅ | Integration created |
| GitHub Actions | ✅ | deploy.yml stub on main |
| Branch protection | ✅ | main protected, PR required |

## Agent IDs (in production)

- `cmo`: `agent_011CaCcLf8c3vcjK2k6KkaQ5`
- `cpo`: `agent_011CaCcLnGiyXpaVtqZkhU7Q`
- `growth`: `agent_011CaCcLtVn1tLsMrYe83Mb3`
- `ir`: `agent_011CaCcLzVCSorsuaVmk5fRM`
- `code`: `agent_011CaCy8bb9wWbemjaUohzcd`

Environment ID: `env_01P6xooek15aw5KSG3rjYWot`
Skill ID: `skill_01THrr4hkt1rg6Nq5nTyCiJu` (askarthur-brand)

## Secrets set in Cloudflare

✅ Set:
- ANTHROPIC_API_KEY
- MAILGUN_API_KEY
- MAILGUN_DOMAIN (mg.askarthur.au)
- TWITTER_API_KEY, TWITTER_API_SECRET
- TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
- NOTION_TOKEN
- NOTION_DB_BLOG, NOTION_DB_SOCIAL, NOTION_DB_INVESTOR, NOTION_DB_COMPETITOR, NOTION_DB_DIGESTS
- FOUNDER_EMAIL
- TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_IDS, TELEGRAM_WEBHOOK_SECRET
- GITHUB_PAT
- GH_REPO (matchmoments-admin/ask-arthur)
- GHOST_ADMIN_API_KEY

❌ Not yet set (optional / waiting):
- LINKEDIN_ACCESS_TOKEN — waiting on LinkedIn Community Management API approval
- GMAIL_OAUTH_TOKEN — deferred (CPO agent won't read Gmail until set)
- GCAL_OAUTH_TOKEN — deferred
- DEPLOY_HOOK_URL — optional (only needed for `/rollback`)

## Outstanding setup tasks

### High priority

1. **Update GitHub PAT with Pull Requests scope**
   - Current PAT has `Contents: RW` + `Actions: RW`
   - Code Agent needs `Pull requests: Read and Write` to open PRs
   - Go to github.com → Settings → Developer settings → Fine-grained tokens → edit `askarthur-deploy-bot` → add Pull requests RW
   - No new token value needed, same PAT

2. **Configure Mailgun in Ghost admin**
   - Ghost → Settings → Email newsletter → Connect Mailgun
   - Region: US
   - Domain: mg.askarthur.au
   - Private API key: (Mailgun API key from .dev.vars)
   - Required before newsletter auto-sends work

3. **Verify Mailgun DNS records**
   - All 6 records added to GoDaddy for mg.askarthur.au
   - In Mailgun dashboard, click "Check status" — must show green
   - Without this, founder alert emails will fail

4. **Set Ghost SMTP password**
   - SSH into the Vultr VPS (108.61.96.112)
   - Edit `~/ghost-fleet/docker-compose.yml`
   - Replace `SMTP_PASSWORD_LATER` with actual Mailgun SMTP password
   - Get it from Mailgun → Sending → Domains → mg.askarthur.au → SMTP credentials → "Manage SMTP credentials"
   - `cd ~/ghost-fleet && docker compose up -d` to restart

### Medium priority

5. **LinkedIn Community Management API approval**
   - Waiting for LinkedIn to approve the request
   - Once approved: generate access token from app Auth tab → `npx wrangler secret put LINKEDIN_ACCESS_TOKEN`
   - Until then, `/linkedin` command will return a LinkedIn API error

6. **Gmail + Calendar OAuth (for CPO agent)**
   - Only affects `/digest` command — CPO falls back to web search without it
   - Run `npx @modelcontextprotocol/inspector`
   - Gmail: `https://gmail.mcp.claude.com/mcp` → Quick OAuth Flow
   - GCal: `https://gcal.mcp.claude.com/mcp` → Quick OAuth Flow
   - After tokens obtained: re-enable MCP servers in `src/lib/claude.ts` `createAgent` function and re-bootstrap

### Low priority

7. **Register Telegram commands with BotFather**
   - Makes commands appear as autocomplete when typing `/` in chat
   - Message @BotFather → `/setcommands` → select bot → paste full command list
   - Purely UX, bot works without it

8. **Push agent-fleet to private GitHub repo**
   - Create private repo at github.com/matchmoments-admin/agent-fleet
   - `git remote add origin https://github.com/matchmoments-admin/agent-fleet.git`
   - `git push -u origin main`

9. **Ghost member signups + comments**
   - Ghost admin → Settings → Members → enable free signups
   - Ghost admin → Settings → Comments → enable native comments
   - Not blocking any agent functionality — just improves blog UX

## Known limitations

- **Twitter posting is Telegram-only**: removed from crons to stay under the 5-cron Workers Free plan limit. Upgrade to Workers Paid ($5/mo) to restore automatic Twitter scheduling
- **No Gmail integration yet**: CPO digest will use web search instead of reading support emails until OAuth tokens are set
- **No LinkedIn posting yet**: waiting on API approval
- **Auto-backups disabled on Vultr VPS**: saved $1/month; Ghost SQLite DB should be manually backed up if content grows
- **No automated tests**: CI on ask-arthur repo runs on PRs, but the agent-fleet repo has no test suite

## Deployment quick reference

```bash
# Change code, then:
cd ~/Desktop/agent-fleet
npx tsc --noEmit              # Type check
npx wrangler deploy           # Deploy

# If agent definitions changed (prompts, tools, skills):
curl -X POST https://agent-fleet.matchmoments.workers.dev/setup

# Live logs:
npx wrangler tail

# Check spend:
curl https://agent-fleet.matchmoments.workers.dev/status
```

## Cost tracking

Budget: $150/month (`BUDGET_LIMIT_USD`)
Alert thresholds: 80% warning, 100% hard stop
Check via: `/status` in Telegram or `curl /status` endpoint

Expected monthly cost:
- Anthropic (Sonnet 4.6 for most tasks): ~$3-8
- Cloudflare Workers Paid (if upgraded): $5
- Vultr VPS Sydney: $5 USD
- Mailgun: free tier (100/day)
- **Total pre-launch**: ~$13-18/month
