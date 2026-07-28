import type { AITaskType } from "../ports/ai-provider.port.js";

/**
 * Descrição textual de um campo do JSON esperado de volta — não é JSON Schema formal, é a mesma
 * convenção (nome do campo -> tipo -> obrigatório?) que cada Skill já usa nos comentários de seus
 * próprios tipos `XEnhancement`/`XStructuredCopy`. Existe para que o pacote de trabalho comunique
 * à IA desenvolvedora, de forma estruturada (não só em prosa dentro do prompt), o formato exato
 * que a Skill solicitante sabe interpretar.
 */
export type DeveloperAssistanceFieldSchema = {
  field: string;
  type: "string" | "string[]";
  required: boolean;
  description?: string;
};

/**
 * Pacote de trabalho estruturado gerado pelo `DeveloperAssistedIcaroProvider` sempre que uma Skill
 * solicita apoio ao Ícaro em LOCAL_PRODUCTION. Contém tudo que a IA desenvolvedora do VS Code
 * precisa para produzir a resposta real: quem pediu, o prompt completo (já inclui o formato JSON
 * esperado, construído pela própria Skill), o schema estrutural de referência, e os dois caminhos
 * (pacote + resposta) usados para a integração por arquivo, sem nenhum acoplamento entre a Skill e
 * a interface do VS Code.
 */
export type DeveloperAssistanceWorkPackage = {
  executionId: string;
  stepId?: string;
  taskId?: string;
  specialistId: string;
  taskType: AITaskType;
  prompt: string;
  context?: Record<string, unknown>;
  constraints?: string[];
  responseSchema: DeveloperAssistanceFieldSchema[];
  workPackagePath: string;
  expectedResponsePath: string;
  instruction: string;
  resumeCommand: string;
  createdAt: string;
  /**
   * Preenchido apenas quando este pacote é gerado após uma tentativa anterior inválida (JSON
   * malformado, não é objeto, ou não atende ao schema mínimo) — permite à IA desenvolvedora
   * corrigir exatamente o que falhou em vez de adivinhar.
   */
  validationErrors?: string[];
};

/**
 * Sinaliza que uma Skill não pode completar agora porque está aguardando a IA desenvolvedora
 * produzir e salvar a resposta real do pacote de trabalho — o equivalente, para tarefas de texto,
 * estratégia, análise e direção criativa, ao que Pedro/Rafa já fazem para imagem/vídeo. Não é uma
 * falha: a Skill que capturar este erro deve devolver `status: "needs_developer_ai"` (ver
 * `src/shared/utils/developer-ai-assistance.ts`) para que Caio pause o workflow em
 * `WAITING_DEVELOPER_AI`, do mesmo jeito que já pausa em `WAITING_ASSISTED_GENERATION`.
 */
export class DeveloperAssistancePendingError extends Error {
  readonly workPackage: DeveloperAssistanceWorkPackage;

  constructor(workPackage: DeveloperAssistanceWorkPackage) {
    super(
      `Aguardando resposta da IA desenvolvedora para "${workPackage.specialistId}" (${workPackage.taskType}). ` +
        `Pacote: ${workPackage.workPackagePath}. Resposta esperada em: ${workPackage.expectedResponsePath}.`,
    );
    this.name = "DeveloperAssistancePendingError";
    this.workPackage = workPackage;
  }
}

/**
 * Formato de `SkillResponse.output` usado por toda Skill que pausa aguardando IA desenvolvedora
 * (status `needs_developer_ai`). É idêntico para todas as Skills (João, Maria, Sofia, Bianca,
 * Bruno, Vanessa, Diego, Lucas e qualquer futura Skill que use `IcaroBrainPort`) — diferente de
 * `PedroAssistedGenerationOutput`/`RafaAssistedGenerationOutput`, que carregam campos próprios de
 * imagem/vídeo (`pendingImages`/`pendingVideos`), pois aqui não há binário nenhum envolvido, só o
 * pacote de trabalho já descrito acima.
 */
export type DeveloperAssistancePendingOutput = {
  mode: "developer_ai";
  instruction: string;
  specialistId: string;
  taskType: AITaskType;
  workPackagePath: string;
  expectedResponsePath: string;
  resumeCommand: string;
  validationErrors?: string[];
};
