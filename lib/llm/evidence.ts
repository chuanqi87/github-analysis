import type { DeepwikiFacts } from '@/lib/deepwiki';
import type { CollectedSignals } from '@/lib/harmony/signals';
import type { EvaluateResult } from '@/lib/llm/schema';

/** 只由当前仓库材料组成，明确排除历史分析，供输出证据做机械校验。 */
export function buildCurrentEvidenceCorpus(
  signals: CollectedSignals,
  facts?: DeepwikiFacts | null,
  readme?: string | null,
): string {
  return [
    JSON.stringify({
      support_evidence: signals.support_evidence,
      ohpm_packages: signals.ohpm_packages,
      source_repo_url: signals.source_repo_url,
      ecosystem_port_url: signals.gitcode_repo_url,
      ecosystem_port_name: signals.gitcode_repo_name,
      ecosystem_port_capabilities: signals.ecosystem_port_capabilities,
      ecosystem_port_evidence_urls: signals.ecosystem_port_evidence_urls,
      registry_source: signals.registry_source,
    }),
    facts ? JSON.stringify(facts) : '',
    readme ?? '',
  ].join('\n').toLowerCase();
}

function referenceTokens(reference: string): string[] {
  const normalized = reference.replace(/[`"'“”‘’]/g, '').trim().toLowerCase();
  const urls = normalized.match(/https?:\/\/[^\s，。；;)]+/g) ?? [];
  const paths = normalized.match(/(?:[a-z0-9_.@+-]+\/)+[a-z0-9_.@+-]+/g) ?? [];
  return [...new Set([...urls, ...paths, normalized])]
    .map((token) => token.replace(/[),，。；;:]+$/, ''))
    .filter((token) => token.length >= 4);
}

export function isCurrentEvidenceReference(reference: string, corpus: string): boolean {
  if (!reference.trim()) return false;
  return referenceTokens(reference).some((token) => corpus.includes(token));
}

function verifiedReferences(references: string[], corpus: string): string[] {
  return references.filter((reference) => isCurrentEvidenceReference(reference, corpus));
}

/**
 * 模型只能从当前证据语料中“复制”证据引用。历史仓路径和自行推断的路径即使通过
 * JSON schema，也会在落库前被清除；失去全部证据的机会随后由机会门槛过滤掉。
 */
export function sanitizeEvaluateEvidence(result: EvaluateResult, corpus: string): EvaluateResult {
  return {
    ...result,
    opportunities: result.opportunities.map((opportunity) => ({
      ...opportunity,
      evidence_refs: verifiedReferences(opportunity.evidence_refs, corpus),
    })),
    analysis_details: {
      ...result.analysis_details,
      architecture: {
        ...result.analysis_details.architecture,
        evidence_refs: verifiedReferences(result.analysis_details.architecture.evidence_refs, corpus),
      },
      historical_reuse: result.analysis_details.historical_reuse.map((reuse) => ({
        ...reuse,
        current_repo_evidence: verifiedReferences(reuse.current_repo_evidence, corpus),
      })),
      rejected_options: result.analysis_details.rejected_options.map((option) => ({
        ...option,
        evidence_refs: verifiedReferences(option.evidence_refs, corpus),
      })),
    },
  };
}
