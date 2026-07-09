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

/** 搜索关键词组合 */
function buildSearchQueries(repoName: string): string[] {
  return [
    `${repoName} openharmony`,
    `${repoName} harmony`,
    `${repoName} ohos`,
  ];
}

/** 解析 GitCode 搜索结果页 */
function parseSearchResults(html: string, repoName: string): GitCodeResult | null {
  const $ = cheerio.load(html);
  
  // 查找搜索结果中的仓库链接
  const results: { url: string; name: string; desc: string }[] = [];
  
  // GitCode 搜索结果通常在 .search-result-list 或类似结构中
  $('a[href*="/project/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text) {
      const url = href.startsWith('http') ? href : `https://gitcode.com${href}`;
      // 检查是否包含鸿蒙相关关键词
      const isHarmonyRelated = 
        text.toLowerCase().includes('openharmony') ||
        text.toLowerCase().includes('harmony') ||
        text.toLowerCase().includes('ohos') ||
        text.toLowerCase().includes('鸿蒙');
      
      // 检查仓库名是否匹配原项目
      const nameLower = text.toLowerCase();
      const repoNameLower = repoName.toLowerCase();
      const isNameMatch = nameLower.includes(repoNameLower) || 
                          repoNameLower.includes(nameLower.split('/')[nameLower.split('/').length - 1]);
      
      if (isHarmonyRelated || isNameMatch) {
        results.push({ url, name: text, desc: '' });
      }
    }
  });
  
  // 也查找 .project-item 或类似结构
  $('.project-item, .search-item, [class*="project"]').each((_, el) => {
    const link = $(el).find('a[href*="/project/"]').first();
    const href = link.attr('href');
    const name = link.text().trim();
    const desc = $(el).find('.description, .desc, p').first().text().trim();
    
    if (href && name) {
      const url = href.startsWith('http') ? href : `https://gitcode.com${href}`;
      const nameLower = name.toLowerCase();
      const descLower = desc.toLowerCase();
      
      const isHarmonyRelated = 
        nameLower.includes('openharmony') ||
        nameLower.includes('harmony') ||
        nameLower.includes('ohos') ||
        nameLower.includes('鸿蒙') ||
        descLower.includes('openharmony') ||
        descLower.includes('harmony') ||
        descLower.includes('ohos') ||
        descLower.includes('鸿蒙');
      
      if (isHarmonyRelated) {
        results.push({ url, name, desc });
      }
    }
  });
  
  if (results.length === 0) return null;
  
  // 优先选择名称最匹配的
  const best = results.find(r => r.name.toLowerCase().includes(repoName.toLowerCase())) || results[0];
  
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

/** 已知的鸿蒙适配仓库映射表(人工维护的高置信度数据) */
export const KNOWN_HARMONY_ADAPTATIONS: Record<string, { url: string; name: string }> = {
  'flutter/flutter': { url: 'https://gitcode.com/openharmony-sig/flutter_flutter', name: 'openharmony-sig/flutter_flutter' },
  'facebook/react-native': { url: 'https://gitcode.com/openharmony-sig/react-native', name: 'openharmony-sig/react-native' },
  'vuejs/vue': { url: 'https://gitcode.com/openharmony-sig/vue', name: 'openharmony-sig/vue' },
  'tensorflow/tensorflow': { url: 'https://gitcode.com/openharmony-sig/tensorflow', name: 'openharmony-sig/tensorflow' },
  'pytorch/pytorch': { url: 'https://gitcode.com/openharmony-sig/pytorch', name: 'openharmony-sig/pytorch' },
  'opencv/opencv': { url: 'https://gitcode.com/openharmony-sig/opencv', name: 'openharmony-sig/opencv' },
  'grpc/grpc': { url: 'https://gitcode.com/openharmony-sig/grpc', name: 'openharmony-sig/grpc' },
  'protocolbuffers/protobuf': { url: 'https://gitcode.com/openharmony-sig/protobuf', name: 'openharmony-sig/protobuf' },
  'nlohmann/json': { url: 'https://gitcode.com/openharmony-sig/json', name: 'openharmony-sig/json' },
  'fmtlib/fmt': { url: 'https://gitcode.com/openharmony-sig/fmt', name: 'openharmony-sig/fmt' },
  'catchorg/Catch2': { url: 'https://gitcode.com/openharmony-sig/Catch2', name: 'openharmony-sig/Catch2' },
  'boostorg/boost': { url: 'https://gitcode.com/openharmony-sig/boost', name: 'openharmony-sig/boost' },
  'openssl/openssl': { url: 'https://gitcode.com/openharmony-sig/openssl', name: 'openharmony-sig/openssl' },
  'curl/curl': { url: 'https://gitcode.com/openharmony-sig/curl', name: 'openharmony-sig/curl' },
  'sqlite/sqlite': { url: 'https://gitcode.com/openharmony-sig/sqlite', name: 'openharmony-sig/sqlite' },
};

/** 带已知映射的搜索:先查已知表,再搜索 */
export async function searchGitCodeWithKnown(fullName: string, repoName: string): Promise<GitCodeResult> {
  // 先查已知映射
  const known = KNOWN_HARMONY_ADAPTATIONS[fullName];
  if (known) {
    return { matched: true, repo_url: known.url, repo_name: known.name, description: '已知鸿蒙适配仓库(人工维护)' };
  }
  
  // 再搜索
  return searchGitCode(repoName);
}
