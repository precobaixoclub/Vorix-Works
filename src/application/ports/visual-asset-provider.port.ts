import type { AssetQualityProfile } from "./asset-quality-profile.js";
import type { MediaApprovalStatus, MediaAssetCapability, MediaAssetIngestionSource, MediaFootageClassification } from "./media-catalog.port.js";

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 2) — classificação canônica de
 * autenticidade, reaproveitada por toda a pipeline de ranking (nunca reimplementada por Shot ou
 * por provider). Nunca inferida só porque o arquivo está armazenado localmente — sempre a partir
 * de proveniência real (`classifyAuthenticity` em `shared/utils/asset-authenticity-policy/`).
 */
export const AUTHENTICITY_CLASSES = [
  "official_original",
  "official_derived",
  "official_historical",
  "synthetic_approved",
  "synthetic_unverified",
  "stock_contextual",
  "generic",
] as const;
export type AuthenticityClass = (typeof AUTHENTICITY_CLASSES)[number];

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 3/5) — papel criativo do Shot para efeito
 * de política de autenticidade: só Shots que REPRESENTAM o produto (`product`) aplicam a Hard
 * Authenticity Constraint (seção 5); Shots humanos/ambientais (`human_emotional`) preservam o
 * ranking criativo normal (seção 6) e nunca sofrem bônus de autenticidade de interface.
 */
export type ShotAuthenticityRole = "product" | "human_emotional" | "brand_identity" | "neutral";

/**
 * "video" (clipe real filmado), "b_roll" (vídeo de apoio/contexto) e "cinemagraph" (imagem com
 * loop de movimento parcial) são conteúdo audiovisual real — sempre priorizados sobre fotografia
 * estática quando disponíveis (ver `mediaPriorityForKind` em `visual-asset-resolver.ts`), porque
 * um vídeo real nunca "parece uma fotografia com movimento aplicado por cima".
 */
export type VisualAssetKind = "photo" | "illustration" | "mockup" | "graphic" | "video" | "b_roll" | "cinemagraph";

export type VisualAssetLicense = {
  name: string;
  url?: string;
  allowsCommercialUse: boolean;
  requiresAttribution: boolean;
};

export type VisualAssetMetadata = {
  id: string;
  provider: string;
  origin: "local_library" | "free_provider" | "developer_assisted";
  absolutePath: string;
  relativePath?: string;
  author?: string;
  sourceUrl?: string;
  license: VisualAssetLicense;
  downloadedAt?: string;
  tags: string[];
  theme?: string;
  emotion?: string;
  width: number;
  height: number;
  aspectRatio: string;
  kind: VisualAssetKind;
  /** Duração real do arquivo, em segundos — só para `video`/`b_roll`/`cinemagraph`. Ausente para fotografia/ilustração/mockup/gráfico estático. */
  durationSeconds?: number;
  /**
   * MEDIA INTELLIGENCE ENGINE — classificação explícita de filmagem real vs. sintética, herdada do
   * catálogo (`MediaAssetRecord.footageClassification`) quando o candidato vem de lá. Ausente para
   * candidatos de providers que não passam pelo catálogo (ex.: biblioteca local legada) — nesse
   * caso o Asset Diversity Gate/Production Readiness continuam usando só `kind` como antes
   * (backward compatible). Nunca inferido/inventado pelo resolver — só o catálogo decide isto.
   */
  footageClassification?: MediaFootageClassification;
  /**
   * PRODUCT COMPOSITING ENGINE — `true`/`false` apenas quando o próprio engine avaliou a
   * legibilidade da tela composta (ver seção 10); `undefined` para qualquer asset que não passou
   * por composição (nunca assumido como legível por omissão para esses).
   */
  legibleProductScreen?: boolean;
  /** INTENT-BASED FOOTAGE ACQUISITION — espelham os mesmos campos de `MediaAssetRecord` (ver esse port para a documentação completa); só preenchidos quando o asset passou pela validação visual heurística pós-download. */
  screenVisible?: boolean;
  compositingReady?: boolean;
  humanInteractionScore?: number;
  productIntegrationScore?: number;
  /** FOOTAGE VISUAL VALIDATION 2.0 — espelham os mesmos campos de `MediaAssetRecord` (ver esse port). `approvalStatus` é o que distingue Production Readiness's `verifiedCompositingCoverage` de `compositingGeometryCoverage`: só candidatos com `approvalStatus === "approved"` (decisão humana explícita, seção 8) contam integralmente. */
  visualValidationStage?: string;
  deviceConfidence?: number;
  screenConfidence?: number;
  humanPresenceScore?: number;
  persistenceRatio?: number;
  occlusionRisk?: boolean;
  approvalStatus?: MediaApprovalStatus;
  // -----------------------------------------------------------------------------------------
  // LOCAL OFFICIAL ASSET QUALIFICATION (sprint anterior) — espelham os mesmos campos de
  // `MediaAssetRecord`; antes desta sprint eram descartados por `mediaAssetToVisualAssetMetadata`
  // e nunca chegavam ao resolver (causa raiz confirmada na auditoria da seção 1). Também
  // preenchidos para candidatos de `LocalVisualAssetLibrary`/`ManifestFreeVisualAssetProvider`
  // quando o manifesto declarar essa proveniência explicitamente (seção 7).
  // -----------------------------------------------------------------------------------------
  capabilities?: MediaAssetCapability[];
  ingestionSource?: MediaAssetIngestionSource;
  sourceFile?: string;
  sourceTimestampSeconds?: number;
  validationDate?: string;
  validatorVersion?: string;
  /**
   * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 2) — quando o provider já sabe a
   * classificação de autenticidade real do asset (manifesto explícito ou composite carimbado na
   * criação — seção 11), este campo é usado DIRETAMENTE pelo classificador em vez de inferida por
   * heurística. Nunca preenchido só porque o arquivo é local.
   */
  authenticityClassOverride?: AuthenticityClass;
};

/**
 * As 6 partes de uma sequência audiovisual coerente por cena (não apenas uma imagem isolada):
 * plano de estabelecimento, detalhe, interação humana, produto, reação e encerramento. Uma cena
 * nunca precisa das 6 — `sequenceRoles` pede só as que fazem sentido para aquele momento da
 * narrativa, na ordem desejada; a primeira posição sempre corresponde ao asset principal da cena.
 */
export type VisualSequenceRole = "establishing" | "detail" | "human_interaction" | "product" | "reaction" | "closing";

export type VisualAssetSearchQuery = {
  executionId: string;
  sceneOrder: number;
  sceneName: string;
  theme: string;
  emotion: string;
  narrativeFunction: string;
  desiredKind: VisualAssetKind;
  framing?: string;
  movement?: string;
  lighting?: string;
  composition?: string;
  requiredTags: string[];
  forbiddenTags?: string[];
  targetWidth: number;
  targetHeight: number;
  targetAspectRatio: string;
  brandKeywords?: string[];
  /**
   * Quantos assets distintos esta cena pede, formando uma sequência visual coerente (ex.: casal →
   * interface do produto), não apenas uma imagem isolada. Opcional; ausente/1 preserva o
   * comportamento anterior (um asset por cena). O resolvedor nunca força um segundo asset abaixo
   * da nota mínima só para atingir o tamanho pedido — a sequência pode sair menor que o pedido.
   */
  sequenceSize?: number;
  /**
   * Versão com papel narrativo explícito de `sequenceSize` — quando presente, tem prioridade sobre
   * `sequenceSize` e define não só quantos assets a cena pede, mas o que cada um deve representar
   * (ver `VisualSequenceRole`). Opcional; ausente preserva o comportamento de `sequenceSize`.
   */
  sequenceRoles?: VisualSequenceRole[];
  /**
   * AGENCY FILM PIPELINE 2.0 — quando presente, esta query representa UM Shot específico
   * (não uma cena inteira com sequência). O resolvedor devolve exatamente 1 asset por query em
   * modo Shot, ignora `sequenceRoles`/`sequenceSize` (que só se aplicam ao modo cena) e nunca
   * reutiliza assets já selecionados em Shots vizinhos (`forbidAssetIds`).
   */
  shotId?: string;
  /** Ordem 1-based do Shot dentro da cena. Só faz sentido em conjunto com `shotId`. */
  shotOrder?: number;
  /** Finalidade narrativa do Shot (mesmo vocabulário de `VisualSequenceRole`). */
  shotPurpose?: VisualSequenceRole;
  /**
   * Ids de assets já usados em outros Shots desta execução — o resolvedor NUNCA seleciona um
   * desses, mesmo que seja o mais bem pontuado, para forçar diversidade visual entre Shots.
   * Aditivo em cima do controle interno de dedupe já feito pelo resolvedor.
   */
  forbidAssetIds?: string[];
  /**
   * SHOT-LEVEL ASSET RESOLUTION — requisitos semânticos por Shot que orientam a seleção do
   * resolver sem inventar heurísticas novas. São aditivos: quando presentes, o resolver pontua
   * mais alto assets que combinam com o requisito e, quando `strictProductRequirement` está
   * ligado, desqualifica candidatos sem `produto-real`/`interface`/`screenshot` nas tags.
   */
  productRequirement?: {
    /** Nome do produto para busca (ex.: "Rumo ao Altar", "RSVP", "álbum colaborativo"). */
    productName: string;
    /** Quando true, rejeita candidatos sem tags de produto (`produto-real`, `interface`, `screenshot`). */
    strict: boolean;
  };
  humanRequirement?: {
    /** Descrição do humano esperado (ex.: "casal recém-noivos", "convidada"). */
    subject: string;
    /** Quando true, rejeita candidatos sem tags humanas (`pessoa`, `casal`, `contexto-humano`). */
    strict: boolean;
  };
  mockupRequirement?: {
    /** Descrição do mockup pedido (ex.: "celular mostrando site oficial"). */
    what: string;
    strict: boolean;
  };
  screenshotRequirement?: {
    /** Interface pedida (ex.: "RSVP", "lista de presentes", "álbum colaborativo"). */
    interface: string;
    strict: boolean;
  };
  /**
   * SHOT-LEVEL ASSET RESOLUTION — texto livre de continuidade cinematográfica que Rafa/Diego
   * escrevem: quando este Shot repete deliberadamente o mesmo momento/sujeito do Shot anterior
   * (mesmo casal, mesma tela, mesmo ambiente), o resolver PODE reutilizar o mesmo asset em vez
   * de forçar variação. Sem este campo, `forbidAssetIds` domina e o resolver nunca reutiliza.
   */
  continuityWithPrevious?: string;
  /** Análogo para o próximo Shot — usado por Lucas/observability, não pelo resolver hoje. */
  continuityWithNext?: string;
  /**
   * Quando presente, marca este Shot como fazendo parte de um grupo de continuidade — Shots do
   * mesmo grupo PODEM reutilizar o mesmo asset (o resolver não força diversidade dentro do
   * grupo). Shots de grupos diferentes seguem a regra normal de dedupe.
   */
  continuityGroup?: string;
  /**
   * COMPOSITE SHOT COVERAGE INTEGRATION — duração real (em segundos) deste Shot no roteiro,
   * quando conhecida (ecoada de `diegoShot.durationSeconds` por `buildShotQuery`). O resolver só
   * usa este campo para verificar se uma Composite Scene Resolution (vários assets dividindo o
   * Shot) ainda deixaria cada segmento com exposição mínima legível (seção 7) — nunca para
   * decidir o asset único de uma resolução simples, que não muda. Ausente preserva o
   * comportamento anterior (resolução simples nunca checa duração).
   */
  shotDurationSeconds?: number;
  /**
   * ASSET DIVERSITY GATE — perfil de qualidade sob o qual este Shot está sendo resolvido. Quando
   * `"premium"`, o resolver nunca aplica `shot_reuse_fallback` (reutilizar silenciosamente um
   * asset de outro Shot quando o melhor candidato fica abaixo da nota mínima) — em vez disso, o
   * Shot cai em `pending` (Developer Assisted Mode), exatamente como quando não há candidato
   * algum. Ausente/`"standard"`/`"draft"` preservam o comportamento legado. Ver
   * `src/application/ports/asset-quality-profile.ts`.
   */
  qualityProfile?: AssetQualityProfile;
};

export type VisualAssetSearchResult = {
  assets: VisualAssetMetadata[];
  warnings: string[];
};

export type VisualAssetProviderPort = {
  readonly providerId: string;
  search(query: VisualAssetSearchQuery): Promise<VisualAssetSearchResult>;
};

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 4) — camadas explícitas de score,
 * substituindo o modelo anterior de 9 dimensões (todas derivadas de forma opaca de
 * `tagRatio`+geometria+kind — ver auditoria no relatório da sprint). Cada dimensão tem uma única
 * responsabilidade e nenhuma delas, sozinha, decide a vitória — em particular, `semanticMatch`
 * nunca pode superar `authenticity` sozinho para um Shot de produto (seção 4/5).
 */
export type VisualAssetScoreBreakdown = {
  /** O candidato pode ser usado, do ponto de vista de aprovação/disponibilidade/licença? */
  eligibility: number;
  /** Fidelidade real à empresa/produto — ver `AuthenticityClass`. Peso depende do papel do Shot (seção 6). */
  authenticity: number;
  /** Quanto o candidato atende aos requisitos estruturados do Shot (screenVisible/compositingReady/interação/tipo pedido). */
  requirementCoverage: number;
  /** Qualidade técnica (resolução — mesma fórmula de antes, nunca reduzida — seção "IMPORTANTE"). */
  visualQuality: number;
  /** Compatibilidade de tags/tema/intenção — o antigo `tagRatio`, agora isolado em uma única dimensão explícita. */
  semanticMatch: number;
  /** Atualidade do material, quando conhecida (`validationDate`/`indexedAt`). Neutro (100) quando desconhecida — nunca penaliza por ausência de dado. */
  freshness: number;
  /** Adequação ao papel narrativo/formato do Shot (proporção, kind, papel na sequência). */
  creativeFitness: number;
};

export type VisualAssetResolved = {
  sceneOrder: number;
  sceneName: string;
  query: VisualAssetSearchQuery;
  asset: VisualAssetMetadata;
  score: number;
  scoreBreakdown: VisualAssetScoreBreakdown;
  selectedFrom: number;
  /** Posição desta entrada dentro da sequência visual da cena (0-based). Ausente/0 = asset único/principal, como antes. */
  sequenceIndex?: number;
  /** Papel narrativo desta entrada na sequência, quando a cena pediu `sequenceRoles`. */
  sequenceRole?: VisualSequenceRole;
  /** AGENCY FILM PIPELINE 2.0 — id do Shot resolvido, ecoado da query (`shotId`) quando presente. */
  shotId?: string;
  /** Ordem do Shot dentro da cena. */
  shotOrder?: number;
  /** Finalidade narrativa do Shot resolvido. */
  shotPurpose?: VisualSequenceRole;
  /**
   * SHOT-LEVEL ASSET RESOLUTION — grupo de continuidade do Shot resolvido (ecoado da query).
   * Shots do mesmo grupo podem legitimamente compartilhar o mesmo `asset.id`.
   */
  continuityGroup?: string;
  /**
   * SHOT-LEVEL ASSET RESOLUTION — id do Shot cujo asset foi REUTILIZADO por este Shot (mesma
   * `continuityGroup`). Vazio quando este Shot recebeu um asset novo. Usado por observability
   * (shot-asset-map.json) para separar repetição intencional de repetição pobre.
   */
  reusedFromShotId?: string;
  /**
   * SHOT-LEVEL ASSET RESOLUTION — motivo humano-legível da seleção deste asset. Formato:
   * "score:82; media:video; matched product-real,rsvp,casal". Nunca é usado pelo compilador;
   * serve para Lucas/relatório entender POR QUÊ este asset foi escolhido.
   */
  selectionReason?: string;
  /** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 2) — classificação de autenticidade do asset selecionado. */
  authenticityClass?: AuthenticityClass;
  /** Papel de autenticidade atribuído ao Shot (seção 3/6) — determina os pesos usados nesta resolução. */
  shotAuthenticityRole?: ShotAuthenticityRole;
  /** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 9) — candidatos avaliados para este Shot, do melhor para o pior, com score total e por dimensão. Nunca só o vencedor — a explicabilidade exige o comparativo. */
  candidatesEvaluated?: RankedCandidateExplanation[];
  /** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 5) — presente só quando a Hard Authenticity Constraint substituiu o vencedor por score puro por um candidato oficial. */
  hardConstraintApplied?: { reason: string; overriddenAssetId: string; overriddenScore: number };
  /**
   * COMPOSITE SHOT COVERAGE INTEGRATION (seção 8) — `"single_asset"` (padrão, ausente preserva
   * comportamento anterior) quando um único candidato satisfez o Shot, como sempre. Presente e
   * igual a `"composite_scene"` só quando NENHUM candidato individual atingiu a nota mínima E uma
   * composição de múltiplos assets (um por requisito atômico) atingiu cobertura agregada
   * suficiente (seção 4). `asset` continua preenchido (primeiro segmento temporal) para nunca
   * quebrar consumidores existentes que só leem `.asset` — o detalhe completo mora em
   * `compositeAssignments`.
   */
  resolutionType?: "single_asset" | "composite_scene";
  /** Presente só quando `resolutionType === "composite_scene"` — um segmento por MicroShot/requisito atômico satisfeito, em ordem temporal. */
  compositeAssignments?: CompositeAssetAssignment[];
  /** Cobertura agregada da Composite Scene Resolution (0-100), calculada pelo Scene Coverage existente (`computeSceneCoverage`) — nunca uma fórmula nova (seção 3). Presente só junto com `compositeAssignments`. */
  aggregateCoveragePercent?: number;
  /** Candidatos considerados para cada requisito atômico mas não escolhidos (seção 8: "candidatos descartados") — observability, nunca usado pelo compilador. */
  compositeDiscardedCandidates?: { microShotId: string; assetId: string; score: number; reason: string }[];
};

/**
 * COMPOSITE SHOT COVERAGE INTEGRATION (seção 8) — um segmento da Composite Scene Resolution: um
 * asset elegível/autêntico satisfazendo UM requisito atômico (MicroShot) do Shot composto. `weight`
 * é a fração (0-1) do tempo total do Shot que este segmento ocupa — a conversão para segundos
 * absolutos acontece em `buildShotTimelineForRender` (Rafa), que já conhece a duração real do Shot;
 * o resolver nunca inventa segundos porque `VisualAssetSearchQuery` nem sempre traz
 * `shotDurationSeconds`.
 */
export type CompositeAssetAssignment = {
  microShotId: string;
  /** Descrição do requisito atômico (ex.: "feature: lista_de_presentes", "context: convidados_interagindo"). */
  description: string;
  atomicType: "feature" | "context";
  mandatory: boolean;
  asset: VisualAssetMetadata;
  authenticityClass: AuthenticityClass;
  score: number;
  scoreBreakdown: VisualAssetScoreBreakdown;
  /** Fração (0-1) do tempo do Shot atribuída a este segmento — pesos de todos os segmentos somam 1.0 (mesma regra de `computeMicroShotWeights`). */
  weight: number;
  hardConstraintApplied?: { reason: string; overriddenAssetId: string; overriddenScore: number };
  selectionReason: string;
};

/** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 9) — uma linha do relatório explicável de ranking. */
export type RankedCandidateExplanation = {
  assetId: string;
  provider: string;
  origin: string;
  authenticityClass: AuthenticityClass;
  score: number;
  scoreBreakdown: VisualAssetScoreBreakdown;
  eligible: boolean;
  rejectionReasons: string[];
  selected: boolean;
};

/** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 10) — emitido quando um asset sintético não-verificado venceria um oficial elegível, antes da Hard Authenticity Constraint decidir o resultado final. */
export type AuthenticityRankingConflict = {
  type: "AUTHENTICITY_RANKING_CONFLICT";
  shotId?: string;
  sceneOrder: number;
  officialAssetId: string;
  officialScore: number;
  syntheticAssetId: string;
  syntheticScore: number;
  reason: string;
  ruleApplied: string;
  resolvedInFavorOf: "official" | "synthetic";
};

export type VisualAssetCreationPackage = {
  sceneOrder: number;
  sceneName: string;
  expectedRelativePath: string;
  expectedAbsolutePath: string;
  width: number;
  height: number;
  aspectRatio: string;
  prompt: string;
  tags: string[];
  emotion: string;
  narrativeFunction: string;
  license: VisualAssetLicense;
  /**
   * ASSET DIVERSITY GATE — campos opcionais adicionais preenchidos quando este pacote representa
   * um Shot específico bloqueado pelo Diversity Gate (perfil premium), não apenas uma cena sem
   * nenhum candidato. Todos opcionais para preservar compatibilidade com o fluxo legado de
   * criação por cena (Sofia/Bianca/Pedro nunca preenchem estes campos).
   */
  shotId?: string;
  shotPurpose?: VisualSequenceRole;
  /** Tipo de mídia necessário para este Shot (ex.: "video", "photo", "mockup"). */
  requiredKind?: VisualAssetKind;
  /** Descrição humano-legível do sujeito esperado (pessoa/produto/contexto), ex.: "casal recém-noivos em close-up". */
  requiredSubject?: string;
  /** Ação/descrição concreta esperada em cena, ex.: "casal se abraçando durante a cerimônia". */
  requiredAction?: string;
  /** Enquadramento pedido, ex.: "Close-up no rosto, direto para a câmera". */
  requiredFraming?: string;
  /** Movimento de câmera/asset sugerido, ex.: "leve handheld". */
  requiredMovement?: string;
  /** Duração esperada em segundos, só quando `requiredKind` é vídeo/b-roll/cinemagraph. */
  requiredDurationSeconds?: number;
  /** Iluminação pedida, ex.: "luz natural dourada de fim de tarde". */
  requiredLighting?: string;
  /** Id do asset físico que foi rejeitado para este Shot (quando havia um candidato, mas insuficiente). */
  rejectedAssetId?: string;
  /** Motivo humano-legível da rejeição (ex.: "reuso excede 20% dos Shots", "Shot estrito de produto sem candidato com tag de produto real"). */
  rejectionReason?: string;
  /** Grupo de continuidade cinematográfica, quando este Shot faz parte de um (ver `continuityGroup`). */
  continuityGroup?: string;
  /** Ids de todos os Shots que este único pacote de criação cobre — preenchido quando solicitações semelhantes foram agrupadas (ver seção "Reuso intencional"/"Pacote assistido"). */
  coversShotIds?: string[];
};

export type VisualAssetResolutionRequest = {
  executionId: string;
  scenes: VisualAssetSearchQuery[];
};

export type VisualAssetResolutionResult = {
  resolved: VisualAssetResolved[];
  pending: VisualAssetCreationPackage[];
  warnings: string[];
  reportRelativePath?: string;
  /** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 10) — nunca ocultado, mesmo quando a Hard Authenticity Constraint corrige o resultado a favor do oficial. */
  authenticityConflicts?: AuthenticityRankingConflict[];
  /** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 13) — metadados de proveniência desta resolução, para detectar `ASSET_RESOLUTION_STALE`. */
  resolutionMetadata?: AssetResolutionMetadata;
  /** NARRATIVE TIMING REBALANCING (seção 5) — déficits de duração detectados ao tentar Composite Scene Resolution, antes de desistir para Developer Assisted Mode. A implementação real (`VisualAssetResolver`) sempre preenche (array vazio quando nenhum déficit ocorreu); opcional para nunca quebrar outras implementações de `VisualAssetResolverPort` (ex.: dublês de teste) que ainda não conhecem este campo. */
  timingDeficits?: TimingDeficit[];
};

/** NARRATIVE TIMING REBALANCING (seção 5) — sinal estruturado de déficit temporal, consumido pelo planejador de realocação (`shared/utils/timing-rebalancing/`). `requiredMinimumDuration` vem sempre de um cálculo real (nunca um número fixo — seção "IMPORTANTE"). */
export type TimingDeficit = {
  type: "TIMING_DEFICIT";
  shotId: string;
  sceneOrder: number;
  allocatedDuration: number;
  requiredMinimumDuration: number;
  deficit: number;
  reason: string;
  blockingRequirements: string[];
};

/** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 13) — carimbo de versão desta resolução, nunca inferido. */
export type AssetResolutionMetadata = {
  catalogHash: string;
  rankingPolicyVersion: string;
  validatorVersion: string;
  resolvedAt: string;
};

export type VisualAssetResolverPort = {
  resolve(input: VisualAssetResolutionRequest): Promise<VisualAssetResolutionResult>;
};
