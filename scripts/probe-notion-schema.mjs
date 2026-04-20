#!/usr/bin/env node
// Probe the actual Notion database schema — tells us the property names,
// their types, and what shape save_to_notion must send.
//
// Usage: node scripts/probe-notion-schema.mjs

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

const token = envVars.NOTION_TOKEN;
const dbs = {
  Social: envVars.NOTION_DB_SOCIAL,
  Blog: envVars.NOTION_DB_BLOG,
  Investor: envVars.NOTION_DB_INVESTOR,
  Competitor: envVars.NOTION_DB_COMPETITOR,
  Digests: envVars.NOTION_DB_DIGESTS,
};

if (!token) { console.error('NOTION_TOKEN missing from .dev.vars'); process.exit(1); }

for (const [label, dbId] of Object.entries(dbs)) {
  if (!dbId) { console.log(`${label}: no ID configured`); continue; }
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) {
    console.log(`${label} (${dbId}): ERROR status=${res.status} body=${(await res.text()).slice(0, 300)}`);
    continue;
  }
  const db = await res.json();
  const title = (db.title ?? []).map((t) => t.plain_text).join('');
  const props = Object.entries(db.properties ?? {}).map(([name, p]) => `    ${name} (${p.type})`);
  console.log(`${label} (${dbId}):`);
  console.log(`  title: "${title}"`);
  console.log(`  properties:`);
  console.log(props.join('\n'));
  console.log();
}
