import type { Env, SSEEvent } from './claude';
import { kv, startSession, sendPrompt, sendToolResult, openStream, readStreamEvents, archiveSession } from './claude';
import { trackCostFromSession } from './cost-control';
import { executeCustomTool } from './tools';
import type { BrandConfig } from '../config/types';

interface PendingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

const MAX_TURNS = 30;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

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

  try {
    await Promise.race([
      runSessionLoop(env, config, agentName, sessionId, prompt),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Session ${sessionId} exceeded ${SESSION_TIMEOUT_MS}ms watchdog`)),
          SESSION_TIMEOUT_MS,
        ),
      ),
    ]);
    await trackCostFromSession(env, sessionId);
  } finally {
    await archiveSession(env, sessionId).catch(() => { /* best effort */ });
  }
}

interface ToolResultPayload {
  toolId: string;
  result: string;
}

async function runSessionLoop(
  env: Env,
  config: BrandConfig,
  agentName: string,
  sessionId: string,
  prompt: string,
): Promise<void> {
  let done = false;
  let turns = 0;
  let firstTurn = true;
  let queuedToolResults: ToolResultPayload[] = [];

  while (!done) {
    if (++turns > MAX_TURNS) {
      throw new Error(`Session ${sessionId} exceeded MAX_TURNS (${MAX_TURNS})`);
    }

    // Open the SSE stream BEFORE posting any input so we never miss early events.
    const reader = await openStream(env, sessionId);

    if (firstTurn) {
      await sendPrompt(env, sessionId, prompt);
      firstTurn = false;
    } else {
      for (const { toolId, result } of queuedToolResults) {
        await sendToolResult(env, sessionId, toolId, result);
      }
      queuedToolResults = [];
    }

    const pendingTools: PendingToolCall[] = [];
    let stopReasonType = '';

    await readStreamEvents(reader, async (event: SSEEvent) => {
      switch (event.type) {
        case 'agent.custom_tool_use': {
          pendingTools.push({
            id: event.id as string,
            name: event.name as string,
            input: event.input as Record<string, unknown>,
          });
          break;
        }
        case 'agent.tool_use':
        case 'agent.mcp_tool_use':
        case 'agent.tool_result': {
          const name = (event.name as string | undefined) ?? (event.tool_use?.name as string | undefined) ?? '?';
          console.log(`[${agentName}] ${event.type} ${name}`);
          break;
        }
        case 'session.error': {
          const payload = JSON.stringify(event.error ?? event);
          throw new Error(`Session ${sessionId} session.error: ${payload.slice(0, 500)}`);
        }
        case 'session.status_idle': {
          stopReasonType = event.stop_reason?.type as string ?? 'end_turn';
          break;
        }
        case 'agent.message': {
          console.log(`[${agentName}] ${event.content ?? ''}`);
          break;
        }
        default: {
          console.debug(`[${agentName}] unhandled event type=${event.type}`);
        }
      }
    });

    if (stopReasonType === 'requires_action') {
      if (pendingTools.length === 0) {
        throw new Error(
          `Session ${sessionId} paused on requires_action with no custom tools to execute. ` +
          `The agent likely wants a non-custom tool_confirmation (MCP/built-in), which is not yet wired — see plan Phase 1.5.`,
        );
      }
      for (const tool of pendingTools) {
        const result = await executeCustomTool(env, config, tool.name, tool.input);
        queuedToolResults.push({ toolId: tool.id, result });
      }
    } else {
      done = true;
    }
  }
}
