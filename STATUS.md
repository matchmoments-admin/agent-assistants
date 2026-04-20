# Agent Fleet — Deployment Status

> Living document. Update this as setup progresses.

Last updated: 2026-04-20

## Schema migration — 2026-04-20

Managed Agents beta schema churned between its 2026-04-08 launch and today. Fleet went production-down — every Telegram command and cron failed at `POST /v1/sessions` or the first event send. Two rounds of migration were needed because the `managed-agents-2026-04-01` header surfaces a *different* validator state than the old `agent-api-2026-03-01` header; guesses based on pre-migration error responses were stale by the time we deployed.

Final confirmed wire shape (all verified 200 via `scripts/contract-test.mjs`):

- Beta header: `managed-agents-2026-04-01` (across `claude.ts`, `cost-control.ts`, `skills.ts`; `skills-2025-10-02` token preserved alongside)
- Session create body: `{ agent: { type: 'agent', id }, environment_id: <string>, title, vault_ids }` (NOT `agent_reference`, NOT bare string, NOT `environment`)
- User event: `{ type: 'user.message', content: [...] }` — the `user.*` prefix is kept
- Tool result event: `{ type: 'user.custom_tool_result', custom_tool_use_id, content: [...] }` — prefix + field name both kept
- Session IDs have prefix `sesn_`, not `sess_`
- Archive endpoint: `POST /v1/sessions/{id}/archive` returns 200

Also landed alongside:

- `request-id` response header now threaded into every Anthropic-call error (9 sites across `claude.ts`, `cost-control.ts`, `skills.ts`)
- Optional `DEBUG_AGENT_API=1` secret — raw response + request-id logging in `sendPrompt`/`sendToolResult`. Currently enabled. Remove in a follow-up once confidence stabilises.
- `scripts/contract-test.mjs` — **run before every deploy**: `node scripts/contract-test.mjs`. Fails fast on any future schema drift.
- `src/lib/session-runner.ts` — `MAX_TURNS = 30` cap, 10-min wall-clock watchdog, `try/finally` with `archiveSession` to stop idle sessions from billing.
- `src/lib/telegram.ts` — webhook secret compared with constant-time helper (was `!==`, timing-unsafe), `update_id` deduped via KV with 24h TTL to absorb Telegram's retry behaviour.
- `CLAUDE.md` implementation-details paragraph rewritten to match the confirmed shape.

## Audit follow-up round 2 — 2026-04-20

A second audit brief surfaced architectural latent bugs in `session-runner.ts` that could cause silent hangs or false-success exits. Shipped (version `d66f174d`):

- **Stream-first ordering** (`openStream` + `readStreamEvents` in `claude.ts`): the SSE stream is now subscribed before `sendPrompt` / `sendToolResult`, closing a race window where early events could be emitted before we're listening.
- **Strict `requires_action` handling**: if `session.status_idle` fires with `stop_reason: requires_action` but no `agent.custom_tool_use` events were buffered, the loop now throws `Session <id> paused on requires_action ...` instead of silently marking the run as done. Hooks into the existing Telegram error reporting.
- **Full event coverage**: added handlers for `agent.tool_use`, `agent.mcp_tool_use`, `agent.tool_result` (log-only, server-executed), and `session.error` (throws with payload). `default` case logs unknown event types at debug level so schema additions surface instead of hiding.
- **Tool-result queueing**: when a tool round-trip happens, results are now queued and sent AFTER the next stream is open, preserving the same stream-first ordering on subsequent turns.

Deferred to a follow-up commit:

- **Agent version pinning** (`{ type: 'agent', id, version }`) — the response shape from `POST /v1/agents` / `GET /v1/agents/{id}` doesn't obviously include a `version` field (contract test output shows agents without it). Needs a short probe of the `/v1/agents/{id}` GET response to identify the version field name before we can pin. Filed in backlog.

## Phase 1 — Verification checklist (post-round-2)
- [x] `scripts/contract-test.mjs` — all 4 checks pass against live API after the refactor
- [ ] `/tweet test` via Telegram — happy path reaches Notion (requires Paid plan, active as of 2026-04-20)
- [ ] `/blog <topic>` — exercises `sendToolResult` queue path
- [ ] `/feature add test readme` — Code agent full loop including PR open
- [ ] After green: remove `DEBUG_AGENT_API` echoes + secret (Phase 0.6 in plan)

**Verification checklist:**
- [x] `scripts/contract-test.mjs` — all 4 checks pass against live API
- [ ] `/tweet test` via Telegram — 200 on session create + first event, draft arrives in Notion
- [ ] `/blog <topic>` — exercises `sendToolResult` end-to-end
- [ ] `/status` — `trackCostFromSession` OK
- [ ] `/feature add test readme` — Code agent full tool loop + GitHub PR
- [ ] After all four pass: `npx wrangler secret delete DEBUG_AGENT_API` + strip debug-echo log lines in `claude.ts` + remove `DEBUG_AGENT_API?: string` from `Env`

## Outstanding audit follow-ups

Pulled from the 2026-04-20 fix-it brief. What landed in the migration above is checked off; remaining work prioritised for future sprints.

### P1 — next sprint

- [x] ~~**Contract test** — script that creates a session + sends an event and asserts 200~~ — **done**: `scripts/contract-test.mjs`. Still TODO: wire into CI as a nightly gate.
- [x] ~~**Telegram webhook secret verification** (constant-time)~~ — **done**: `src/lib/telegram.ts` `constantTimeEqual`.
- [x] ~~**Update dedup**~~ — **done**: KV `tg_update:{update_id}` with 24h TTL.
- [x] ~~**Allowlist by user_id**~~ — already correct in existing code (`isAllowed(env, message.from.id)` uses numeric IDs).
- **SDK migration** — `@anthropic-ai/sdk` v0.90.0 has `client.beta.sessions.*` with the correct beta header and agent shape, but its event-type params still use the `user.*` prefix (which the current server *requires*, so good). The main blocker is time, not drift: migrating now would delete ~150 lines of hand-rolled fetch and give us typed responses + automatic request-id plumbing. Revisit when bandwidth allows.
- **CI-wired contract test** — run `scripts/contract-test.mjs` nightly via GitHub Actions on a dev workspace; fail on drift.

### P2 — security hardening

- [x] ~~**`max_turns` + wall-clock watchdog + session cleanup**~~ — **done** in `src/lib/session-runner.ts` (30 turns, 10-min watchdog, try/finally archive).
- **GitHub App migration** — replace `GITHUB_PAT` with a GitHub App scoped only to `ask-arthur` (`Contents: RW`, `Pull requests: RW`, `Metadata: R`). Installation-token auth rotates hourly; commits via `createCommitOnBranch` GraphQL are signed and show as Verified.
- **Branch protection + CODEOWNERS** on `matchmoments-admin/ask-arthur` main: PR + 1 approval + Code Owners review + linear history + signed commits + no force push, no bypass. Required checks: `path-check`, `gitleaks`, `markdownlint`.
- **Pre-PR diff validator** in the Code agent: reject changes outside `drafts/**`, reject any secret-regex match (`sk-ant-`, `ghp_`, `github_pat_`, `ghs_`, Telegram bot token).
- **Sandbox egress allowlist** — replace `networking: { type: 'unrestricted' }` at `src/lib/claude.ts:61` with `{ type: 'limited', allowed_hosts: [...] }` once the MCP URL inventory is known.
- **Tool-confirmation wiring** — bridge server-side `user.tool_confirmation` events to a Telegram Run/Cancel button. Today the bot auto-allows everything; write tools (git push, gh pr) should require a human tap.

### P3 — ops

- **Structured JSON logs** with fields `anthropic_request_id`, `session_id`, `agent_id`, `tg_chat_id`, `tg_user_id`, `command`, `duration_ms`. Alert on 4xx spikes.
- **Workspace split** — `askarthur-dev` / `askarthur-prod` Anthropic workspaces with per-workspace API keys + spend caps. Blast radius bounded by key.
- **Per-user rate limit** — KV sliding window, 5/5min and 30/day per `user_id`.
- **Idempotency keys** on PR branches, derived from `(chat_id, message_id, command)` so a retry reuses the branch instead of opening a duplicate PR.
- **Log scrubber** — regex-redact all five secret formats in both Workers logs and outbound Telegram error messages.



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
