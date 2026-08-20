import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { IcaroAIRequest, IcaroAIResponse } from "../../application/ai/icaro.types.js";
import {
  DeveloperAssistancePendingError,
  type DeveloperAssistanceFieldSchema,
  type DeveloperAssistanceWorkPackage,
} from "../../application/ai/developer-assistance.types.js";
import type { ArtifactDeliveryPort } from "../../application/ports/artifact-delivery.port.js";
import { sanitizePathSegment } from "../artifacts/local-artifact-delivery.js";
import type { ArtifactProvenance } from "../../shared/utils/artifact-provenance.js";

/** Migração "GPT como motor criativo único" (PR 3/9) — o pacote de trabalho é só a REQUISIÇÃO
 * (prompt/contexto/schema) entregue a um humano/IDE, nunca conteúdo final; a resposta real chega
 * por fora do `ArtifactDeliveryPort` (lida via `readFile`, nunca tem sidecar). */
const WORK_PACKAGE_PROVENANCE: ArtifactProvenance = {
  producer: "developer_assisted",
  publishable: false,
  reason: "Pacote de trabalho (prompt/contexto/schema) para intervenção assistida — nunca o conteúdo final.",
};

export type DeveloperAssistedIcaroProviderOptions = {
  artifactDelivery: ArtifactDeliveryPort;
  now?: () => Date;
};

const PROVIDER_ID = "developer-ai-assisted";
const PROVIDER_NAME = "IA desenvolvedora (VS Code, Developer Assisted Mode)";
const MODEL_ID = "developer-ai";

/**
 * Implementa `IcaroBrainPort` transformando cada chamada de uma Skill em um pacote de trabalho
 * estruturado (prompt completo + contexto + schema esperado) salvo em disco, e aguardando a IA
 * desenvolvedora do VS Code salvar a resposta real no caminho indicado — o mesmo mecanismo de
 * integração por arquivo + pausa/retomada de workflow já usado por Pedro (imagem) e Rafa (vídeo),
 * agora estendido para texto, estratégia, análise e direção criativa.
 *
 * Nunca inicia processo algum, nunca chama nenhum provider externo (OpenAI/Gemini/Claude API) e
 * nunca acopla a Skill chamadora à interface do VS Code — a única superfície de integração são os
 * dois arquivos JSON (pacote de trabalho e resposta) dentro de `artifacts/<executionId>/icaro/`.
 *
 * Quando a resposta esperada ainda não existe (ou existe mas não passa na validação estrutural
 * mínima), lança `DeveloperAssistancePendingError` — cada Skill dependente de `IcaroBrainPort`
 * deve capturar esse erro especificamente (ver `src/shared/utils/developer-ai-assistance.ts`) e
 * devolver `status: "needs_developer_ai"` para que Caio pause o workflow em
 * `WAITING_DEVELOPER_AI`, permitindo retomada idempotente via `--continue` assim como já acontece
 * para imagem/vídeo.
 */
export class DeveloperAssistedIcaroProvider implements IcaroBrainPort {
  private readonly artifactDelivery: ArtifactDeliveryPort;
  private readonly now: () => Date;

  constructor(options: DeveloperAssistedIcaroProviderOptions) {
    this.artifactDelivery = options.artifactDelivery;
    this.now = options.now ?? (() => new Date());
  }

  async request(request: IcaroAIRequest): Promise<IcaroAIResponse> {
    const executionId = request.executionId?.trim();
    const taskId = request.taskId?.trim();
    if (!executionId || !taskId) {
      throw new Error(
        "DeveloperAssistedIcaroProvider exige executionId e taskId em IcaroAIRequest para montar o pacote de trabalho.",
      );
    }

    const safeSpecialistId = sanitizePathSegment(request.specialistId || "especialista-desconhecido");
    const workPackagePath = `icaro/${taskId}-${safeSpecialistId}.package.json`;
    const expectedResponsePath = `icaro/${taskId}-${safeSpecialistId}.response.json`;

    const existing = await this.artifactDelivery.readFile({ executionId, relativePath: expectedResponsePath });

    let validationErrors: string[] | undefined;
    if (existing) {
      const rawText = Buffer.from(existing.data).toString("utf8");
      validationErrors = validateStructuredResponse(request.specialistId, rawText);
      if (validationErrors.length === 0) {
        return this.buildCompletedResponse(request, rawText);
      }
    }

    const workPackage = this.buildWorkPackage(request, { executionId, taskId, workPackagePath, expectedResponsePath, validationErrors });
    await this.artifactDelivery.writeFile({
      executionId,
      relativePath: workPackagePath,
      content: JSON.stringify(workPackage, null, 2),
      mimeType: "application/json",
      provenance: WORK_PACKAGE_PROVENANCE,
    });
    throw new DeveloperAssistancePendingError(workPackage);
  }

  private buildWorkPackage(
    request: IcaroAIRequest,
    context: { executionId: string; taskId: string; workPackagePath: string; expectedResponsePath: string; validationErrors?: string[] },
  ): DeveloperAssistanceWorkPackage {
    const resumeCommand = `npm run zuno -- --continue ${context.executionId}`;
    const instruction = context.validationErrors?.length
      ? [
          "A resposta anterior foi rejeitada por não seguir o formato esperado:",
          ...context.validationErrors.map((error) => `  - ${error}`),
          `Corrija e salve novamente o JSON em: ${context.expectedResponsePath}`,
          `(pacote de trabalho completo em: ${context.workPackagePath})`,
        ].join("\n")
      : `Produza a resposta real desta tarefa seguindo o prompt e o schema abaixo, e salve-a como JSON em: ${context.expectedResponsePath} (pacote de trabalho completo em: ${context.workPackagePath})`;

    return {
      executionId: context.executionId,
      stepId: context.taskId,
      taskId: context.taskId,
      specialistId: request.specialistId,
      taskType: request.taskType,
      prompt: request.prompt,
      context: request.context,
      constraints: request.constraints,
      responseSchema: schemaFor(request.specialistId),
      workPackagePath: context.workPackagePath,
      expectedResponsePath: context.expectedResponsePath,
      instruction,
      resumeCommand,
      createdAt: this.now().toISOString(),
      validationErrors: context.validationErrors,
    };
  }

  private buildCompletedResponse(request: IcaroAIRequest, rawText: string): IcaroAIResponse {
    return {
      status: "completed",
      provider: { id: PROVIDER_ID, name: PROVIDER_NAME },
      model: { id: MODEL_ID },
      durationMs: 0,
      tokens: {
        input: request.prompt.length,
        output: rawText.length,
        total: request.prompt.length + rawText.length,
      },
      cost: { estimated: 0, actual: 0, currency: "USD" },
      content: rawText,
      warnings: [],
      attempt: { total: 1, providerAttempt: 1, providerId: PROVIDER_ID },
      fallbackUsed: false,
    };
  }
}

/**
 * Schemas de referência (não exaustivos para Skills com dezenas de campos opcionais, como a
 * Bianca) construídos a partir dos tipos `XEnhancement`/`MariaStructuredCopy` que cada Skill já
 * declara — usados apenas para (a) documentar à IA desenvolvedora o formato esperado dentro do
 * pacote de trabalho e (b) validação estrutural mínima ("pelo menos um campo reconhecido e
 * preenchido"). A interpretação final e completa do JSON continua sendo feita pela própria Skill
 * (`parseXEnhancement`/`parseStructuredCopy`), que já tolera campos ausentes ou extras.
 */
const SPECIALIST_SCHEMAS: Record<string, DeveloperAssistanceFieldSchema[]> = {
  "joao-marketing-strategy": [
    { field: "angle", type: "string", required: false, description: "Ângulo estratégico da campanha." },
    { field: "centralPromise", type: "string", required: false, description: "Promessa central comunicada." },
    { field: "valueProposition", type: "string", required: false, description: "Proposta de valor da marca." },
    { field: "keyMessages", type: "string[]", required: false, description: "Mensagens-chave da estratégia." },
    { field: "risks", type: "string[]", required: false, description: "Riscos a evitar na comunicação." },
  ],
  "maria-copywriting": [
    { field: "title", type: "string", required: true, description: "Título curto da peça." },
    { field: "caption", type: "string", required: true, description: "Legenda completa, pronta para publicação." },
    { field: "cta", type: "string", required: false, description: "Chamada para ação." },
    { field: "hashtags", type: "string[]", required: false, description: "Lista de hashtags relevantes." },
    { field: "keywords", type: "string[]", required: false, description: "Palavras-chave da copy." },
    { field: "summary", type: "string", required: false, description: "Resumo curto da copy." },
    { field: "objective", type: "string", required: false, description: "Objetivo da publicação." },
    { field: "toneUsed", type: "string", required: false, description: "Tom de voz usado." },
    { field: "identifiedAudience", type: "string", required: false, description: "Público identificado." },
    { field: "futureSuggestions", type: "string[]", required: false, description: "Sugestões para peças futuras." },
    { field: "observations", type: "string[]", required: false, description: "Observações adicionais." },
  ],
  "sofia-art-direction": [
    { field: "visualConcept", type: "string", required: false, description: "Conceito visual central." },
    { field: "recommendedStyle", type: "string", required: false, description: "Estilo visual recomendado." },
    { field: "emotionalTone", type: "string", required: false, description: "Tom emocional da direção de arte." },
    { field: "moodboard", type: "string[]", required: false, description: "Itens de moodboard." },
    { field: "designReferences", type: "string[]", required: false, description: "Referências de design." },
  ],
  "bianca-social-media-design": [
    { field: "gridSystem", type: "string", required: false, description: "Sistema de grid do layout." },
    { field: "visualHierarchyStrategy", type: "string", required: false, description: "Estratégia de hierarquia visual." },
    { field: "colorApplication", type: "string", required: false, description: "Aplicação de cor no layout." },
    { field: "componentStyle", type: "string[]", required: false, description: "Estilo dos componentes visuais." },
    { field: "illustrationStyle", type: "string", required: false, description: "Estilo de ilustração." },
    { field: "mockupStyle", type: "string", required: false, description: "Estilo de mockup, quando aplicável." },
  ],
  "bruno-video-script": [
    { field: "narrativeStructure", type: "string", required: false, description: "Estrutura narrativa do roteiro." },
    { field: "hook", type: "string", required: false, description: "Gancho inicial do vídeo." },
    { field: "overallRhythm", type: "string", required: false, description: "Ritmo geral do roteiro." },
    { field: "musicSuggestions", type: "string[]", required: false, description: "Sugestões de trilha sonora." },
    { field: "finalCta", type: "string", required: false, description: "CTA final do vídeo." },
  ],
  "vanessa-video-direction": [
    { field: "visualRhythm", type: "string", required: false, description: "Ritmo visual da produção." },
    { field: "captionStyle", type: "string", required: false, description: "Estilo de legendas na tela." },
    { field: "musicDirection", type: "string", required: false, description: "Direção musical." },
    { field: "lightDirection", type: "string", required: false, description: "Direção de luz." },
    { field: "colorDirection", type: "string", required: false, description: "Direção de cor." },
  ],
  "diego-video-editing": [
    { field: "musicTrackPlan", type: "string", required: false, description: "Plano de trilha sonora da edição." },
    { field: "requiredAssets", type: "string[]", required: false, description: "Assets necessários para a edição." },
    { field: "editingInstructions", type: "string[]", required: false, description: "Instruções de edição." },
    { field: "technicalChecklist", type: "string[]", required: false, description: "Checklist técnico da edição." },
  ],
  "lucas-quality-review": [
    { field: "additionalObservations", type: "string[]", required: false, description: "Observações adicionais de revisão." },
    { field: "additionalSuggestions", type: "string[]", required: false, description: "Sugestões adicionais de revisão." },
  ],
};

function schemaFor(specialistId: string): DeveloperAssistanceFieldSchema[] {
  return SPECIALIST_SCHEMAS[specialistId] ?? [];
}

/**
 * Validação estrutural mínima, deliberadamente permissiva (nunca mais rígida do que a própria
 * Skill solicitante, que já trata todo campo como opcional): JSON precisa ser um objeto não vazio
 * e, quando o Especialista tem schema conhecido, precisa preencher pelo menos um campo obrigatório
 * (quando houver algum) e pelo menos um campo reconhecido do schema com o tipo certo — o bastante
 * para rejeitar JSON vazio, malformado ou completamente fora do assunto, sem exigir exaustividade.
 * Especialistas sem schema conhecido (qualquer Skill futura que use `IcaroBrainPort`) só precisam
 * de um objeto não vazio com pelo menos um campo de conteúdo real.
 */
function validateStructuredResponse(specialistId: string, rawText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return ["O arquivo de resposta não contém JSON válido."];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return ["A resposta precisa ser um objeto JSON (não array, nem valor primitivo)."];
  }

  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return ["A resposta é um objeto JSON vazio — nenhum campo foi preenchido."];
  }

  const schema = schemaFor(specialistId);
  if (schema.length === 0) {
    const hasAnyContent = Object.values(record).some((value) => isNonEmptyOfAnyKnownType(value));
    return hasAnyContent ? [] : ["Nenhum campo da resposta contém conteúdo real (texto ou lista não vazia)."];
  }

  const errors: string[] = [];
  for (const field of schema) {
    if (!field.required) continue;
    if (!isValidField(record[field.field], field.type)) {
      errors.push(`Campo obrigatório "${field.field}" (${field.type}) ausente ou vazio.`);
    }
  }

  const hasRecognizedContent = schema.some((field) => isValidField(record[field.field], field.type));
  if (!hasRecognizedContent) {
    errors.push(`Nenhum campo reconhecido do schema esperado (${schema.map((field) => field.field).join(", ")}) foi preenchido.`);
  }

  return errors;
}

function isValidField(value: unknown, type: DeveloperAssistanceFieldSchema["type"]): boolean {
  if (type === "string") return typeof value === "string" && value.trim().length > 0;
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isNonEmptyOfAnyKnownType(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}
