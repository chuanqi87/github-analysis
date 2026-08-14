import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let cachedSessionId: string | null = null;

function createSessionId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `daily-${stamp}-${randomUUID().slice(0, 8)}`;
}

/** 同一 Node 进程内所有管道子阶段共享一个 session。 */
export function getPipelineSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  cachedSessionId = process.env.PIPELINE_SESSION_ID?.trim() || createSessionId();
  process.env.PIPELINE_SESSION_ID = cachedSessionId;
  return cachedSessionId;
}

export interface SessionEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * 终端之外再保留一份本地 JSONL。写入失败不应打断分析主链路；
 * 数据库中的 pipeline_runs / analysis_execution_logs 仍是权威审计源。
 */
export function writeSessionEvent(event: SessionEvent): void {
  try {
    const dir = join(process.cwd(), 'reports', 'logs');
    mkdirSync(dir, { recursive: true });
    const sessionId = getPipelineSessionId();
    appendFileSync(
      join(dir, `${sessionId}.jsonl`),
      `${JSON.stringify({ timestamp: new Date().toISOString(), session_id: sessionId, ...event })}\n`,
      'utf8',
    );
  } catch (error) {
    console.warn(`[session] 写本地日志失败:${String(error).slice(0, 160)}`);
  }
}
