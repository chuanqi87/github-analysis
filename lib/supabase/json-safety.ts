const REPLACEMENT_CHARACTER = '\ufffd';

/**
 * PostgreSQL jsonb/text 不接受 NUL 或孤立的 UTF-16 surrogate。
 * 外部模型文本进入 PostgREST 请求前统一替换，避免单条异常拖垮整批写入。
 */
export function sanitizePostgresText(value: string): string {
  let result = '';

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      result += REPLACEMENT_CHARACTER;
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        result += value[index] + value[index + 1];
        index++;
      } else {
        result += REPLACEMENT_CHARACTER;
      }
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      result += REPLACEMENT_CHARACTER;
      continue;
    }
    result += value[index];
  }

  return result;
}

/** 递归清洗准备写入 jsonb 的 JSON 值；非 JSON 对象保持原样。 */
export function sanitizePostgresJson<T>(value: T): T {
  if (typeof value === 'string') return sanitizePostgresText(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizePostgresJson(item)) as T;
  if (value === null || typeof value !== 'object') return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizePostgresJson(item)]),
  ) as T;
}
