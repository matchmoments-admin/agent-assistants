import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../lib/claude';
import { sendTelegram } from '../lib/telegram';

export interface DeployParams {
  branch: string;
  chatId: number;
  messageId: number;
  triggeredBy: string;
}

export interface RollbackParams {
  chatId: number;
  messageId: number;
}

interface DeployLogEntry {
  action: 'deploy' | 'rollback';
  branch?: string;
  result: string;
  timestamp: number;
}

async function logDeploy(env: Env, entry: Omit<DeployLogEntry, 'timestamp'>): Promise<void> {
  const ts = Date.now();
  await env.AGENT_CONFIG.put(
    `${env.PRODUCT_ID}:deploy_log:${ts}`,
    JSON.stringify({ ...entry, timestamp: ts }),
    { expirationTtl: 30 * 24 * 60 * 60 },
  );
}

export class DeployWorkflow extends WorkflowEntrypoint<Env, DeployParams> {
  async run(event: Readonly<WorkflowEvent<DeployParams>>, step: WorkflowStep): Promise<unknown> {
    const { branch, chatId, messageId, triggeredBy } = event.payload;

    const dispatch = await step.do('trigger-action', async () => {
      const res = await fetch(
        `https://api.github.com/repos/${this.env.GH_REPO}/actions/workflows/deploy.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.env.GITHUB_PAT}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'askarthur-deploy-bot',
          },
          body: JSON.stringify({ ref: branch, inputs: { triggered_by: triggeredBy } }),
        },
      );
      if (res.status !== 204) {
        const body = await res.text();
        throw new Error(`workflow_dispatch failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return { status: res.status, dispatchedAt: Date.now() };
    });

    await step.do('write-deploy-log', async () => {
      await logDeploy(this.env, { action: 'deploy', branch, result: 'triggered' });
    });

    await step.do('notify-telegram', async () => {
      await sendTelegram(this.env, chatId,
        `✅ Deploy triggered: <b>${branch}</b>\nCheck GitHub Actions for progress.`);
    });

    return dispatch;
  }
}

export class RollbackWorkflow extends WorkflowEntrypoint<Env, RollbackParams> {
  async run(event: Readonly<WorkflowEvent<RollbackParams>>, step: WorkflowStep): Promise<unknown> {
    const { chatId } = event.payload;

    const result = await step.do('trigger-rollback', async () => {
      if (!this.env.DEPLOY_HOOK_URL) {
        throw new Error('DEPLOY_HOOK_URL not configured');
      }
      const res = await fetch(this.env.DEPLOY_HOOK_URL, { method: 'POST' });
      if (!res.ok) throw new Error(`rollback hook failed (${res.status})`);
      return { triggeredAt: Date.now() };
    });

    await step.do('write-rollback-log', async () => {
      await logDeploy(this.env, { action: 'rollback', result: 'triggered' });
    });

    await step.do('notify-telegram', async () => {
      await sendTelegram(this.env, chatId, '✅ Rollback triggered.');
    });

    return result;
  }
}
