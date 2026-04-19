import type { Env, SSEEvent } from './claude';
import { kv, startSession, sendPrompt, sendToolResult, streamSession } from './claude';
import { trackCostFromSession } from './cost-control';
import { executeCustomTool } from './tools';
import type { BrandConfig } from '../config/types';

interface PendingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export async function runAgentSession(
  env: Env,
  config: BrandConfig,
  agentName: string,
  taskTitle: string,
  prompt: string,
): Promise<void> {
  const agentId = await kv.get(env, `agent_${agentName}`);
  if (!agentId) throw new Error(`Agent "${agentName}" not bootstrapped. Run /setup first.`);

  const environmentId = await kv.get(env, 'environment_id');
  if (!environmentId) throw new Error('Environment not bootstrapped. Run /setup first.');

  const vaultId = await kv.get(env, `vault_${env.PRODUCT_ID}-mcp`);
  const vaultIds = vaultId ? [vaultId] : [];

  const sessionId = await startSession(env, agentId, environmentId, taskTitle, vaultIds);
  await sendPrompt(env, sessionId, prompt);

  // Main loop: stream events, buffer tool calls, execute on idle, repeat
  let done = false;

  while (!done) {
    const pendingTools: PendingToolCall[] = [];
    let stopReasonType = '';

    await streamSession(env, sessionId, async (event: SSEEvent) => {
      switch (event.type) {
        case 'agent.custom_tool_use': {
          // Buffer tool calls — don't execute yet
          pendingTools.push({
            id: event.id as string,
            name: event.name as string,
            input: event.input as Record<string, unknown>,
          });
          break;
        }

        case 'session.status_idle': {
          stopReasonType = event.stop_reason?.type as string ?? 'end_turn';
          break;
        }

        case 'agent.message': {
          console.log(`[${agentName}] ${event.content ?? ''}`);
          break;
        }
      }
    });

    if (stopReasonType === 'requires_action' && pendingTools.length > 0) {
      // Execute all buffered tool calls and return results
      for (const tool of pendingTools) {
        const result = await executeCustomTool(env, config, tool.name, tool.input);
        await sendToolResult(env, sessionId, tool.id, result);
      }
      // Loop continues — re-open stream to get agent's next response
    } else {
      // end_turn or no action required — session complete
      done = true;
    }
  }

  // Track cost after session completes
  await trackCostFromSession(env, sessionId);
}
