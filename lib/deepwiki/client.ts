// DeepWiki MCP 客户端(JSON-RPC over HTTP,响应为 SSE 帧)。
//
// 为什么不引 MCP SDK:实测该服务的 tools/call 是**无状态**的 —— 无需 initialize
// 握手、无需 mcp-session-id,直接 POST 即可。一个 SDK 换 60 行代码不划算。
//
// 实测要点(见 docs/deepwiki-redesign.md §2):
//   - 无鉴权、无官方限额说明 → deepwikiLimiter 保守并发
//   - 响应即使是单次调用也走 SSE 分帧,须逐行解析 `data: `
//   - 仓库未索引时返回的是**正常响应**(isError:false),靠文案判定,不能看 HTTP 状态码
import { deepwikiLimiter, withRetry } from '@/lib/ratelimit/limiter';

const MCP_ENDPOINT = 'https://mcp.deepwiki.com/mcp';

/** ask_question 实测 7~14s,留足余量;超时按失败重试。 */
const TIMEOUT_MS = 60_000;

/** 未索引仓库的返回文案特征(DeepWiki 侧固定措辞)。 */
const NOT_INDEXED_MARKER = 'Repository not found';
const EMBEDDED_ERROR_MARKERS = [
  'Error processing question:',
  'Too Many Requests',
  'Internal Server Error',
  'Service Unavailable',
  'Gateway Timeout',
];

export class DeepwikiNotIndexedError extends Error {
  constructor(public readonly repoName: string) {
    super(`DeepWiki 未索引该仓库:${repoName}`);
    this.name = 'DeepwikiNotIndexedError';
  }
}

interface JsonRpcResponse {
  result?: {
    content?: { type: string; text: string }[];
    structuredContent?: { result?: string };
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/**
 * 解析 SSE 响应体,取出第一帧 JSON-RPC 结果。
 * 帧格式:`event: message\ndata: {...}\n\n`
 */
function parseSseFrame(body: string): JsonRpcResponse {
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      return JSON.parse(line.slice(6)) as JsonRpcResponse;
    } catch {
      // 非 JSON 的 data 行(如心跳)跳过,继续找下一帧
    }
  }
  throw new Error(`DeepWiki 响应中未找到有效的 data 帧:${body.slice(0, 200)}`);
}

let requestId = 0;

/** 调用一个 DeepWiki MCP 工具,返回其文本结果。 */
async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  return withRetry(
    () =>
      deepwikiLimiter.schedule(async () => {
        const res = await fetch(MCP_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // 缺这个 Accept 头服务端会拒绝
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++requestId,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) throw new Error(`DeepWiki ${res.status} @ ${name}`);

        const parsed = parseSseFrame(await res.text());
        if (parsed.error) throw new Error(`DeepWiki RPC 错误:${parsed.error.message}`);

        const text = parsed.result?.structuredContent?.result ?? parsed.result?.content?.[0]?.text;
        if (typeof text !== 'string') {
          throw new Error(`DeepWiki 返回结构异常 @ ${name}`);
        }
        // DeepWiki 偶尔用 HTTP 200 / isError:false 包装下游 429/5xx 文本。
        // 这不是有效答案，必须抛出让 withRetry 接管，不能污染事实缓存。
        const embeddedError = EMBEDDED_ERROR_MARKERS.find((marker) => text.includes(marker));
        if (embeddedError) {
          throw new Error(`DeepWiki 内嵌错误 @ ${name}:${embeddedError}`);
        }
        return text;
      }),
    {
      // 下游会短暂返回包装在成功响应里的限流错误；错峰长退避后再试，
      // 比把错误文本当事实或立即打满重试更可靠。
      retries: 4,
      baseMs: 2_000,
      label: `deepwiki ${name} ${String(args.repoName ?? '')}`,
    },
  );
}

/** 未索引不是"错误",是需要向上传递的一种正常状态 → 抛专用错误类型便于识别。 */
function assertIndexed(repoName: string, text: string): string {
  if (text.includes(NOT_INDEXED_MARKER)) throw new DeepwikiNotIndexedError(repoName);
  return text;
}

/**
 * 获取仓库的文档目录(~2KB / ~1s)。
 * 这是最廉价的信号:不花 token 就能看出项目的模块构成。
 */
export async function readWikiStructure(repoName: string): Promise<string> {
  return assertIndexed(repoName, await callTool('read_wiki_structure', { repoName }));
}

/**
 * 就仓库提一个定向问题(~7~14s)。
 *
 * 注意:**不要**用 read_wiki_contents —— 实测小项目就返回 685KB,无法喂给 LLM。
 * 定向提问是唯一可控的深度取数方式。
 */
export async function askQuestion(repoName: string, question: string): Promise<string> {
  return assertIndexed(repoName, await callTool('ask_question', { repoName, question }));
}

/** 探测仓库是否已被 DeepWiki 索引(用结构接口,最廉价)。 */
export async function isIndexed(repoName: string): Promise<boolean> {
  try {
    await readWikiStructure(repoName);
    return true;
  } catch (err) {
    if (err instanceof DeepwikiNotIndexedError) return false;
    throw err;
  }
}
