import {
  EXTERNAL_SOURCES,
  type BriefingFieldDefinition,
  type BriefingSchema,
  type BriefingSource,
  type ConfirmationPolicy,
} from "../../domain/briefing/briefing.model.js";
import type { AssetMetadataSourcePort } from "../ports/asset-metadata-source.port.js";
import type { CompanyKnowledgeSourcePort } from "../ports/company-knowledge-source.port.js";
import { extractOpportunistic, extractQuotedPhrase, type ExtractedFieldValue } from "./extraction.js";

/**
 * Context Resolver — Sprint 07 (Fase 4). Preenche campos AINDA faltantes depois que a mensagem
 * atual e a pergunta pendente já foram interpretadas pelo orquestrador (Ordem de interpretação,
 * passos 1-4 — isso é responsabilidade dele, não deste módulo). Cobre a cauda da ordem de fontes
 * descrita na Sprint 07B: (2) mensagem atual [oportunista], (3+4) eventos/memória da conversa
 * [dobrados em `conversation_memory`, já que a Sprint 06 promove entidades de eventos para
 * `ConversationMemory` — não existe uma fonte "evento" separada em `BriefingSource`], (5)
 * Workspace, (6) Company Knowledge, (7) Asset Library — sempre restrito ao `sourcePriority`
 * declarado em cada `BriefingFieldDefinition`. Fonte indisponível nunca quebra o turno: qualquer
 * exceção de uma porta externa é tratada como "sem sugestão desta fonte".
 */

export type FieldSourceCandidate = {
  fieldKey: string;
  source: BriefingSource;
  value: string;
  normalizedValue: string;
  confidence: number;
  requiresConfirmation: boolean;
  matchedRule: string;
};

export type ResolveContextInput = {
  schema: BriefingSchema;
  missingFieldKeys: readonly string[];
  workspaceId: string;
  currentMessageText: string;
  /** Entidades já conhecidas pela ConversationMemory/eventos da Sprint 06, indexadas por fieldKey. */
  conversationMemoryValues?: Readonly<Record<string, string>>;
  /** Únicos dados de Workspace hoje habilitados a sugerir algo: canais conectados (Fase 4,
   * exemplo do Instagram único). Deliberadamente estreito — não é o Workspace inteiro. */
  workspaceConnectedChannels?: readonly string[];
};

export type ResolveContextDeps = {
  companyKnowledgeSource: CompanyKnowledgeSourcePort;
  assetMetadataSource: AssetMetadataSourcePort;
};

/** `required_for_external_source` só exige confirmação para fontes verdadeiramente externas —
 * `conversation_memory` fica de fora porque o valor já veio do próprio usuário em um turno
 * anterior (é lembrança, não inferência). */
function requiresConfirmation(policy: ConfirmationPolicy, source: BriefingSource): boolean {
  if (policy === "never_required") return false;
  if (policy === "always_required") return true;
  return source !== "user_message" && EXTERNAL_SOURCES.includes(source);
}

async function resolveOneField(
  field: BriefingFieldDefinition,
  input: ResolveContextInput,
  deps: ResolveContextDeps,
  messageExtractions: readonly ExtractedFieldValue[],
): Promise<FieldSourceCandidate | undefined> {
  for (const source of field.sourcePriority) {
    if (source === "user_message") {
      const extracted = messageExtractions.find((candidate) => candidate.fieldKey === field.key);
      if (extracted && extracted.ambiguityStatus !== "ambiguous") {
        return {
          fieldKey: field.key,
          source,
          value: extracted.value,
          normalizedValue: extracted.normalizedValue,
          confidence: extracted.confidence,
          requiresConfirmation: requiresConfirmation(field.confirmationPolicy, source),
          matchedRule: extracted.matchedRule,
        };
      }
      continue;
    }

    if (source === "conversation_memory") {
      const remembered = input.conversationMemoryValues?.[field.key];
      if (remembered && remembered.trim().length > 0) {
        return {
          fieldKey: field.key,
          source,
          value: remembered,
          normalizedValue: remembered.trim().toLowerCase(),
          confidence: 0.75,
          requiresConfirmation: requiresConfirmation(field.confirmationPolicy, source),
          matchedRule: "source:conversation-memory",
        };
      }
      continue;
    }

    if (source === "workspace") {
      if (field.key === "channel" && input.workspaceConnectedChannels && input.workspaceConnectedChannels.length === 1) {
        const only = input.workspaceConnectedChannels[0];
        return {
          fieldKey: field.key,
          source,
          value: only,
          normalizedValue: only.toLowerCase(),
          confidence: 0.6,
          requiresConfirmation: requiresConfirmation(field.confirmationPolicy, source),
          matchedRule: "source:workspace-single-connected-channel",
        };
      }
      continue;
    }

    if (source === "company_knowledge") {
      const suggestions = await safeCall(() =>
        deps.companyKnowledgeSource.suggestFields({ workspaceId: input.workspaceId, fieldKeys: [field.key] }),
      );
      const match = suggestions?.find((suggestion) => suggestion.fieldKey === field.key);
      if (match) {
        return {
          fieldKey: field.key,
          source,
          value: match.value,
          normalizedValue: match.value.trim().toLowerCase(),
          confidence: match.confidence,
          requiresConfirmation: requiresConfirmation(field.confirmationPolicy, source),
          matchedRule: "source:company-knowledge",
        };
      }
      continue;
    }

    if (source === "asset_metadata") {
      const nameQuery = extractQuotedPhrase(input.currentMessageText);
      if (!nameQuery) continue;
      const matches = await safeCall(() => deps.assetMetadataSource.findByName({ workspaceId: input.workspaceId, nameQuery }));
      if (matches && matches.length === 1) {
        return {
          fieldKey: field.key,
          source,
          value: matches[0].name,
          normalizedValue: matches[0].name.trim().toLowerCase(),
          confidence: 0.7,
          requiresConfirmation: requiresConfirmation(field.confirmationPolicy, source),
          matchedRule: "source:asset-metadata",
        };
      }
      continue;
    }
  }
  return undefined;
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/** Ponto de entrada do Context Resolver: para cada campo faltante, tenta preencher seguindo
 * `field.sourcePriority`. Nunca retorna mais de um candidato por campo — a primeira fonte
 * disponível na prioridade declarada vence; fontes não listadas no `sourcePriority` do campo nunca
 * são consultadas (ex.: `desiredAction` não lista `asset_metadata`, então essa porta nunca é
 * chamada para ele). */
export async function resolveFieldCandidates(input: ResolveContextInput, deps: ResolveContextDeps): Promise<FieldSourceCandidate[]> {
  const missing = new Set(input.missingFieldKeys);
  const messageExtractions = extractOpportunistic(input.schema, input.currentMessageText, new Set());
  const fields = input.schema.fields.filter((field) => missing.has(field.key));

  const results: FieldSourceCandidate[] = [];
  for (const field of fields) {
    const candidate = await resolveOneField(field, input, deps, messageExtractions);
    if (candidate) results.push(candidate);
  }
  return results;
}
