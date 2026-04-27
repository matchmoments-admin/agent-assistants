import type { Env, SSEEvent } from './claude';
import {
  kv,
  startSession,
  sendPrompt,
  sendToolResult,
  openStream,
  readStreamEvents,
  archiveSession,
  listSessionEvents,
} from './claude';
import { trackCostFromSession } from './cost-control';
import { executeCustomTool } from './tools';
import type { BrandConfig } from '../config/types';

interface PendingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

const MAX_TURNS = 12;
const MAX_STREAM_RETRIES = 3;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
// Cap tool results fed back to the model. Each turn re-submits conversation
// history, so large results (e.g. gh_read_file) compound across the session.
// Raw result still flows to local logs; the model sees the truncated form.
const MAX_TOOL_RESULT_CHARS = 2000;

function isNetworkDrop(err: unknown): boolean {
  const msg = String(err ?? '');
  return /network connection lost|connection reset|stream closed|fetch failed|socket hang up/i.test(msg);
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
  console.log(`[${agentName}] session.start id=${sessionId} agent=${agentId}`);

  let watchdogHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runSessionLoop(env, config, agentName, sessionId, prompt).finally(() => {
        if (watchdogHandle) clearTimeout(watchdogHandle);
      }),
      new Promise<never>((_, reject) => {
        watchdogHandle = setTimeout(
          () => reject(Object.assign(
            new Error(`Session ${sessionId} exceeded ${SESSION_TIMEOUT_MS}ms watchdog`),
            { sessionId },
          )),
          SESSION_TIMEOUT_MS,
        );
      }),
    ]);
    await trackCostFromSession(env, sessionId);
    console.log(`[${agentName}] session.done id=${sessionId}`);
  } catch (err) {
    console.error(`[${agentName}] session.fail id=${sessionId} err=${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && !('sessionId' in err)) {
      Object.assign(err, { sessionId });
    }
    throw err;
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
  const seenEventIds = new Set<string>();

  while (!done) {
    if (++turns > MAX_TURNS) {
      throw new Error(`Session ${sessionId} exceeded MAX_TURNS (${MAX_TURNS})`);
    }

    const pendingTools: PendingToolCall[] = [];
    let stopReasonType = '';

    const handleEvent = async (event: SSEEvent) => {
      if (typeof event.id === 'string') {
        if (seenEventIds.has(event.id)) return;
        seenEventIds.add(event.id);
      }
      switch (event.type) {
        case 'agent.custom_tool_use': {
          console.log(`[${agentName}] tool.call name=${event.name} id=${event.id}`);
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
          console.log(`[${agentName}] idle turn=${turns} stop_reason=${stopReasonType}`);
          break;
        }
        case 'agent.message': {
          console.log(`[${agentName}] message turn=${turns}`);
          break;
        }
        default: {
          console.debug(`[${agentName}] unhandled event type=${event.type}`);
        }
      }
    };

    // Open the SSE stream BEFORE sending any input.
    // Retry on Cloudflare network drops — the server keeps the session state;
    // we dedupe events by id and catch up via listSessionEvents on each retry.
    let streamAttempts = 0;
    let streamDone = false;
    while (!streamDone) {
      streamAttempts++;
      console.log(`[${agentName}] stream.open turn=${turns} attempt=${streamAttempts}`);
      try {
        const reader = await openStream(env, sessionId);

        if (streamAttempts === 1) {
          if (firstTurn) {
            await sendPrompt(env, sessionId, prompt);
            firstTurn = false;
          } else {
            for (const { toolId, result } of queuedToolResults) {
              console.log(`[${agentName}] tool.result id=${toolId}`);
              await sendToolResult(env, sessionId, toolId, result);
            }
            queuedToolResults = [];
          }
        } else {
          // Reconnect path — catch up any events we missed while disconnected
          console.log(`[${agentName}] stream.catchup listing events since drop`);
          const missed = await listSessionEvents(env, sessionId);
          for (const ev of missed) {
            await handleEvent(ev);
            if (stopReasonType) break;
          }
          if (stopReasonType) { streamDone = true; break; }
        }

        await readStreamEvents(reader, handleEvent);
        streamDone = true;
      } catch (err) {
        if (isNetworkDrop(err) && streamAttempts < MAX_STREAM_RETRIES) {
          console.warn(`[${agentName}] stream.drop attempt=${streamAttempts} err=${err instanceof Error ? err.message : String(err)} — reconnecting`);
          continue;
        }
        throw err;
      }
    }

    if (stopReasonType === 'requires_action') {
      if (pendingTools.length === 0) {
        throw new Error(
          `Session ${sessionId} paused on requires_action with no custom tools to execute. ` +
          `The agent likely wants a non-custom tool_confirmation (MCP/built-in), which is not yet wired — see plan Phase 1.5.`,
        );
      }
      for (const tool of pendingTools) {
        const result = await executeCustomTool(env, config, tool.name, tool.input);
        const trimmed = result.length > MAX_TOOL_RESULT_CHARS
          ? result.slice(0, MAX_TOOL_RESULT_CHARS) + `\n…[truncated ${result.length - MAX_TOOL_RESULT_CHARS} chars]`
          : result;
        if (trimmed !== result) {
          console.log(`[${agentName}] tool.result.truncated name=${tool.name} raw=${result.length}`);
        }
        queuedToolResults.push({ toolId: tool.id, result: trimmed });
      }
    } else {
      done = true;
    }
  }
}
