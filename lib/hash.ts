// 稳定输入哈希:用于 LLM 分析幂等(输入 + prompt 版本 + 模型 不变则跳过)。
// 纯 JS 实现(FNV-1a 64-bit 变体),无需 node:crypto,可在任意运行时使用。

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function stableHash(value: unknown): string {
  const str = stableStringify(value);
  // FNV-1a 64-bit,用 BigInt 保证无溢出。
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
