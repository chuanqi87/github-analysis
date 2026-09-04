// 只读迁移预检查；不调用 GitHub / DeepWiki / LLM，也不创建运行记录。
import 'dotenv/config';
import { assertAnalysisSchema } from '@/lib/pipeline/schema-check';

assertAnalysisSchema()
  .then(() => console.log('数据库结构预检查通过：支持现状与生态机会字段均可查询。'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
