const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/legend/Desktop/Code/github-analytics/.env' });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const CATEGORY_LABELS = {
  UI_FRAMEWORK: 'UI 框架', CROSS_PLATFORM: '跨端框架', NETWORK_LIB: '网络库',
  DATABASE: '数据存储', AI_ML: 'AI/ML', DEV_TOOL: '开发工具', CLI: '命令行工具',
  BUILD_TOOL: '构建工具', UTILITY_LIB: '通用工具库', MEDIA: '多媒体',
  GRAPHICS_GAME: '图形/游戏', SECURITY: '安全', MOBILE_APP: '移动应用',
  DESKTOP_APP: '桌面应用', SERVER_BACKEND: '服务端/后端', LEARNING_DOCS: '学习/文档', OTHER: '其它',
};
const HARMONY_STATE_LABELS = { ADAPTED: '已鸿蒙化', PARTIAL: '部分适配', NOT_ADAPTED: '未适配', NOT_APPLICABLE: '不适用' };

async function main() {
  const ids = [132750724,21737465,28457823,54346799,13491895,1103012935,85077558,83222441,60493101,21289110,36633370,177736533,88011908,1073224795,10270250,2325298,138393139,1136590548,63476337,1024554267,11730342,19415064,126577260,45717250,193215554,1197021090,1142983825,291137,41881900,614765452,121395510,14440270,808144141,975734319,123458551,233472199,31792824,21540759,307260205,658928958,1062897,2126244,574523116,58028038,888092115,527591471,155220641,1148788086,35955666,1061953414];
  
  const { data, error } = await sb.from('repo_board').select('*').in('id', ids).order('stars', { ascending: false });
  if (error) { console.error(error); return; }
  
  console.log('='.repeat(100));
  console.log('Top 50 项目鸿蒙生态分析报告 (v2 - 生态端到端视角)');
  console.log('='.repeat(100));
  console.log();
  
  // 统计
  const harmonyStats = { ADAPTED: 0, PARTIAL: 0, NOT_ADAPTED: 0, NOT_APPLICABLE: 0, null: 0 };
  const catStats = {};
  let gitcodeHits = 0;
  let adaptedUrls = 0;
  
  data.forEach(r => {
    const key = r.harmony_suggestion || 'null';
    harmonyStats[key]++;
    const cat = r.category || 'OTHER';
    if (!catStats[cat]) catStats[cat] = 0;
    catStats[cat]++;
    if (r.gitcode_matched) gitcodeHits++;
    if (r.harmony_adapted_repo_url) adaptedUrls++;
  });
  
  console.log('【LLM 鸿蒙化建议统计】');
  Object.entries(harmonyStats).forEach(([state, count]) => {
    if (count > 0) {
      const label = state === 'null' ? '未评估' : HARMONY_STATE_LABELS[state];
      console.log(`  ${label}: ${count} 个项目`);
    }
  });
  console.log();
  
  console.log(`【GitCode 命中: ${gitcodeHits} 个项目】`);
  data.filter(r => r.gitcode_matched).forEach(r => {
    console.log(`  - ${r.full_name}: ${r.gitcode_repo_url}`);
  });
  console.log();
  
  console.log(`【已知鸿蒙适配仓: ${adaptedUrls} 个项目】`);
  data.filter(r => r.harmony_adapted_repo_url).forEach(r => {
    console.log(`  - ${r.full_name}: ${r.harmony_adapted_repo_url}`);
  });
  console.log();
  
  console.log('【分类统计】');
  Object.entries(catStats).sort((a,b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${CATEGORY_LABELS[cat] || cat}: ${count} 个项目`);
  });
  console.log();
  
  console.log('【详细分析结果 (按 Stars 排序)】');
  console.log('-'.repeat(100));
  data.forEach((r, i) => {
    console.log(`${i+1}. ${r.full_name}`);
    console.log(`   Stars: ${r.stars?.toLocaleString()} | 语言: ${r.primary_language || '-'}`);
    console.log(`   描述: ${(r.description || '-').slice(0, 80)}${(r.description || '').length > 80 ? '...' : ''}`);
    console.log(`   分类: ${CATEGORY_LABELS[r.category] || r.category || '-'}`);
    console.log(`   LLM建议: ${HARMONY_STATE_LABELS[r.harmony_suggestion] || '未评估'}`);
    console.log(`   生态价值: ${r.mobile_relevance !== null ? (r.mobile_relevance * 100).toFixed(0) + '%' : '-'}`);
    console.log(`   可行性: ${r.feasibility !== null ? (r.feasibility * 100).toFixed(0) + '%' : '-'}`);
    console.log(`   优先级评分: ${r.priority_score?.toFixed(1) || '-'}`);
    if (r.gitcode_matched) console.log(`   🎯 GitCode: ${r.gitcode_repo_url}`);
    if (r.harmony_adapted_repo_url) console.log(`   🔗 鸿蒙版本: ${r.harmony_adapted_repo_url}`);
    if (r.recommended_approach) console.log(`   💡 推荐: ${r.recommended_approach.slice(0, 120)}`);
    if (r.reasoning) console.log(`   📝 ${(r.reasoning || '').slice(0, 200)}`);
    console.log();
  });
}

main().catch(console.error);
