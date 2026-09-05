// GitCode 搜索:查找 GitHub 项目在 GitCode 上是否已有鸿蒙(HarmonyOS/OpenHarmony)适配版本。
import * as cheerio from 'cheerio';
import { sleep } from '@/lib/ratelimit/limiter';

export interface GitCodeResult {
  matched: boolean;
  repo_url: string | null;
  repo_name: string | null;
  description: string | null;
}

const GITCODE_SEARCH_URL = 'https://gitcode.com/search';

/** 鸿蒙官方组织(SIG/TPC)维护的适配仓,可信度远高于个人/镜像仓。 */
const TRUSTED_ORG_RE = /gitcode\.com\/(openharmony-sig|openharmony-tpc|openharmony)\//i;

export function isTrustedGitcodeOrg(url: string | null | undefined): boolean {
  return !!url && TRUSTED_ORG_RE.test(url);
}

const HARMONY_RE = /openharmony|harmonyos|ohos|鸿蒙|harmony/i;

/** 搜索关键词组合 */
function buildSearchQueries(repoName: string): string[] {
  return [
    `${repoName} openharmony`,
    `${repoName} harmony`,
    `${repoName} ohos`,
  ];
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[-_.\s]/g, '');
}

/**
 * 判定搜索结果是否为原项目的疑似适配仓:
 * 必须同时满足「鸿蒙相关」与「名称匹配」(此前二者取或,导致大量误报)。
 * 名称过短(<3 归一化字符)无法可靠匹配,直接排除。
 */
function isAdaptationCandidate(name: string, desc: string, url: string, repoName: string): boolean {
  if (!HARMONY_RE.test(`${name} ${desc} ${url}`)) return false;
  const target = normalizeName(repoName);
  if (target.length < 3) return false;
  const lastSeg = url.split('/').filter(Boolean).pop() ?? '';
  return normalizeName(name).includes(target) || normalizeName(lastSeg).includes(target);
}

/** 解析 GitCode 搜索结果页,官方组织仓优先。 */
function parseSearchResults(html: string, repoName: string): GitCodeResult | null {
  const $ = cheerio.load(html);
  const candidates: { url: string; name: string; desc: string }[] = [];
  const seen = new Set<string>();

  const push = (href: string | undefined, name: string, desc: string) => {
    if (!href || !name) return;
    const url = href.startsWith('http') ? href : `https://gitcode.com${href}`;
    if (seen.has(url) || !isAdaptationCandidate(name, desc, url, repoName)) return;
    seen.add(url);
    candidates.push({ url, name, desc });
  };

  $('a[href*="/project/"]').each((_, el) => {
    push($(el).attr('href'), $(el).text().trim(), '');
  });
  $('.project-item, .search-item, [class*="project"]').each((_, el) => {
    const link = $(el).find('a[href*="/project/"]').first();
    push(
      link.attr('href'),
      link.text().trim(),
      $(el).find('.description, .desc, p').first().text().trim(),
    );
  });

  if (candidates.length === 0) return null;

  const best = candidates.find((c) => isTrustedGitcodeOrg(c.url)) ?? candidates[0];
  return {
    matched: true,
    repo_url: best.url,
    repo_name: best.name,
    description: best.desc || null,
  };
}

/** 搜索单个项目在 GitCode 上的鸿蒙适配版本 */
export async function searchGitCode(repoName: string): Promise<GitCodeResult> {
  const queries = buildSearchQueries(repoName);
  
  for (const query of queries) {
    try {
      const params = new URLSearchParams({ q: query, type: 'project' });
      const url = `${GITCODE_SEARCH_URL}?${params}`;
      
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      
      if (!resp.ok) {
        await sleep(1000);
        continue;
      }
      
      const html = await resp.text();
      const result = parseSearchResults(html, repoName);
      
      if (result) return result;
      
      // 限流:避免请求过快
      await sleep(500);
    } catch {
      await sleep(1000);
    }
  }
  
  return { matched: false, repo_url: null, repo_name: null, description: null };
}
