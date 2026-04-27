import type { Env } from './lib/claude';
import { ensureEnvironment, createAgent, updateAgent, kv } from './lib/claude';
import { loadBrandConfig } from './config/loader';
import { cmoSystemPrompt, cpoSystemPrompt, growthSystemPrompt, irSystemPrompt, codeSystemPrompt, publisherSystemPrompt } from './lib/prompts';
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
  const SONNET = 'claude-sonnet-4-6';
  const HAIKU = 'claude-haiku-4-5-20251001';
  const agentDefs = [
    { name: 'cmo', prompt: cmoSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'publisher', prompt: publisherSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: HAIKU },
    { name: 'cpo', prompt: cpoSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'growth', prompt: growthSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'ir', prompt: irSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'code', prompt: codeSystemPrompt(config, env.GH_REPO), tools: CODE_TOOLS, skills: [] as string[], model: SONNET },
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
      [],
      def.model,
    );
    await kv.put(env, `agent_${def.name}`, agentId);
    agents[def.name] = agentId;
  }

  return { environmentId, skillId, agents };
}

// Push the current system prompts + tool lists to already-created agents.
// POST /v1/agents/{id} creates a new version; sessions pick up the latest.
export async function updateAllAgents(env: Env): Promise<{ updated: string[]; missing: string[] }> {
  const config = loadBrandConfig(env);
  const skillId = await kv.get(env, `skill_id:${config.skillName}`);
  if (!skillId) throw new Error('Skill not bootstrapped. Run /setup first.');

  const SONNET = 'claude-sonnet-4-6';
  const HAIKU = 'claude-haiku-4-5-20251001';
  const agentDefs = [
    { name: 'cmo', prompt: cmoSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'publisher', prompt: publisherSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: HAIKU },
    { name: 'cpo', prompt: cpoSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'growth', prompt: growthSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'ir', prompt: irSystemPrompt(config), tools: CONTENT_TOOLS, skills: [skillId], model: SONNET },
    { name: 'code', prompt: codeSystemPrompt(config, env.GH_REPO), tools: CODE_TOOLS, skills: [] as string[], model: SONNET },
  ];

  const updated: string[] = [];
  const missing: string[] = [];

  for (const def of agentDefs) {
    const cachedId = await kv.get(env, `agent_${def.name}`);
    if (!cachedId) {
      missing.push(def.name);
      continue;
    }
    await updateAgent(env, cachedId, def.name, def.prompt, def.tools, def.skills, [], def.model);
    updated.push(def.name);
  }

  return { updated, missing };
}
