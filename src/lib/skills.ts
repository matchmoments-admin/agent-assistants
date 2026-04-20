import type { Env } from './claude';
import { kv } from './claude';

const BASE = 'https://api.anthropic.com';

export interface SkillFile {
  filename: string;
  content: string;
}

export async function uploadSkill(
  env: Env,
  skillName: string,
  files: SkillFile[],
): Promise<string> {
  const cached = await kv.get(env, `skill_id:${skillName}`);
  if (cached) return cached;

  const formData = new FormData();
  for (const file of files) {
    formData.append('files[]', new Blob([file.content], { type: 'text/markdown' }), file.filename);
  }

  const res = await fetch(`${BASE}/v1/skills`, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'managed-agents-2026-04-01,skills-2025-10-02',
      // No Content-Type — FormData sets it with boundary automatically
    },
    body: formData,
  });

  if (!res.ok) {
    const rid = res.headers.get('request-id') ?? 'unknown';
    throw new Error(`Upload skill failed [req ${rid}]: ${await res.text()}`);
  }
  const data = await res.json() as { id: string };
  await kv.put(env, `skill_id:${skillName}`, data.id);
  return data.id;
}

import { ASKARTHUR_SKILL_MD, ASKARTHUR_COMPLIANCE_MD, ASKARTHUR_B2B_MD } from './skill-content';

export function getSkillFiles(skillName: string): SkillFile[] {
  switch (skillName) {
    case 'askarthur-brand':
      return [
        { filename: 'askarthur-brand/SKILL.md', content: ASKARTHUR_SKILL_MD },
        { filename: 'askarthur-brand/COMPLIANCE.md', content: ASKARTHUR_COMPLIANCE_MD },
        { filename: 'askarthur-brand/B2B_TARGETS.md', content: ASKARTHUR_B2B_MD },
      ];
    default:
      throw new Error(`No bundled skill files for: ${skillName}`);
  }
}
