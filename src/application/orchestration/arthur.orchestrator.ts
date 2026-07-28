import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { WorkflowIntent } from "../../domain/workflows/workflow.contract.js";
import type { ValentinaTenantPort } from "../tenancy/valentina-tenant.port.js";
import type { ArthurDecisionLoggerPort } from "./arthur-decision-log.contract.js";
import type { ArthurDecisionContext, ArthurOrchestratorPort, ArthurTextCommandPlannerPort } from "./arthur.contract.js";
import type {
  ExecutionPlan,
  ExecutionPlanInputBinding,
  ExecutionPlanStep,
  ExecutionPlanStepType,
  ExecutionPlanTenantContext,
} from "./execution-plan.contract.js";
import type {
  ArthurIdGenerator,
  ArthurInterpretedIntent,
  ArthurPlanningOutput,
  ArthurSupportedChannel,
  ArthurTextCommandInput,
} from "./arthur.types.js";
import { normalize } from "../../shared/utils/skill-parsing.js";
import { classifyContentObjective, classifyRecommendedFormat, pipelineForRecommendedFormat } from "../../shared/utils/content-format-classification.js";

const DEFAULT_CAPABILITIES: SkillCapability[] = [
  "editorial_planning",
  "strategy",
  "copywriting",
  "art_direction",
  "social_media_design",
  "image_generation",
  "quality_review",
  "social_publishing",
  "campaign_management",
  "metrics_analysis",
  "optimization",
  "video_creation",
  "video_script",
  "video_direction",
  "video_editing",
  "video_narration",
  "video_rendering",
  "client_management",
];

const CHANNEL_ALIASES: Array<{ channel: ArthurSupportedChannel; terms: string[] }> = [
  { channel: "instagram", terms: ["instagram", "insta", "reels", "reel", "stories", "story"] },
  { channel: "facebook", terms: ["facebook", "face"] },
  { channel: "threads", terms: ["threads"] },
  { channel: "linkedin", terms: ["linkedin"] },
  { channel: "tiktok", terms: ["tiktok", "tik tok"] },
  { channel: "pinterest", terms: ["pinterest"] },
  { channel: "youtube", terms: ["youtube", "shorts"] },
  { channel: "google_business", terms: ["google business", "google meu negocio", "perfil da empresa"] },
  { channel: "meta_ads", terms: ["meta ads", "anuncio meta", "campanha meta", "trafego pago meta"] },
  { channel: "google_ads", terms: ["google ads", "anuncio google", "campanha google"] },
];

const AUDIENCE_ALIASES: Array<{ audience: string; terms: string[] }> = [
  { audience: "convidados", terms: ["convidado", "convidados"] },
  { audience: "noivos", terms: ["noivo", "noiva", "noivos", "casal", "casais"] },
  { audience: "cerimonialistas", terms: ["cerimonialista", "cerimonialistas", "assessoria"] },
  { audience: "fornecedores", terms: ["fornecedor", "fornecedores"] },
  { audience: "clientes", terms: ["cliente", "clientes"] },
];

class SequentialArthurIdGenerator implements ArthurIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopArthurDecisionLogger implements ArthurDecisionLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export type ArthurOrchestratorDependencies = {
  idGenerator?: ArthurIdGenerator;
  logger?: ArthurDecisionLoggerPort;
  tenants?: ValentinaTenantPort;
  now?: () => Date;
};

export class ArthurOrchestrator implements ArthurOrchestratorPort, ArthurTextCommandPlannerPort {
  private readonly idGenerator: ArthurIdGenerator;
  private readonly logger: ArthurDecisionLoggerPort;
  private readonly tenants?: ValentinaTenantPort;
  private readonly now: () => Date;

  constructor(dependencies: ArthurOrchestratorDependencies = {}) {
    this.idGenerator = dependencies.idGenerator ?? new SequentialArthurIdGenerator();
    this.logger = dependencies.logger ?? new NoopArthurDecisionLogger();
    this.tenants = dependencies.tenants;
    this.now = dependencies.now ?? (() => new Date());
  }

  async planFromText(input: ArthurTextCommandInput): Promise<ArthurPlanningOutput> {
    const tenant = await this.resolveTenantContext(input);
    const interpretedIntent = this.interpretTextCommand(input);
    const executionPlan = await this.createExecutionPlan({
      intent: interpretedIntent.intent,
      clientId: tenant.clientId,
      tenantId: tenant.tenantId,
      tenantSource: tenant.source,
      availableSkillIds: input.availableSkillIds ?? [],
      availableCapabilities: input.availableCapabilities ?? DEFAULT_CAPABILITIES,
      constraints: input.constraints ?? [],
      musicFilePath: input.musicFilePath,
    });

    return { interpretedIntent, executionPlan };
  }

  async createExecutionPlan(context: ArthurDecisionContext): Promise<ExecutionPlan> {
    if (!context.clientId?.trim()) {
      throw new Error("Arthur precisa receber um clientId resolvido pela Valentina para criar um plano.");
    }

    const interpretedIntent = this.interpretIntent(context.intent, context.availableCapabilities);
    const tenant: ExecutionPlanTenantContext = {
      clientId: context.clientId,
      tenantId: context.tenantId,
      source: context.tenantSource ?? "input",
    };
    const steps = this.createSteps(interpretedIntent, tenant, context.musicFilePath);
    const plan: ExecutionPlan = {
      id: this.idGenerator.create("plan"),
      intent: interpretedIntent.intent,
      createdBy: "arthur",
      tenant,
      steps,
      acceptanceCriteria: [
        "O plano deve manter Arthur apenas como orquestrador.",
        "Todo workflow deve estar associado a um cliente resolvido pela Valentina.",
        "Nenhuma Skill real deve ser executada nesta etapa.",
        "Nenhuma API externa deve ser chamada nesta etapa.",
        "Cada etapa operacional deve ser delegável a uma Skill especializada futura.",
        "A aprovação humana deve acontecer antes de qualquer publicação futura.",
      ],
    };

    await this.logger.record({
      id: this.idGenerator.create("arthur-log"),
      planId: plan.id,
      occurredAt: this.now().toISOString(),
      objective: interpretedIntent.intent.objective,
      detectedChannels: interpretedIntent.detectedChannels,
      selectedCapabilities: interpretedIntent.requiredCapabilities,
      stepCount: plan.steps.length,
      reason: "Arthur interpretou a intenção, selecionou capacidades necessárias e estruturou a ordem de execução sem acionar Skills.",
      constraints: [...context.constraints, `clientId:${context.clientId}`],
    });

    return plan;
  }

  private async resolveTenantContext(input: ArthurTextCommandInput): Promise<ExecutionPlanTenantContext> {
    if (!input.clientId?.trim() && !input.tenantId?.trim()) {
      throw new Error("Arthur precisa receber clientId ou tenantId antes de planejar um workflow.");
    }

    if (this.tenants && input.tenantId) {
      const context = await this.tenants.getClientContext(input.tenantId);
      return {
        clientId: context.clientId,
        tenantId: context.tenantId,
        source: "valentina",
      };
    }

    if (this.tenants && input.clientId) {
      const tenant = await this.tenants.getTenant({ clientId: input.clientId, status: "all" });
      if (!tenant) throw new Error(`Valentina não encontrou o cliente ${input.clientId}.`);
      return {
        clientId: tenant.clientId,
        tenantId: tenant.id,
        source: "valentina",
      };
    }

    return {
      clientId: input.clientId ?? input.tenantId ?? "",
      tenantId: input.tenantId,
      source: "input",
    };
  }

  private interpretTextCommand(input: ArthurTextCommandInput): ArthurInterpretedIntent {
    const command = input.command.trim();
    if (!command) {
      throw new Error("Arthur precisa receber um comando em texto para montar um plano.");
    }

    const intent: WorkflowIntent = {
      id: this.idGenerator.create("intent"),
      objective: command,
      audience: this.detectAudience(command),
      channels: this.detectChannels(command),
      constraints: input.constraints,
      successCriteria: [
        "Plano de execução estruturado criado.",
        "Capacidades necessárias identificadas.",
        "Nenhuma execução operacional realizada por Arthur.",
      ],
    };

    return this.interpretIntent(intent, input.availableCapabilities ?? DEFAULT_CAPABILITIES);
  }

  private interpretIntent(intent: WorkflowIntent, availableCapabilities: string[]): ArthurInterpretedIntent {
    const detectedChannels = this.normalizeChannels(intent.channels?.length ? intent.channels : this.detectChannels(intent.objective));
    const detectedAudience = intent.audience ?? this.detectAudience(intent.objective);
    const requiredCapabilities = this.detectRequiredCapabilities(intent.objective, detectedChannels, availableCapabilities);

    return {
      intent: {
        ...intent,
        audience: detectedAudience,
        channels: detectedChannels,
      },
      detectedChannels,
      detectedAudience,
      requiredCapabilities,
      notes: [
        "Arthur apenas criou o plano; nenhuma Skill foi executada.",
        "As capacidades indicam especialistas futuros, não implementações existentes.",
      ],
    };
  }

  private createSteps(interpretedIntent: ArthurInterpretedIntent, tenant: ExecutionPlanTenantContext, musicFilePath?: string): ExecutionPlanStep[] {
    const steps: ExecutionPlanStep[] = [];
    // Canal singular e formato em texto livre: os contratos de entrada reais de João, Sofia,
    // Bianca, Pedro e Lucas exigem `channel`/`format` (ou variações como `desiredChannel`),
    // não apenas o array `channels` que Arthur já detectava. Calculados uma vez por plano.
    const primaryChannel = interpretedIntent.detectedChannels[0] ?? "instagram";
    // Formato e quantidade deixaram de ser decisão de Arthur: valores neutros aqui são apenas o
    // "input" padrão de toda etapa (ver `addStep`), sempre sobrescritos em runtime pelo Editorial
    // Brief do Eduardo (etapa "Planejamento editorial", sempre a primeira do plano) através de
    // `inputBindings` — a mesma técnica genérica já usada para encadear João -> Sofia -> Bianca ->
    // Pedro. Mesmo qual pipeline (vídeo ou imagem) entra no plano já não é mais uma lista de
    // palavras própria de Arthur — vem da mesma classificação que o Eduardo usa (ver
    // `detectRequiredCapabilities`); esse cálculo ainda precisa acontecer antes do Eduardo
    // executar de verdade porque Caio executa um plano estático e não replaneja em runtime a
    // partir da saída de uma etapa. `detectFormat` abaixo só resolve o rótulo técnico de
    // plataforma (reels/tiktok/shorts) para a etapa de vídeo a partir do canal — nunca decide se a
    // pipeline é de vídeo ou de imagem.
    const imageCount = 1;
    const format = this.detectFormat(interpretedIntent);

    const addStep = (input: {
      type: ExecutionPlanStepType;
      name: string;
      skillCapability?: SkillCapability;
      instructions: string;
      expectedOutput: string;
      dependsOn?: string[];
      input?: Record<string, unknown>;
      inputBindings?: ExecutionPlanInputBinding[];
    }) => {
      const id = this.idGenerator.create("step");
      steps.push({
        id,
        order: steps.length + 1,
        type: input.type,
        name: input.name,
        skillCapability: input.skillCapability,
        instructions: input.instructions,
        input: {
          clientId: tenant.clientId,
          tenantId: tenant.tenantId,
          objective: interpretedIntent.intent.objective,
          originalRequest: interpretedIntent.intent.objective,
          channels: interpretedIntent.detectedChannels,
          channel: primaryChannel,
          format,
          audience: interpretedIntent.detectedAudience,
          ...input.input,
        },
        inputBindings: input.inputBindings,
        expectedOutput: input.expectedOutput,
        dependsOn: input.dependsOn ?? [],
      });
      return id;
    };

    // Planejamento editorial (Eduardo) é sempre a primeira etapa do plano, antes até da
    // Estratégia de marketing: Eduardo recebe apenas a solicitação do usuário e decide a melhor
    // estratégia de conteúdo (formato, quantidade de slides/telas, duração de vídeo, emoção
    // principal, estrutura narrativa, CTA, profundidade, complexidade e prioridade de conversão)
    // — Arthur não decide mais nada disso sozinho. João consome o Editorial Brief resultante.
    const editorialPlanningStepId = interpretedIntent.requiredCapabilities.includes("editorial_planning")
      ? addStep({
          type: "skill",
          name: "Planejamento editorial",
          skillCapability: "editorial_planning",
          instructions: "Decidir a melhor estratégia de conteúdo (formato, quantidade de slides/telas, duração quando houver vídeo, emoção principal, estrutura narrativa, CTA recomendado, profundidade, complexidade e prioridade de conversão) antes do João iniciar o trabalho. Não criar copy, imagem ou vídeo.",
          expectedOutput: "Editorial Brief estruturado para orientar o João.",
          input: {
            desiredChannel: primaryChannel,
            desiredObjective: interpretedIntent.intent.objective,
          },
        })
      : undefined;

    const strategyStepId = addStep({
      type: "skill",
      name: "Estratégia de marketing",
      skillCapability: "strategy",
      instructions: "Definir abordagem, objetivo da comunicação, público e ângulo estratégico a partir do Editorial Brief do Eduardo. Não decidir formato sozinho e não criar copy final.",
      expectedOutput: "Briefing estratégico estruturado para orientar as próximas Skills.",
      dependsOn: editorialPlanningStepId ? [editorialPlanningStepId] : [],
      input: {
        desiredChannel: primaryChannel,
        desiredFormat: format,
        desiredObjective: interpretedIntent.intent.objective,
      },
      inputBindings: editorialPlanningStepId
        ? [
            { targetField: "editorialBrief", fromStepId: editorialPlanningStepId },
            { targetField: "desiredFormat", fromStepId: editorialPlanningStepId, sourcePath: "recommendedFormatLabel" },
          ]
        : undefined,
    });

    // Pipeline de vídeo (João → Bruno → Vanessa → Diego → Nora → Rafa → Lucas → Ana): cada etapa
    // depende estritamente da anterior e só troca contratos estruturados; nenhuma Skill chama
    // outra diretamente.
    let videoScriptStepId: string | undefined;
    if (interpretedIntent.requiredCapabilities.includes("video_script")) {
      videoScriptStepId = addStep({
        type: "skill",
        name: "Roteiro de vídeo",
        skillCapability: "video_script",
        instructions: "Transformar a estratégia de marketing do João em um roteiro de vídeo curto profissional (estrutura narrativa, gancho, cenas, texto falado, texto na tela, B-roll, enquadramentos, movimentos de câmera, ritmo, pausas, transições, efeitos sonoros, trilha e CTA final), sem gerar, editar ou publicar vídeo.",
        expectedOutput: "Roteiro estruturado e briefing para a Vanessa.",
        dependsOn: [strategyStepId],
        input: { videoObjective: interpretedIntent.intent.objective },
        inputBindings: [
          { targetField: "joaoStrategy", fromStepId: strategyStepId },
          ...(editorialPlanningStepId ? [{ targetField: "workflowContext.editorialBrief", fromStepId: editorialPlanningStepId }] : []),
        ],
      });
    }

    let videoDirectionStepId: string | undefined;
    if (interpretedIntent.requiredCapabilities.includes("video_direction") && videoScriptStepId) {
      videoDirectionStepId = addStep({
        type: "skill",
        name: "Direção de vídeo",
        skillCapability: "video_direction",
        instructions: "Transformar o roteiro de Bruno em uma direção audiovisual completa (mapa de cenas, enquadramentos, composição visual, movimentos de câmera, ritmo visual, transições, estilo de legenda, efeitos visuais e sonoros, trilha, B-roll, luz e cor, orientação de gravação e edição), sem criar roteiro, gerar, editar, renderizar ou publicar vídeo.",
        expectedOutput: "Direção audiovisual estruturada e briefing para o Diego.",
        dependsOn: [videoScriptStepId],
        input: { videoObjective: interpretedIntent.intent.objective },
        inputBindings: [
          { targetField: "joaoStrategy", fromStepId: strategyStepId },
          { targetField: "brunoScript", fromStepId: videoScriptStepId, sourcePath: "vanessaBriefing" },
        ],
      });
    }

    let videoEditingStepId: string | undefined;
    if (interpretedIntent.requiredCapabilities.includes("video_editing") && videoDirectionStepId && videoScriptStepId) {
      videoEditingStepId = addStep({
        type: "skill",
        name: "Edição de vídeo",
        skillCapability: "video_editing",
        instructions: "Transformar a direção audiovisual de Vanessa em um plano técnico de edição (timeline, ordem das cenas, cortes, duração de cada trecho, legendas por cena, textos na tela, transições, efeitos visuais e sonoros, trilha, assets necessários, instruções de edição e checklist técnico), sem criar roteiro, dirigir, renderizar ou publicar vídeo.",
        expectedOutput: "Plano de edição estruturado e briefing para o Rafa.",
        dependsOn: [videoDirectionStepId],
        input: { videoObjective: interpretedIntent.intent.objective },
        inputBindings: [
          { targetField: "joaoStrategy", fromStepId: strategyStepId },
          { targetField: "brunoScript", fromStepId: videoScriptStepId, sourcePath: "vanessaBriefing" },
          { targetField: "vanessaDirection", fromStepId: videoDirectionStepId, sourcePath: "diegoBriefing" },
        ],
      });
    }

    let videoNarrationStepId: string | undefined;
    if (
      interpretedIntent.requiredCapabilities.includes("video_narration")
      && videoEditingStepId
      && videoDirectionStepId
      && videoScriptStepId
    ) {
      videoNarrationStepId = addStep({
        type: "skill",
        name: "Narração de vídeo",
        skillCapability: "video_narration",
        instructions: "Transformar o roteiro de Bruno e a timeline de Diego em locução natural, segmentada e sincronizada, solicitando/validando o arquivo real de voz em Developer Assisted Mode, sem renderizar vídeo, escolher imagens ou publicar.",
        expectedOutput: "Plano estruturado de narração, arquivo de voz validado e briefing para o Rafa.",
        dependsOn: [videoEditingStepId],
        input: { videoObjective: interpretedIntent.intent.objective },
        inputBindings: [
          { targetField: "joaoStrategy", fromStepId: strategyStepId },
          { targetField: "brunoScript", fromStepId: videoScriptStepId, sourcePath: "vanessaBriefing" },
          { targetField: "vanessaDirection", fromStepId: videoDirectionStepId, sourcePath: "diegoBriefing" },
          { targetField: "diegoEditingPlan", fromStepId: videoEditingStepId, sourcePath: "rafaBriefing" },
        ],
      });
    }

    let videoRenderingStepId: string | undefined;
    if (
      interpretedIntent.requiredCapabilities.includes("video_rendering")
      && videoEditingStepId
      && videoDirectionStepId
      && videoScriptStepId
      && videoNarrationStepId
    ) {
      videoRenderingStepId = addStep({
        type: "skill",
        name: "Renderização de vídeo",
        skillCapability: "video_rendering",
        instructions: "Transformar o plano técnico de edição de Diego em um pacote de vídeo pronto para renderização (prompt técnico final, caminho esperado, especificações técnicas, assets necessários, instruções finais de renderização), sem criar roteiro, dirigir, editar conceitualmente ou publicar vídeo, e sem chamar nenhuma API externa de vídeo.",
        expectedOutput: "Vídeo final registrado como artefato após validação do arquivo real (Developer Assisted Mode).",
        dependsOn: [videoNarrationStepId],
        // `localAssets.musicTrackPath` só existe quando alguém aponta uma música local de verdade
        // (ex.: `--music` na CLI, já validada — existência, extensão, path traversal, URL — antes
        // de chegar aqui). Nunca inventado por Arthur; ausência mantém o comportamento atual
        // (Rafa renderiza sem trilha).
        input: {
          videoObjective: interpretedIntent.intent.objective,
          ...(musicFilePath ? { localAssets: { musicTrackPath: musicFilePath } } : {}),
        },
        inputBindings: [
          { targetField: "joaoStrategy", fromStepId: strategyStepId },
          { targetField: "brunoScript", fromStepId: videoScriptStepId, sourcePath: "vanessaBriefing" },
          { targetField: "vanessaDirection", fromStepId: videoDirectionStepId, sourcePath: "diegoBriefing" },
          { targetField: "diegoEditingPlan", fromStepId: videoEditingStepId, sourcePath: "rafaBriefing" },
          { targetField: "noraNarration", fromStepId: videoNarrationStepId, sourcePath: "rafaBriefing" },
        ],
      });
    }

    const copyStepId = addStep({
      type: "skill",
      name: "Criação da copy",
      skillCapability: "copywriting",
      instructions: "Criar textos somente quando uma Skill de copywriting existir. Arthur apenas reserva esta etapa no plano.",
      expectedOutput: "Texto de campanha, legenda ou roteiro textual para revisão.",
      dependsOn: [strategyStepId],
      // A Maria recebe o briefing do João diretamente como entrada (sem envelope) — por isso
      // targetField é null: o briefing inteiro substitui o input genérico desta etapa.
      inputBindings: [{ targetField: null, fromStepId: strategyStepId, sourcePath: "mariaBriefing" }],
    });

    let visualDependencyId = copyStepId;
    let artDirectionStepId: string | undefined;
    let socialMediaDesignStepId: string | undefined;
    let imageGenerationStepId: string | undefined;

    if (interpretedIntent.requiredCapabilities.includes("art_direction")) {
      artDirectionStepId = addStep({
        type: "skill",
        name: "Direção de arte",
        skillCapability: "art_direction",
        instructions: "Definir conceito criativo, identidade visual, paleta, tipografia, moodboard, estilo e emoção, sem definir layout ou gerar imagem.",
        expectedOutput: "Direção visual para imagem, carrossel ou vídeo.",
        dependsOn: [strategyStepId],
        input: { visualObjective: interpretedIntent.intent.objective },
        inputBindings: [
          { targetField: "joaoStrategy", fromStepId: strategyStepId },
          { targetField: "joaoSofiaBriefing", fromStepId: strategyStepId, sourcePath: "sofiaBriefing" },
          // O campo `format` de Sofia é próprio (não deriva de joaoStrategy.format), então
          // precisa da mesma sobrescrita do Eduardo aplicada à etapa de Estratégia.
          ...(editorialPlanningStepId
            ? [{ targetField: "format", fromStepId: editorialPlanningStepId, sourcePath: "recommendedFormatLabel" }]
            : []),
        ],
      });
      visualDependencyId = artDirectionStepId;
    }

    if (interpretedIntent.requiredCapabilities.includes("social_media_design")) {
      socialMediaDesignStepId = addStep({
        type: "skill",
        name: "Design de redes sociais",
        skillCapability: "social_media_design",
        instructions: "Transformar a direção de arte em layout detalhado (grid, hierarquia visual, espaçamentos, componentes e sequência de slides), sem gerar imagem.",
        expectedOutput: "Especificação de design estruturada, pronta para a geração final de imagem.",
        dependsOn: [visualDependencyId],
        inputBindings: [
          { targetField: "joaoStrategy", fromStepId: strategyStepId },
          { targetField: "sofiaDirection", fromStepId: visualDependencyId },
          { targetField: "sofiaBriefing", fromStepId: visualDependencyId, sourcePath: "biancaBriefing" },
          // O campo `format` de Bianca é próprio (não deriva de joaoStrategy.format) e decide
          // sozinho quantos slides ela monta (`isCarouselFormat`) — por isso precisa da mesma
          // sobrescrita do Eduardo, ou Bianca nunca saberia que o formato é carrossel/Story.
          ...(editorialPlanningStepId
            ? [
                { targetField: "format", fromStepId: editorialPlanningStepId, sourcePath: "recommendedFormatLabel" },
                // Mesma fonte usada para o `imageCount` do Pedro logo abaixo: sem esta ligação,
                // Bianca montava sua própria contagem de slides a partir de keyMessages.length,
                // divergindo do imageCount do Pedro e fazendo os últimos slides (incluindo o de
                // Fechamento/CTA) serem descartados silenciosamente na geração final.
                { targetField: "recommendedSlideCount", fromStepId: editorialPlanningStepId, sourcePath: "recommendedSlideCount" },
              ]
            : []),
        ],
      });
      visualDependencyId = socialMediaDesignStepId;
    }

    if (interpretedIntent.requiredCapabilities.includes("image_generation")) {
      imageGenerationStepId = addStep({
        type: "skill",
        name: "Geração de imagem",
        skillCapability: "image_generation",
        instructions: "Gerar imagem somente quando uma Skill de imagem existir. Arthur apenas planeja a necessidade.",
        expectedOutput: "Imagem ou conjunto de imagens para a peça.",
        dependsOn: [visualDependencyId],
        input: { imageCount, desiredAspectRatio: "4:5" },
        inputBindings: [
          { targetField: "biancaDesign", fromStepId: visualDependencyId },
          { targetField: "biancaPedroBriefing", fromStepId: visualDependencyId, sourcePath: "pedroBriefing" },
          // Proporção/resolução deixaram de ser um valor estático de Arthur: Sofia é a autoridade
          // única (decide a partir de canal/formato, ver `resolveAspectRatio`), e Bianca só repassa
          // o mesmo valor adiante — por isso a mesma fonte já usada para `biancaDesign` também
          // sobrescreve `desiredAspectRatio` aqui, evitando que Story herde a proporção 4:5 do feed.
          { targetField: "desiredAspectRatio", fromStepId: visualDependencyId, sourcePath: "recommendedAspectRatio" },
          // Pedro só sabe usar legenda/hashtags/CTA como texto visível autorizado (nunca inventa
          // texto) se a copy da Maria chegar em workflowContext.mariaCopy — mesma convenção que
          // Pedro já lia manualmente antes de existir encadeamento automático.
          { targetField: "workflowContext.mariaCopy", fromStepId: copyStepId },
          // Quantidade de imagens deixou de ser decisão de Arthur: quando o Eduardo recomenda uma
          // quantidade de slides (carrossel), ela sobrescreve o valor neutro acima.
          ...(editorialPlanningStepId
            ? [
                { targetField: "imageCount", fromStepId: editorialPlanningStepId, sourcePath: "recommendedSlideCount" },
                { targetField: "format", fromStepId: editorialPlanningStepId, sourcePath: "recommendedFormatLabel" },
                { targetField: "workflowContext.editorialBrief", fromStepId: editorialPlanningStepId },
              ]
            : []),
        ],
      });
      visualDependencyId = imageGenerationStepId;
    }

    const reviewInputBindings: ExecutionPlanInputBinding[] = [
      { targetField: "joaoStrategy", fromStepId: strategyStepId },
      { targetField: "mariaCopy", fromStepId: copyStepId },
      // MariaCopywritingOutput reporta a autoavaliação de qualidade aninhada em `quality.score`/
      // `quality.passed`; o Lucas espera esses dois valores já achatados dentro de `mariaCopy`.
      { targetField: "mariaCopy.qualityScore", fromStepId: copyStepId, sourcePath: "quality.score" },
      { targetField: "mariaCopy.qualityPassed", fromStepId: copyStepId, sourcePath: "quality.passed" },
    ];
    if (artDirectionStepId) reviewInputBindings.push({ targetField: "sofiaDirection", fromStepId: artDirectionStepId });
    if (socialMediaDesignStepId) reviewInputBindings.push({ targetField: "biancaDesign", fromStepId: socialMediaDesignStepId });
    if (imageGenerationStepId) reviewInputBindings.push({ targetField: "pedroImages", fromStepId: imageGenerationStepId });
    // Pacote de vídeo (Bruno/Vanessa/Diego/Rafa): mesmo raciocínio do pacote visual — só entra na
    // revisão quando a pipeline de vídeo de fato roda no plano. rafaVideo só existe depois que a
    // etapa de renderização COMPLETA (não apenas quando pausada em geração assistida), então
    // Revisão depende dela (ver dependsOn abaixo) e só roda depois que o vídeo real existir.
    if (videoScriptStepId) reviewInputBindings.push({ targetField: "brunoScript", fromStepId: videoScriptStepId, sourcePath: "vanessaBriefing" });
    if (videoDirectionStepId) reviewInputBindings.push({ targetField: "vanessaDirection", fromStepId: videoDirectionStepId, sourcePath: "diegoBriefing" });
    if (videoEditingStepId) reviewInputBindings.push({ targetField: "diegoEditingPlan", fromStepId: videoEditingStepId, sourcePath: "rafaBriefing" });
    if (videoNarrationStepId) reviewInputBindings.push({ targetField: "noraNarration", fromStepId: videoNarrationStepId, sourcePath: "rafaBriefing" });
    if (videoRenderingStepId) reviewInputBindings.push({ targetField: "rafaVideo", fromStepId: videoRenderingStepId, sourcePath: "video" });
    if (editorialPlanningStepId) {
      reviewInputBindings.push({ targetField: "workflowContext.editorialBrief", fromStepId: editorialPlanningStepId });
      // Sem este binding, `input.format` da Revisão ficava preso no rótulo estático calculado por
      // `detectFormat()` no momento da criação do plano (sempre "post único" para pipeline de
      // imagem, por exemplo) em vez da classificação real do Eduardo — o mesmo `recommendedFormatLabel`
      // que já alimenta Sofia/Bianca/Pedro. Necessário para Lucas avaliar Feed/Story/Carrossel/
      // Reels/Vídeo com o perfil de qualidade correto (ver `resolveContentQualityProfile`).
      reviewInputBindings.push({ targetField: "format", fromStepId: editorialPlanningStepId, sourcePath: "recommendedFormatLabel" });
    }

    const reviewStepId = addStep({
      type: "skill",
      name: "Revisão",
      skillCapability: "quality_review",
      instructions: "Revisar coerência, clareza, adequação ao canal e riscos antes de aprovação — incluindo, quando presente, o pacote de vídeo (roteiro, direção, edição e vídeo final).",
      expectedOutput: "Checklist de revisão com ajustes recomendados.",
      dependsOn: Array.from(new Set([copyStepId, visualDependencyId, ...(videoRenderingStepId ? [videoRenderingStepId] : [])])),
      inputBindings: reviewInputBindings,
    });

    const approvalStepId = addStep({
      type: "human_gate",
      name: "Aprovação",
      instructions: "Solicitar aprovação humana antes de qualquer publicação futura.",
      expectedOutput: "Decisão de aprovado, reprovado ou ajustar.",
      dependsOn: [reviewStepId],
    });

    if (interpretedIntent.requiredCapabilities.includes("social_publishing")) {
      const publishingInputBindings: ExecutionPlanInputBinding[] = [
        { targetField: "joaoStrategy", fromStepId: strategyStepId },
        { targetField: "mariaCopy", fromStepId: copyStepId },
        { targetField: "lucasReview", fromStepId: reviewStepId },
        // A decisão humana chega como o "output" da própria etapa de aprovação (ver Caio.resume) —
        // mesmo mecanismo genérico de binding usado para saída de Skill, sem tratamento especial.
        { targetField: "humanApproval", fromStepId: approvalStepId },
      ];
      if (artDirectionStepId) publishingInputBindings.push({ targetField: "sofiaDirection", fromStepId: artDirectionStepId });
      if (imageGenerationStepId) publishingInputBindings.push({ targetField: "pedroImages", fromStepId: imageGenerationStepId });
      if (videoRenderingStepId) publishingInputBindings.push({ targetField: "rafaVideo", fromStepId: videoRenderingStepId });

      addStep({
        type: "skill",
        name: this.isMetaPublishing(interpretedIntent.detectedChannels) ? "Publicação Meta" : "Publicação nas redes sociais",
        skillCapability: "social_publishing",
        instructions: "Publicar somente por Skill de publicação futura e somente após aprovação. Arthur não publica.",
        expectedOutput: "Publicação ou agendamento realizado por Skill especializada futura.",
        dependsOn: [approvalStepId],
        // Sem credencial real de Meta configurada nesta fase (ADR 0003) — dry_run é o único modo seguro por padrão.
        input: { publishMode: "dry_run" },
        inputBindings: publishingInputBindings,
      });
    }

    if (interpretedIntent.requiredCapabilities.includes("campaign_management")) {
      addStep({
        type: "skill",
        name: "Gestão de campanha",
        skillCapability: "campaign_management",
        instructions: "Criar ou ajustar campanha paga somente por Skill especializada futura.",
        expectedOutput: "Plano ou rascunho de campanha para canal pago.",
        dependsOn: [approvalStepId],
      });
    }

    if (interpretedIntent.requiredCapabilities.includes("metrics_analysis")) {
      const metricsStepId = addStep({
        type: "skill",
        name: "Análise de métricas",
        skillCapability: "metrics_analysis",
        instructions: "Analisar resultados somente quando houver dados fornecidos por adaptadores futuros.",
        expectedOutput: "Leitura estruturada de métricas e desempenho.",
      });

      if (interpretedIntent.requiredCapabilities.includes("optimization")) {
        addStep({
          type: "skill",
          name: "Sugestão de melhorias",
          skillCapability: "optimization",
          instructions: "Sugerir otimizações com base em métricas analisadas por Skill própria.",
          expectedOutput: "Lista de melhorias priorizadas.",
          dependsOn: [metricsStepId],
        });
      }
    }

    return steps;
  }

  private detectChannels(text: string): ArthurSupportedChannel[] {
    const normalizedText = normalizeText(text);
    const channels = CHANNEL_ALIASES
      .filter(({ terms }) => terms.some((term) => normalizedText.includes(normalizeText(term))))
      .map(({ channel }) => channel);

    if (normalizedText.includes("meta") && !channels.includes("instagram") && !channels.includes("facebook")) {
      channels.push("instagram", "facebook");
    }

    return this.normalizeChannels(channels);
  }

  private normalizeChannels(channels: string[]): ArthurSupportedChannel[] {
    const allowed = new Set(CHANNEL_ALIASES.map(({ channel }) => channel));
    return Array.from(new Set(channels.filter((channel): channel is ArthurSupportedChannel => allowed.has(channel as ArthurSupportedChannel))));
  }

  private detectAudience(text: string): string | undefined {
    const normalizedText = normalizeText(text);
    return AUDIENCE_ALIASES.find(({ terms }) => terms.some((term) => normalizedText.includes(normalizeText(term))))?.audience;
  }

  private detectRequiredCapabilities(
    text: string,
    channels: ArthurSupportedChannel[],
    availableCapabilities: string[],
  ): SkillCapability[] {
    const normalizedText = normalizeText(text);
    const required = new Set<SkillCapability>(["editorial_planning", "strategy", "copywriting", "quality_review"]);
    const visualChannels: ArthurSupportedChannel[] = ["instagram", "facebook", "tiktok", "pinterest", "youtube", "threads", "linkedin"];

    // Arthur não decide mais, sozinho, se a peça é imagem ou vídeo — essa escolha vem
    // exclusivamente da mesma classificação que o Eduardo usa (`classifyContentObjective`/
    // `classifyRecommendedFormat`/`pipelineForRecommendedFormat`, em
    // `src/shared/utils/content-format-classification.ts`), a única autoridade sobre o formato da
    // peça (ver docs/arthur-eduardo-format-authority.md). O que resta aqui é só o "gate": se o
    // pedido sugere algum conteúdo visual/audiovisual (canal visual mencionado, ou palavra
    // relacionada a conteúdo/campanha/formato) — sem isso, um pedido puramente de
    // métricas/campanha, por exemplo, não ganha uma pipeline visual à toa. Uma vez que o gate
    // abre, qual pipeline (imagem ou vídeo) entra no plano é 100% a decisão do Eduardo — nunca
    // mais uma segunda lista de palavras independente aqui.
    const wantsAnyVisualAsset = (
      this.detectsVideoRequest(normalizedText, channels)
      || channels.some((channel) => visualChannels.includes(channel))
      || containsAny(normalizedText, [
        "imagem",
        "arte",
        "visual",
        "criativo",
        "post",
        "publicacao",
        "carrossel",
        "carrosseis",
        "carousel",
        "slides",
        "story",
        "stories",
        "banner",
        "anuncio",
        "anuncios",
        "campanha",
        "divulgar produto",
        "divulgar servico",
      ])
    );

    let wantsVideoAsset = false;
    let wantsStaticVisualAsset = false;
    if (wantsAnyVisualAsset) {
      const normalizedForFormat = normalize(text);
      const contentObjective = classifyContentObjective(normalizedForFormat);
      const recommendedFormat = classifyRecommendedFormat(normalizedForFormat, contentObjective);
      const pipeline = pipelineForRecommendedFormat(recommendedFormat);
      wantsVideoAsset = pipeline === "video";
      wantsStaticVisualAsset = pipeline === "image";
    }

    const wantsPublishing = this.detectsPublishingRequest(normalizedText);
    const wantsPaidCampaignManagement = this.detectsPaidCampaignManagementRequest(normalizedText, channels);

    if (wantsStaticVisualAsset) {
      required.add("art_direction");
      required.add("social_media_design");
      required.add("image_generation");
    }

    if (wantsVideoAsset) {
      required.add("video_creation");
      required.add("video_script");
    }

    // Roteiro de vídeo é uma capability própria (Bruno), independente de video_creation (ainda
    // reservada, sem Skill): pedir um roteiro não implica pedir o vídeo finalizado/editado.
    // Gatilho estrutural próprio, intencionalmente fora da correção de divergência Eduardo/Arthur:
    // "roteiro" não é um formato de peça (o vocabulário do Eduardo — imagem única, carrossel,
    // story, reels, vídeo — não tem um valor para "só o roteiro"), é um tipo de entrega diferente.
    // Conhecido: um pedido como "crie um roteiro sobre RSVP" ainda aciona a pipeline de vídeo por
    // esta palavra-chave mesmo que o Eduardo, ao rodar, classifique o assunto como Story — essa
    // combinação específica não foi reportada nem faz parte do escopo desta correção.
    if (containsAny(normalizedText, ["roteiro", "roteirizar", "roteirizacao"])) {
      required.add("video_script");
    }

    // Direção de vídeo (Vanessa) é a segunda etapa da pipeline de vídeo, posicionada depois do
    // Bruno, e depende inteiramente do roteiro que ele produz — por isso é encadeada em cascata
    // sempre que video_script é necessária, em vez de ter sua própria palavra-chave: pedir um
    // roteiro já implica avançar a pipeline de vídeo até onde ela existir hoje.
    if (required.has("video_script")) {
      required.add("video_direction");
    }

    // Edição de vídeo (Diego) é a terceira etapa da pipeline de vídeo, posicionada depois da
    // Vanessa, e depende inteiramente da direção audiovisual que ela produz — mesma lógica de
    // cascata usada para video_direction, sem palavra-chave própria.
    if (required.has("video_direction")) {
      required.add("video_editing");
    }

    // Narração de vídeo (Nora) fica entre Diego e Rafa: recebe timeline/roteiro, cria a locução
    // e só então libera a renderização com voz real validada.
    if (required.has("video_editing")) {
      required.add("video_narration");
    }

    // Renderização de vídeo (Rafa) é a etapa seguinte, posicionada depois da Nora; assim Rafa
    // recebe voz, música e efeitos separados e não precisa assumir responsabilidade de locução.
    if (required.has("video_narration")) {
      required.add("video_rendering");
    }

    if (wantsPublishing) {
      required.add("social_publishing");
    }

    if (wantsPaidCampaignManagement) {
      required.add("campaign_management");
    }

    if (containsAny(normalizedText, ["metricas", "relatorio", "resultado", "desempenho", "analytics"])) {
      required.add("metrics_analysis");
    }

    if (containsAny(normalizedText, ["melhorar", "melhorias", "otimizar", "otimizacao", "sugerir"])) {
      required.add("optimization");
    }

    const available = new Set(availableCapabilities);
    return Array.from(required).filter((capability) => available.has(capability));
  }

  /**
   * Apesar do nome, este método não decide mais sozinho que a pipeline é de vídeo — ele só
   * contribui para o "gate" de `detectRequiredCapabilities` (algum conteúdo visual foi pedido?).
   * A escolha entre pipeline de vídeo ou de imagem é sempre da classificação do Eduardo.
   */
  private detectsVideoRequest(normalizedText: string, channels: ArthurSupportedChannel[]): boolean {
    return (
      containsAny(normalizedText, ["video", "videos", "reels", "reel", "shorts", "short"])
      || channels.includes("tiktok")
      || (channels.includes("youtube") && containsAny(normalizedText, ["shorts", "short"]))
    );
  }

  private detectsPublishingRequest(normalizedText: string): boolean {
    if (detectsPublishingNegation(normalizedText)) {
      return false;
    }

    return containsAny(normalizedText, [
      "publicar",
      "publique",
      "publica isso",
      "postar",
      "poste",
      "agendar",
      "agende",
      "programar",
      "subir nas redes",
      "colocar no ar",
    ]);
  }

  private detectsPaidCampaignManagementRequest(normalizedText: string, channels: ArthurSupportedChannel[]): boolean {
    return (
      channels.includes("meta_ads")
      || channels.includes("google_ads")
      || containsAny(normalizedText, [
        "meta ads",
        "google ads",
        "trafego pago",
        "gestao de campanha",
        "gerenciar campanha",
        "configurar campanha",
        "impulsionar",
        "orcamento de campanha",
        "conjunto de anuncios",
      ])
    );
  }

  /**
   * Arthur não decide o formato final do conteúdo (carrossel, quantidade de slides, Story etc.)
   * nem qual pipeline (vídeo ou imagem) entra no plano — as duas decisões são exclusivamente do
   * Eduardo, através da mesma classificação usada em `detectRequiredCapabilities` (ver
   * `src/shared/utils/content-format-classification.ts`). O único papel que resta aqui é
   * cosmético: quando a pipeline de vídeo já foi decidida (por essa classificação), escolher qual
   * rótulo técnico de plataforma usar (tiktok/shorts/reels) a partir do canal — isso nunca decide
   * se a pipeline é de vídeo ou de imagem, só como ela se chama depois de já decidida.
   */
  private detectFormat(interpretedIntent: ArthurInterpretedIntent): string {
    if (interpretedIntent.requiredCapabilities.includes("video_creation")) {
      if (interpretedIntent.detectedChannels.includes("tiktok")) return "tiktok";
      if (interpretedIntent.detectedChannels.includes("youtube")) return "shorts";
      return "reels";
    }
    return "post único";
  }

  private isMetaPublishing(channels: ArthurSupportedChannel[]): boolean {
    return channels.includes("instagram") || channels.includes("facebook") || channels.includes("meta_ads");
  }
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function detectsPublishingNegation(normalizedText: string): boolean {
  return [
    /\bnao\s+(?:precisa\s+)?(?:publicar|publique|publica|postar|poste|agendar|agende|programar|subir nas redes|colocar no ar)\b/u,
    /\bnao\s+(?:quero|deve|deveria|pode)\s+(?:publicar|publique|publica|postar|poste|agendar|agende|programar)\b/u,
    /\bsem\s+(?:publicar|postar|agendar|programar|publicacao|postagem)\b/u,
    /\bnunca\s+(?:publicar|publique|publica|postar|poste|agendar|agende|programar)\b/u,
  ].some((pattern) => pattern.test(normalizedText));
}
