import type { Env } from './lib/claude';
import { ensureEnvironment, createAgent, kv } from './lib/claude';
import { loadBrandConfig } from './config/loader';
import { cmoSystemPrompt, cpoSystemPrompt, growthSystemPrompt, irSystemPrompt, codeSystemPrompt } from './lib/prompts';
import { CONTENT_TOOLS, CODE_TOOLS } from './lib/agent-tools';
import { uploadSkill, getSkillFiles } from './lib/skills';

interface BootstrapResult {
  environmentId: string;
  skillId: string;
  agents: Record<string, string>;
}

export async function bootstrap(env: Env): Promise<BootstrapResult> {
  const config = loadBrandConfig(env);

  // Create environment
  const environmentId = await ensureEnvironment(env);

  // Upload skill (brand context)
  const skillFiles = getSkillFiles(config.skillName);
  const skillId = await uploadSkill(env, config.skillName, skillFiles);

  // Create agents (or retrieve cached IDs)
  const agentDefs = [
    { name: 'cmo', prompt: cmoSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId] },
    { name: 'cpo', prompt: cpoSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId] },
    { name: 'growth', prompt: growthSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId] },
    { name: 'ir', prompt: irSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId] },
    { name: 'code', prompt: codeSystemPrompt(config, env.GH_REPO), tools: CODE_TOOLS, skills: [] as string[] },
  ];

  const agents: Record<string, string> = {};

  for (const def of agentDefs) {
    const cachedId = await kv.get(env, `agent_${def.name}`);
    if (cachedId) {
      agents[def.name] = cachedId;
      continue;
    }

    const agentId = await createAgent(
      env,
      def.name,
      def.prompt,
      def.tools,
      def.skills,
    );
    await kv.put(env, `agent_${def.name}`, agentId);
    agents[def.name] = agentId;
  }

  return { environmentId, skillId, agents };
}
