#!/usr/bin/env node
// Contract test — exercises /v1/sessions with the current wire shape.
// Run before deploy to catch Managed Agents schema drift early.
//
// Usage: node scripts/contract-test.mjs
// Reads ANTHROPIC_API_KEY from .dev.vars. Agent + environment IDs are the
// ones recorded in STATUS.md. Update them if the IDs ever rotate.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const devVarsPath = join(__dirname, '..', '.dev.vars');

const envVars = readFileSync(devVarsPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...rest] = line.split('=');
    acc[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    return acc;
  }, {});

const API_KEY = envVars.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY missing from .dev.vars');
  process.exit(1);
}

const AGENT_ID = 'agent_011CaCcLf8c3vcjK2k6KkaQ5';
const ENV_ID = 'env_01P6xooek15aw5KSG3rjYWot';
const BETA = 'managed-agents-2026-04-01';

const HEADERS = {
  'x-api-key': API_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': BETA,
  'content-type': 'application/json',
};

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

async function main() {
  console.log(`Contract test against ${BETA}\n`);

  const createRes = await fetch('https://api.anthropic.com/v1/sessions', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      agent: { type: 'agent', id: AGENT_ID },
      environment_id: ENV_ID,
      title: 'contract-test',
      vault_ids: [],
    }),
  });

  const createRid = createRes.headers.get('request-id') ?? 'unknown';
  const createBody = await createRes.json();
  assert(createRes.ok, `POST /v1/sessions status=${createRes.status} req=${createRid} body=${JSON.stringify(createBody).slice(0, 300)}`);
  const sessionId = createBody.id;
  assert(typeof sessionId === 'string' && sessionId.startsWith('sesn_'), `session.id present: ${sessionId}`);

  const eventRes = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      events: [{ type: 'user.message', content: [{ type: 'text', text: 'contract-test ping' }] }],
    }),
  });
  const eventRid = eventRes.headers.get('request-id') ?? 'unknown';
  const eventBody = eventRes.ok ? null : await eventRes.text();
  assert(eventRes.ok, `POST /v1/sessions/{id}/events status=${eventRes.status} req=${eventRid} body=${eventBody ?? 'ok'}`);

  const archiveRes = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: HEADERS,
  });
  assert(archiveRes.ok || archiveRes.status === 404, `archive cleanup status=${archiveRes.status}`);

  console.log('\nAll contract checks passed.');
}

main().catch((err) => {
  console.error('Contract test threw:', err);
  process.exit(1);
});
