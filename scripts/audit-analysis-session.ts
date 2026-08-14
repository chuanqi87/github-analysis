import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAdminClient } from '@/lib/supabase/admin';

type Status = 'success' | 'failed' | 'skipped';

interface ExecutionLog {
  repository_id: number;
  tier: 1 | 2 | 3;
  status: Status;
  model: string;
  prompt_version: string;
  evidence: Record<string, any>;
  output: Record<string, any> | null;
  error: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number;
  system_prompt: string | null;
  user_prompt: string | null;
}

interface RepoInfo {
  id: number;
  full_name: string;
  stars: number;
  primary_language: string | null;
}

interface QueueInfo {
  repository_id: number;
  discovery_score: number;
  preliminary_score: number | null;
  deep_score: number | null;
  hot_score: number;
  reasons: string[];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function distribution(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) {
    return { count: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0, unique: 0 };
  }
  return {
    count: finite.length,
    min: Math.min(...finite),
    p25: percentile(finite, 0.25),
    median: percentile(finite, 0.5),
    p75: percentile(finite, 0.75),
    max: Math.max(...finite),
    mean: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0,
    unique: new Set(finite.map((value) => value.toFixed(2))).size,
  };
}

function frequency(values: string[], limit = 20): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

async function pageSessionLogs(sessionId: string): Promise<ExecutionLog[]> {
  const client = getAdminClient();
  const result: ExecutionLog[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('analysis_execution_logs')
      .select('repository_id,tier,status,model,prompt_version,evidence,output,error,tokens_in,tokens_out,duration_ms,system_prompt,user_prompt')
      .eq('session_id', sessionId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ExecutionLog[];
    result.push(...page);
    if (page.length < 1000) return result;
  }
}

async function loadRepos(ids: number[]): Promise<Map<number, RepoInfo>> {
  const client = getAdminClient();
  const rows: RepoInfo[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const { data, error } = await client
      .from('repositories')
      .select('id,full_name,stars,primary_language')
      .in('id', ids.slice(offset, offset + 500));
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as RepoInfo[]));
  }
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadQueue(ids: number[]): Promise<Map<number, QueueInfo>> {
  const client = getAdminClient();
  const rows: QueueInfo[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const { data, error } = await client
      .from('analysis_queue')
      .select('repository_id,discovery_score,preliminary_score,deep_score,hot_score,reasons')
      .in('repository_id', ids.slice(offset, offset + 500));
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as QueueInfo[]));
  }
  return new Map(rows.map((row) => [row.repository_id, row]));
}

function stageSummary(rows: ExecutionLog[]) {
  const durations = rows.map((row) => row.duration_ms);
  return {
    total: rows.length,
    success: rows.filter((row) => row.status === 'success').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    duration_ms: {
      mean: Math.round(durations.reduce((sum, value) => sum + value, 0) / (durations.length || 1)),
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
    tokens_in: rows.reduce((sum, row) => sum + (row.tokens_in ?? 0), 0),
    tokens_out: rows.reduce((sum, row) => sum + (row.tokens_out ?? 0), 0),
  };
}

function successful(rows: ExecutionLog[], tier: 1 | 2 | 3): ExecutionLog[] {
  const latest = new Map<number, ExecutionLog>();
  for (const row of rows) {
    if (row.tier === tier && row.status === 'success' && row.output) latest.set(row.repository_id, row);
  }
  return [...latest.values()];
}

function historicalDeepScore(row: ExecutionLog, tier2: ExecutionLog | undefined, hotScore: number): number {
  const output = tier2?.output ?? row.output ?? {};
  const mobile = Number(output.mobile_relevance ?? 0);
  const feasible = Number(output.feasibility ?? 0);
  const gap = Number(output.ecosystem_gap ?? 0);
  const confidence = Number(output.confidence ?? 0);
  if (row.prompt_version.startsWith('p9')) {
    const leverage = Number(output.harmony_leverage ?? 0.3);
    return 0.1 * hotScore + 0.2 * mobile + 0.1 * feasible + 0.15 * gap + 0.4 * leverage + 0.05 * confidence;
  }
  return 0.15 * hotScore + 0.3 * mobile + 0.25 * feasible + 0.2 * gap + 0.1 * confidence;
}

function scoreAudit(rows: ExecutionLog[]) {
  return {
    mobile_relevance: distribution(rows.map((row) => Number(row.output?.mobile_relevance))),
    feasibility: distribution(rows.map((row) => Number(row.output?.feasibility))),
    confidence: distribution(rows.map((row) => Number(row.output?.confidence))),
  };
}

function detailedOutputAudit(rows: ExecutionLog[]) {
  const points = rows.flatMap((row) =>
    (row.output?.adaptation_points ?? []).map((point: Record<string, any>) => ({ row, point })),
  );
  const kitNames = points.flatMap(({ point }) => point.target_kits ?? []).map(String);
  const integrationForms = points.map(({ point }) => String(point.integration_form));
  const genericPattern = /建议(?:进行|评估|适配)|可考虑|进一步评估|增加鸿蒙支持|适配鸿蒙平台/;
  const pathPattern = /(?:^|[\s"'`(])(?:[\w.-]+\/)+[\w.-]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|c|cc|cpp|h|hpp|java|kt|swift|ets|json|xml|gradle)\b/i;
  const genericPoints = points.filter(({ point }) => genericPattern.test(String(point.description)));
  const pathEvidencePoints = points.filter(({ point }) => pathPattern.test(String(point.evidence)));
  const unverifiableKits = kitNames.filter((kit) => kit.includes('需验证')).length;
  const suspiciousKits = kitNames.filter((kit) => /NAPI Kit|Node-API Kit|Account Kit.*(?:存储|密钥)|AVSession.*(?:采集|播放|音频管道)/i.test(kit));
  const emptyDevices = points.filter(({ point }) => !Array.isArray(point.target_devices) || point.target_devices.length === 0);
  return {
    projects: rows.length,
    points: points.length,
    points_per_project: distribution(rows.map((row) => (row.output?.adaptation_points ?? []).length)),
    generic_points: genericPoints.length,
    evidence_with_file_path: pathEvidencePoints.length,
    empty_target_devices: emptyDevices.length,
    unverifiable_kit_mentions: unverifiableKits,
    suspicious_kit_mentions: suspiciousKits,
    top_kits: frequency(kitNames, 30),
    integration_forms: frequency(integrationForms, 20),
  };
}

function markdownTable(headers: string[], rows: (string | number)[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) throw new Error('用法:pnpm audit:session <session_id>');
  const logs = await pageSessionLogs(sessionId);
  if (!logs.length) throw new Error(`session ${sessionId} 没有 AI 执行日志`);
  const ids = [...new Set(logs.map((row) => row.repository_id))];
  const [repos, queue] = await Promise.all([loadRepos(ids), loadQueue(ids)]);
  const tier1 = successful(logs, 1);
  const tier2 = successful(logs, 2);
  const tier3 = successful(logs, 3);
  const tier2ByRepo = new Map(tier2.map((row) => [row.repository_id, row]));

  const tier3Candidates = tier3
    .map((row) => {
      const hotScore = queue.get(row.repository_id)?.hot_score ?? 0;
      return {
        repository: repos.get(row.repository_id)?.full_name ?? String(row.repository_id),
        stars: repos.get(row.repository_id)?.stars ?? 0,
        deep_score: historicalDeepScore(row, tier2ByRepo.get(row.repository_id), hotScore),
        hot_score: hotScore,
        mobile_relevance: row.output?.mobile_relevance,
        feasibility: row.output?.feasibility,
        ecosystem_gap: row.output?.ecosystem_gap,
        point_count: row.output?.adaptation_points?.length ?? 0,
      };
    })
    .sort((a, b) => b.deep_score - a.deep_score);

  const tier3Deltas = tier3.map((deepRow) => {
    const base = tier2ByRepo.get(deepRow.repository_id);
    return {
      repository: repos.get(deepRow.repository_id)?.full_name ?? String(deepRow.repository_id),
      point_delta: (deepRow.output?.adaptation_points?.length ?? 0) - (base?.output?.adaptation_points?.length ?? 0),
      mobile_delta: Number(deepRow.output?.mobile_relevance ?? 0) - Number(base?.output?.mobile_relevance ?? 0),
      feasibility_delta: Number(deepRow.output?.feasibility ?? 0) - Number(base?.output?.feasibility ?? 0),
      prompt_char_delta: (deepRow.user_prompt?.length ?? 0) - (base?.user_prompt?.length ?? 0),
      output_same: JSON.stringify(deepRow.output) === JSON.stringify(base?.output),
    };
  });

  const report = {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    executions: Object.fromEntries([1, 2, 3].map((tier) => [tier, stageSummary(logs.filter((row) => row.tier === tier))])),
    tier1_scores: scoreAudit(tier1),
    tier1_statuses: frequency(tier1.map((row) => String(row.output?.harmony_suggestion))),
    tier1_categories: frequency(tier1.map((row) => String(row.output?.category)), 30),
    tier1_evidence: {
      deepwiki_indexed: tier1.filter((row) => row.evidence?.deepwiki?.indexed).length,
      readme_present: tier1.filter((row) => Number(row.evidence?.readme_chars) > 0).length,
    },
    tier2_scores: {
      ...scoreAudit(tier2),
      effort_estimate: distribution(tier2.map((row) => Number(row.output?.effort_estimate))),
      ecosystem_gap: distribution(tier2.map((row) => Number(row.output?.ecosystem_gap))),
    },
    tier2_output: detailedOutputAudit(tier2),
    tier3_scores: {
      ...scoreAudit(tier3),
      effort_estimate: distribution(tier3.map((row) => Number(row.output?.effort_estimate))),
      ecosystem_gap: distribution(tier3.map((row) => Number(row.output?.ecosystem_gap))),
    },
    tier3_output: detailedOutputAudit(tier3),
    tier3_candidates: tier3Candidates,
    tier3_vs_tier2: tier3Deltas,
    failures: logs
      .filter((row) => row.status === 'failed')
      .map((row) => ({ tier: row.tier, repository: repos.get(row.repository_id)?.full_name, error: row.error })),
  };

  const dir = join(process.cwd(), 'reports', 'session-audits');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const executionRows = [1, 2, 3].map((tier) => {
    const item = report.executions[String(tier) as keyof typeof report.executions];
    return [tier, item.total, item.success, item.failed, item.skipped, item.duration_ms.mean, item.duration_ms.p95, item.tokens_in, item.tokens_out];
  });
  const markdown = `# 分析 Session 审计\n\n- Session: \`${sessionId}\`\n- 生成时间: ${report.generated_at}\n\n## 执行概览\n\n${markdownTable(
    ['层级', '总数', '成功', '失败', '跳过', '平均耗时(ms)', 'P95(ms)', '输入Token', '输出Token'],
    executionRows,
  )}\n\n## 证据与输出质量\n\n- tier-1 DeepWiki 覆盖: ${report.tier1_evidence.deepwiki_indexed}/${tier1.length}\n- tier-1 README 覆盖: ${report.tier1_evidence.readme_present}/${tier1.length}\n- tier-2 适配点: ${report.tier2_output.points}，含文件路径证据 ${report.tier2_output.evidence_with_file_path}，泛化措辞 ${report.tier2_output.generic_points}\n- tier-2 “需验证” Kit: ${report.tier2_output.unverifiable_kit_mentions}，可疑 Kit: ${report.tier2_output.suspicious_kit_mentions.length}\n- tier-3 适配点: ${report.tier3_output.points}，含文件路径证据 ${report.tier3_output.evidence_with_file_path}\n\n## tier-3 候选\n\n${markdownTable(
    ['项目', 'Stars', 'deep score', 'hot score', '端侧价值', '可行性', '生态缺口', '适配点'],
    tier3Candidates.map((row) => [row.repository, row.stars, row.deep_score.toFixed(3), row.hot_score.toFixed(3), row.mobile_relevance, row.feasibility, row.ecosystem_gap, row.point_count]),
  )}\n\n## 失败\n\n${report.failures.length ? report.failures.map((row) => `- tier-${row.tier} ${row.repository}: ${row.error}`).join('\n') : '- 无'}\n`;
  writeFileSync(join(dir, `${sessionId}.md`), markdown, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
