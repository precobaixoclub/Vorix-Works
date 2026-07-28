import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  AuthenticityRankingConflict,
  CompositeAssetAssignment,
  TimingDeficit,
  VisualAssetCreationPackage,
  VisualAssetMetadata,
  VisualAssetProviderPort,
  VisualAssetResolved,
  VisualAssetResolutionRequest,
  VisualAssetResolutionResult,
  VisualAssetResolverPort,
  VisualAssetScoreBreakdown,
  VisualAssetSearchQuery,
} from "../../application/ports/visual-asset-provider.port.js";
import { extname } from "node:path";
import { isVideoExtension, normalizeAspectRatio, readRasterDimensions, readVideoMetadata } from "./visual-asset-metadata.js";
import { HUMAN_TAG_SIGNAL, MOCKUP_TAG_SIGNAL, PRODUCT_TAG_SIGNAL, SCREENSHOT_TAG_SIGNAL } from "../../shared/utils/visual-asset-tag-signals.js";
// OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY — camada aditiva de classificação/score/hard
// constraint; substitui só o CÁLCULO de score (`scoreAsset`/`scoreTotal` antigos), nunca a
// estrutura de resolução ao redor (overrides de caminho convencional, continuidade, diversidade,
// Developer Assisted Mode) — todos preservados exatamente como estavam.
import { classifyVisualAsset } from "../../shared/utils/asset-authenticity-policy/classify-visual-asset.js";
import { scoreAssetLayered, scoreTotalLayered, weightsForRole } from "../../shared/utils/asset-authenticity-policy/layered-scoring.js";
import { deriveShotAuthenticityRole } from "../../shared/utils/asset-authenticity-policy/shot-role.js";
import { resolveWithAuthenticityPolicy, type ScoredCandidate } from "../../shared/utils/asset-authenticity-policy/hard-authenticity-constraint.js";
import { RANKING_POLICY_VERSION } from "../../shared/utils/asset-authenticity-policy/ranking-policy-version.js";
import { LOCAL_ASSET_VALIDATOR_VERSION } from "../../shared/utils/local-asset-qualification/validator-version.js";
import { buildResolutionMetadata, computeCatalogFingerprint } from "../../shared/utils/asset-authenticity-policy/resolution-metadata.js";
// COMPOSITE SHOT COVERAGE INTEGRATION — ponte que integra Shot Decomposer/Scene Coverage/
// Authenticity Policy já existentes para resolver um Shot composto por vários assets quando a
// resolução de asset único falha; nunca substitui a estrutura de resolução ao redor.
import { attemptCompositeSceneResolution } from "../../shared/utils/scene-composition/composite-shot-coverage.js";

/**
 * ASSET DIVERSITY GATE / VÍDEO E B-ROLL — lê dimensões (e duração, quando vídeo) de um asset
 * criado pela IA desenvolvedora em Developer Assisted Mode. Antes desta extensão, todo asset
 * assistido era lido como imagem raster (PNG/JPG) mesmo quando `desiredKind`/a extensão pedida
 * eram vídeo — o que quebraria a validação de qualquer .mp4/.mov/.webm real salvo pela IA
 * desenvolvedora. Despacha pela EXTENSÃO do arquivo (não por `desiredKind`) porque é o arquivo
 * físico salvo em disco que determina como ele precisa ser lido.
 */
async function readAssetDimensions(absolutePath: string): Promise<{ width: number; height: number; durationSeconds?: number }> {
  if (isVideoExtension(extname(absolutePath))) return readVideoMetadata(absolutePath);
  return readRasterDimensions(absolutePath);
}

/** Extensão de arquivo esperada para o Developer Assisted Mode criar este asset — vídeo/b-roll real precisam de um arquivo de vídeo de verdade, nunca uma imagem com nome de vídeo. */
function expectedExtensionForKind(kind: VisualAssetMetadata["kind"]): string {
  return kind === "video" || kind === "b_roll" ? "mp4" : "png";
}

function isVideoLikeKind(kind: VisualAssetMetadata["kind"]): boolean {
  return kind === "video" || kind === "b_roll" || kind === "cinemagraph";
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export type VisualAssetResolverOptions = {
  providers: VisualAssetProviderPort[];
  artifactsRootDir: string;
  minimumScore?: number;
};

export class VisualAssetResolver implements VisualAssetResolverPort {
  private readonly providers: VisualAssetProviderPort[];
  private readonly artifactsRootDir: string;
  private readonly minimumScore: number;

  constructor(options: VisualAssetResolverOptions) {
    this.providers = options.providers;
    this.artifactsRootDir = resolve(options.artifactsRootDir);
    this.minimumScore = options.minimumScore ?? 62;
  }

  async resolve(input: VisualAssetResolutionRequest): Promise<VisualAssetResolutionResult> {
    const resolved: VisualAssetResolved[] = [];
    const pending: VisualAssetCreationPackage[] = [];
    const warnings: string[] = [];
    const authenticityConflicts: AuthenticityRankingConflict[] = [];
    // NARRATIVE TIMING REBALANCING (seção 5) — déficits estruturados de duração detectados
    // durante a tentativa de Composite Scene Resolution, para quem quiser tentar realocar tempo
    // antes de aceitar Developer Assisted Mode.
    const timingDeficits: TimingDeficit[] = [];
    const selectedAssetIds = new Set<string>();
    // OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 13) — todo candidato realmente visto
    // nesta resolução, para o fingerprint de staleness (`resolutionMetadata`). Nunca lê o catálogo
    // inteiro diretamente (o resolver não tem acesso a ele) — só o que os providers devolveram.
    const allCandidatesSeen = new Map<string, VisualAssetMetadata>();
    // SHOT-LEVEL ASSET RESOLUTION — mapa de continuidade: um grupo (`continuityGroup` na query)
    // reserva um asset para reuso legítimo em Shots subsequentes do mesmo grupo. Sem este mapa,
    // o resolvedor forçaria diversidade mesmo entre Shots que representam o mesmo momento (mesmo
    // casal, mesma tela) — o que é continuidade cinematográfica, não repetição pobre.
    const continuityAssetByGroup = new Map<string, { assetId: string; shotId?: string; assetMeta: VisualAssetMetadata; score: number; scoreBreakdown: VisualAssetScoreBreakdown }>();

    for (const scene of input.scenes) {
      const candidates: VisualAssetMetadata[] = [];
      for (const provider of this.providers) {
        const result = await provider.search(scene);
        candidates.push(...result.assets);
        for (const asset of result.assets) allCandidatesSeen.set(asset.id, asset);
        warnings.push(...result.warnings.map((warning) => `${provider.providerId}: ${warning}`));
      }

      const forbiddenFromCaller = new Set(scene.forbidAssetIds ?? []);
      const isShotQuery = typeof scene.shotId === "string" && scene.shotId.length > 0;

      // ASSET DIVERSITY GATE / DEVELOPER ASSISTED MODE — quando já existe um arquivo real salvo
      // no caminho CONVENCIONAL deste Shot (`visual-assets/scene-XX-shot-YY.<ext>`), ele SEMPRE
      // vence — mesmo que a biblioteca tenha um candidato "bom o suficiente" via reuso. Sem este
      // override, um Shot flagado pelo Asset Diversity Gate (que pede um arquivo novo justamente
      // porque o reuso da biblioteca não é suficiente) nunca conseguiria fazer o arquivo recém
      // criado pela IA desenvolvedora ser efetivamente usado: o scoring normal continuaria achando
      // o asset reciclado da biblioteca "bom o suficiente" e nunca chegaria a olhar para o caminho
      // assistido, porque esse caminho só era checado quando NENHUM candidato cruzava a nota
      // mínima. Aqui a checagem roda ANTES de qualquer scoring — um arquivo real no caminho
      // esperado é sempre uma decisão explícita e intencional, nunca "menos confiável" que reuso
      // automático de biblioteca.
      if (isShotQuery) {
        const conventionalPathBase = `visual-assets/scene-${String(scene.sceneOrder).padStart(2, "0")}-shot-${String(scene.shotOrder ?? 0).padStart(2, "0")}`;
        // ASSET DIVERSITY GATE — tags do override refletem o que a QUERY já pediu explicitamente
        // (humanRequirement/productRequirement/mockupRequirement/screenshotRequirement/closing),
        // nunca inventadas: se o Shot já declarava precisar de humano/produto, o arquivo real que
        // a IA desenvolvedora salvou ali É esse conteúdo por definição — o resolver só está
        // registrando explicitamente o que a query já garantia, para que o Diversity Gate consiga
        // classificar corretamente um asset humano/de produto/de contexto/de end card criado sob
        // demanda (o `readDeveloperAssistedAssetIfExists` normal só herda `requiredTags`, que nem
        // sempre carrega esse vocabulário).
        const overrideTags = normalizeTags([
          ...scene.requiredTags,
          ...(scene.humanRequirement ? ["pessoa", "contexto-humano"] : []),
          ...(scene.productRequirement ? ["produto-real", "interface"] : []),
          ...(scene.mockupRequirement ? ["mockup", "mockup-produto"] : []),
          ...(scene.screenshotRequirement ? ["screenshot", "interface"] : []),
          ...(scene.shotPurpose === "closing" ? ["cta", "logo", "marca", "url"] : []),
          ...(scene.shotPurpose === "establishing" || scene.shotPurpose === "reaction" ? ["contexto-humano", "foto-contexto"] : []),
        ]);
        // Tenta vídeo primeiro, depois imagem: o Asset Diversity Gate pode ter pedido um tipo
        // DIFERENTE do `desiredKind` original da cena (ex.: uma cena de foto sinalizada como
        // "insufficient_video" vira um pedido de vídeo) — o override nunca pode assumir que a
        // extensão do arquivo real bate com o `desiredKind` original da query.
        let conventionalOverride: { resolved?: VisualAssetResolved; warnings: string[] } = { warnings: [] };
        for (const candidateExtension of ["mp4", "mov", "webm", "png", "jpg", "jpeg"]) {
          conventionalOverride = await readDeveloperAssistedAssetIfExists({
            executionId: input.executionId,
            artifactsRootDir: this.artifactsRootDir,
            pending: {
              sceneOrder: scene.sceneOrder,
              sceneName: scene.sceneName,
              expectedRelativePath: `${conventionalPathBase}.${candidateExtension}`,
              expectedAbsolutePath: "",
              width: scene.targetWidth,
              height: scene.targetHeight,
              aspectRatio: scene.targetAspectRatio,
              prompt: "",
              tags: overrideTags,
              emotion: scene.emotion,
              narrativeFunction: scene.narrativeFunction,
              license: {
                name: "Gerado localmente pela IA desenvolvedora para uso do cliente",
                allowsCommercialUse: true,
                requiresAttribution: false,
              },
            },
            query: scene,
            silent: true,
          });
          if (conventionalOverride.resolved) break;
        }
        if (conventionalOverride.resolved) {
          const overrideResolved = conventionalOverride.resolved;
          selectedAssetIds.add(overrideResolved.asset.id);
          if (scene.continuityGroup && !continuityAssetByGroup.has(scene.continuityGroup)) {
            continuityAssetByGroup.set(scene.continuityGroup, {
              assetId: overrideResolved.asset.id,
              shotId: scene.shotId,
              assetMeta: overrideResolved.asset,
              score: overrideResolved.score,
              scoreBreakdown: overrideResolved.scoreBreakdown,
            });
          }
          resolved.push(overrideResolved);
          continue;
        }
      }

      // SHOT-LEVEL ASSET RESOLUTION — quando o Shot declara `continuityGroup` E o grupo já tem
      // asset reservado, REUTILIZAMOS o mesmo asset (continuidade cinematográfica intencional).
      // O `forbidAssetIds` NÃO impede reuso dentro do mesmo grupo — a intenção do chamador é
      // "manter o mesmo asset ao longo desta continuidade".
      if (isShotQuery && scene.continuityGroup) {
        const reserved = continuityAssetByGroup.get(scene.continuityGroup);
        if (reserved) {
          resolved.push({
            sceneOrder: scene.sceneOrder,
            sceneName: scene.sceneName,
            query: scene,
            asset: reserved.assetMeta,
            score: reserved.score,
            scoreBreakdown: reserved.scoreBreakdown,
            selectedFrom: candidates.length,
            sequenceIndex: 0,
            sequenceRole: scene.shotPurpose,
            shotId: scene.shotId,
            shotOrder: scene.shotOrder,
            shotPurpose: scene.shotPurpose,
            continuityGroup: scene.continuityGroup,
            reusedFromShotId: reserved.shotId,
            selectionReason: `continuity_reuse; group=${scene.continuityGroup}; previous_shot=${reserved.shotId ?? "?"}`,
          });
          continue;
        }
      }

      const strictProductRequirement = Boolean(scene.productRequirement?.strict);
      const strictHumanRequirement = Boolean(scene.humanRequirement?.strict);
      const strictMockupRequirement = Boolean(scene.mockupRequirement?.strict);
      const strictScreenshotRequirement = Boolean(scene.screenshotRequirement?.strict);

      // OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seções 2-5) — papel de autenticidade do
      // Shot decide os pesos (produto/marca vs. humano/ambiental, seção 6), classificação de
      // autenticidade é calculada por candidato (nunca inferida só por armazenamento local).
      const shotAuthenticityRole = deriveShotAuthenticityRole(scene);
      const roleWeights = weightsForRole(shotAuthenticityRole);
      const scoredRaw: ScoredCandidate[] = candidates
        .filter((asset) => !forbiddenFromCaller.has(asset.id))
        .filter((asset) => passesStrictRequirements(asset, {
          product: strictProductRequirement,
          human: strictHumanRequirement,
          mockup: strictMockupRequirement,
          screenshot: strictScreenshotRequirement,
        }))
        .map((asset) => {
          const authenticityClass = classifyVisualAsset(asset);
          const breakdown = scoreAssetLayered(asset, scene, authenticityClass);
          return { asset, authenticityClass, breakdown, score: scoreTotalLayered(breakdown, roleWeights) };
        })
        // OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 8) — em empate exato de score
        // ENTRE PROVIDERS diferentes, desempata por `assetId` (conteúdo) em vez de deixar a
        // ordem de iteração de `this.providers` decidir silenciosamente. Empates DENTRO do
        // mesmo provider preservam a ordem original (estabilidade do sort) — o viés real
        // identificado na auditoria era "qual provider foi iterado primeiro", nunca a ordem de
        // descoberta dentro de um único provider (que já é neutra por natureza).
        .sort((a, b) => b.score - a.score || (a.asset.provider === b.asset.provider ? 0 : a.asset.id.localeCompare(b.asset.id)));

      // Seção 5/10 — corrige (quando aplicável) um synthetic_unverified vencendo um oficial
      // elegível e adequado, e SEMPRE registra o conflito, mesmo quando não corrige (seção 6).
      const authenticityResolution = resolveWithAuthenticityPolicy({
        scoredDescending: scoredRaw,
        role: shotAuthenticityRole,
        minimumScore: this.minimumScore,
        shotId: scene.shotId,
        sceneOrder: scene.sceneOrder,
      });
      if (authenticityResolution.conflict) authenticityConflicts.push(authenticityResolution.conflict);

      const scored = authenticityResolution.hardConstraintApplied
        ? [authenticityResolution.winner!, ...scoredRaw.filter((entry) => entry.asset.id !== authenticityResolution.winner!.asset.id)]
        : scoredRaw;
      const candidatesEvaluated = scoredRaw.map((entry) => ({
        assetId: entry.asset.id,
        provider: entry.asset.provider,
        origin: entry.asset.origin,
        authenticityClass: entry.authenticityClass,
        score: entry.score,
        scoreBreakdown: entry.breakdown,
        eligible: entry.score >= this.minimumScore,
        rejectionReasons: entry.score < this.minimumScore ? [`Score ${entry.score} abaixo do mínimo ${this.minimumScore}.`] : [],
        selected: false,
      }));

      const best = chooseBestAssetForScene(scored, selectedAssetIds, scene, this.minimumScore);
      if (best) {
        const evaluatedEntry = candidatesEvaluated.find((entry) => entry.assetId === best.asset.id);
        if (evaluatedEntry) evaluatedEntry.selected = true;
      }
      if (best && best.score >= this.minimumScore) {
        const wasAlreadySelected = selectedAssetIds.has(best.asset.id);
        const previousUse = wasAlreadySelected
          ? resolved.find((r) => r.asset.id === best.asset.id)
          : undefined;
        selectedAssetIds.add(best.asset.id);
        // Se este Shot abre um grupo de continuidade, reservamos o asset para reuso nos próximos
        // Shots do mesmo grupo.
        if (isShotQuery && scene.continuityGroup && !continuityAssetByGroup.has(scene.continuityGroup)) {
          continuityAssetByGroup.set(scene.continuityGroup, {
            assetId: best.asset.id,
            shotId: scene.shotId,
            assetMeta: best.asset,
            score: best.score,
            scoreBreakdown: best.breakdown,
          });
        }
        resolved.push({
          sceneOrder: scene.sceneOrder,
          sceneName: scene.sceneName,
          query: scene,
          asset: best.asset,
          score: best.score,
          scoreBreakdown: best.breakdown,
          selectedFrom: candidates.length,
          authenticityClass: best.authenticityClass,
          shotAuthenticityRole,
          candidatesEvaluated,
          hardConstraintApplied: authenticityResolution.hardConstraintApplied,
          sequenceIndex: 0,
          sequenceRole: isShotQuery ? scene.shotPurpose : scene.sequenceRoles?.[0],
          shotId: scene.shotId,
          shotOrder: scene.shotOrder,
          shotPurpose: scene.shotPurpose,
          continuityGroup: scene.continuityGroup,
          // SHOT-LEVEL ASSET RESOLUTION — quando o `chooseBestAssetForScene` acabou devolvendo
          // um asset já usado por outro Shot (biblioteca esgotou candidatos únicos acima do
          // score mínimo), marcamos explicitamente `reusedFromShotId` para observability.
          reusedFromShotId: isShotQuery && wasAlreadySelected ? previousUse?.shotId : undefined,
          selectionReason: isShotQuery && wasAlreadySelected
            ? `shot_reuse; score=${best.score}; previous_shot=${previousUse?.shotId ?? "?"}`
            : buildSelectionReason(best, scene),
        });

        // Em modo Shot, o fanning-out por `sequenceRoles`/`sequenceSize` NÃO se aplica — a
        // sequência de Shots é orquestrada externamente (Rafa/Diego pedem 1 query por Shot).
        // Só o modo cena legado abre múltiplos assets a partir de `sequenceRoles`.
        if (!isShotQuery) {
          // Narrativa audiovisual em sequência (ex.: plano de estabelecimento -> detalhe -> interação
          // humana -> produto -> reação -> encerramento), não só uma imagem isolada — só tenta
          // preencher slots ADICIONAIS quando a cena pede (`sequenceRoles`/`sequenceSize > 1`).
          // Nunca força um asset abaixo da nota mínima nem repete o mesmo asset já usado nesta cena
          // ou em outra: se não houver candidato genuíno para um slot, a sequência fica menor que o
          // pedido, e a cena simplesmente segue com o que foi encontrado, como antes.
          const wantedSequenceSize = scene.sequenceRoles?.length ?? Math.max(1, Math.round(scene.sequenceSize ?? 1));
          for (let sequenceIndex = 1; sequenceIndex < wantedSequenceSize; sequenceIndex += 1) {
            const next = scored.find((entry) => !selectedAssetIds.has(entry.asset.id) && entry.score >= this.minimumScore);
            if (!next) break;
            selectedAssetIds.add(next.asset.id);
            resolved.push({
              sceneOrder: scene.sceneOrder,
              sceneName: scene.sceneName,
              query: scene,
              asset: next.asset,
              score: next.score,
              scoreBreakdown: next.breakdown,
              selectedFrom: candidates.length,
              sequenceIndex,
              sequenceRole: scene.sequenceRoles?.[sequenceIndex],
            });
          }
        }
        continue;
      }

      // ASSET DIVERSITY GATE — em perfil premium, `shot_reuse_fallback` NUNCA mascara diversidade
      // insuficiente: um Shot cujo melhor candidato fica abaixo da nota mínima cai direto em
      // `pending` (Developer Assisted Mode) como se não houvesse candidato algum. Isso é o que
      // impede 20 Shots premium de silenciosamente convergirem para 5 arquivos físicos reciclados.
      const allowsReuseFallback = scene.qualityProfile !== "premium";

      // COMPOSITE SHOT COVERAGE INTEGRATION (seção 10) — tentado ANTES do `shot_reuse_fallback`
      // (que recicla um asset de OUTRO Shot só porque passou no mínimo lá, sem relação real com
      // ESTE requisito) e ANTES de Developer Assisted Mode: uma composição de vários assets REAIS
      // que juntos cobrem o requisito é sempre preferível a reciclar um asset não relacionado ou
      // pausar a produção. Só roda quando a resolução simples já falhou (`best` ausente ou abaixo
      // da nota mínima) — nunca degrada um Shot que já tem asset único adequado (seção 10).
      if (isShotQuery && (!best || best.score < this.minimumScore)) {
        const compositeCandidates = candidates.filter((asset) => !forbiddenFromCaller.has(asset.id));
        const attempt = attemptCompositeSceneResolution({
          query: scene,
          candidates: compositeCandidates,
          shotAuthenticityRole,
          minimumScore: this.minimumScore,
          shotId: scene.shotId!,
        });
        if (attempt.accepted) {
          // Todo cluster nasce com a mesma prioridade ("obrigatorio" — ver `composite-shot-coverage.ts`),
          // então o peso é uniforme (1/N), o mesmo resultado que `computeMicroShotWeights` daria
          // para prioridades idênticas — nunca uma fórmula de peso paralela.
          const totalWeight = attempt.units.length;
          const compositeAssignments: CompositeAssetAssignment[] = attempt.units.map((unit, index) => ({
            microShotId: unit.cluster.microShotId,
            description: unit.cluster.description,
            atomicType: unit.cluster.atomicType,
            mandatory: true,
            asset: unit.winner!.asset,
            authenticityClass: unit.winner!.authenticityClass,
            score: unit.winner!.score,
            scoreBreakdown: unit.winner!.breakdown,
            weight: 1 / totalWeight,
            hardConstraintApplied: unit.hardConstraintApplied,
            selectionReason: `composite_scene; unit=${index + 1}/${attempt.units.length}; score:${unit.winner!.score}; ${unit.cluster.description}`,
          }));
          for (const assignment of compositeAssignments) selectedAssetIds.add(assignment.asset.id);
          resolved.push({
            sceneOrder: scene.sceneOrder,
            sceneName: scene.sceneName,
            query: scene,
            asset: compositeAssignments[0].asset,
            score: attempt.aggregateCoveragePercent!,
            scoreBreakdown: compositeAssignments[0].scoreBreakdown,
            selectedFrom: candidates.length,
            authenticityClass: compositeAssignments[0].authenticityClass,
            shotAuthenticityRole,
            candidatesEvaluated,
            sequenceIndex: 0,
            sequenceRole: scene.shotPurpose,
            shotId: scene.shotId,
            shotOrder: scene.shotOrder,
            shotPurpose: scene.shotPurpose,
            continuityGroup: scene.continuityGroup,
            resolutionType: "composite_scene",
            compositeAssignments,
            aggregateCoveragePercent: attempt.aggregateCoveragePercent,
            compositeDiscardedCandidates: attempt.units.flatMap((unit) => unit.discarded.map((entry) => ({ microShotId: unit.cluster.microShotId, assetId: entry.assetId, score: entry.score, reason: `Não venceu o requisito atômico "${unit.cluster.description}".` }))),
            selectionReason: attempt.reason,
          });
          warnings.push(`Shot ${scene.shotId} (cena ${scene.sceneOrder}): resolvido por Composite Scene Resolution — ${attempt.reason}`);
          continue;
        }
        warnings.push(`Shot ${scene.shotId} (cena ${scene.sceneOrder}): Composite Scene Resolution não aplicada — ${attempt.reason}`);
        // NARRATIVE TIMING REBALANCING (seção 5) — sinal ESTRUTURADO (nunca só o texto do
        // warning acima) para quem quiser tentar realocar duração antes de desistir para
        // Developer Assisted Mode. `requiredMinimumDuration` vem do que a composição real
        // calculou — nunca um número fixo.
        if (attempt.timingRequirement && scene.shotDurationSeconds !== undefined) {
          const deficit = Number.parseFloat((attempt.timingRequirement.requiredMinimumDuration - scene.shotDurationSeconds).toFixed(3));
          if (deficit > 0) {
            timingDeficits.push({
              type: "TIMING_DEFICIT",
              shotId: scene.shotId!,
              sceneOrder: scene.sceneOrder,
              allocatedDuration: scene.shotDurationSeconds,
              requiredMinimumDuration: attempt.timingRequirement.requiredMinimumDuration,
              deficit,
              reason: `${attempt.timingRequirement.segmentCount} segmentos compostos exigem ${attempt.timingRequirement.minimumSegmentDuration}s cada.`,
              blockingRequirements: [`composite_scene: ${attempt.timingRequirement.segmentCount} segmentos x ${attempt.timingRequirement.minimumSegmentDuration}s`],
            });
          }
        }
      }

      // SHOT-LEVEL ASSET RESOLUTION — fallback específico para modo Shot: quando o melhor
      // candidato fica abaixo da nota mínima (biblioteca pequena, dedupe global exauriu os
      // assets ideais) MAS há candidatos existentes, reutilizamos o melhor asset JÁ SELECIONADO
      // por outro Shot em vez de cair em Developer Assisted Mode. Sem esse fallback, bibliotecas
      // com N assets < N shots forçariam pausa assistida mesmo quando o próprio SCENE query teria
      // sucedido. `reusedFromShotId` documenta a origem do reuso para observability. Desativado em
      // perfil premium (ver `allowsReuseFallback` acima).
      if (isShotQuery && scored.length > 0 && allowsReuseFallback) {
        const reusableEntry = scored.find((entry) => selectedAssetIds.has(entry.asset.id))
          ?? scored[0];
        if (reusableEntry) {
          const previousUse = resolved.find((r) => r.asset.id === reusableEntry.asset.id);
          resolved.push({
            sceneOrder: scene.sceneOrder,
            sceneName: scene.sceneName,
            query: scene,
            asset: reusableEntry.asset,
            score: reusableEntry.score,
            scoreBreakdown: reusableEntry.breakdown,
            selectedFrom: candidates.length,
            sequenceIndex: 0,
            sequenceRole: scene.shotPurpose,
            shotId: scene.shotId,
            shotOrder: scene.shotOrder,
            shotPurpose: scene.shotPurpose,
            continuityGroup: scene.continuityGroup,
            reusedFromShotId: previousUse?.shotId,
            selectionReason: `shot_reuse_fallback; score=${reusableEntry.score}; below_min=${this.minimumScore}; previous_shot=${previousUse?.shotId ?? "?"}`,
          });
          warnings.push(
            `Shot ${scene.shotId ?? "?"} (cena ${scene.sceneOrder}): melhor asset "${reusableEntry.asset.id}" ficou abaixo da nota mínima (${reusableEntry.score}/${this.minimumScore}); reutilizado do Shot ${previousUse?.shotId ?? "anterior"} para evitar pausa assistida.`,
          );
          continue;
        }
      }

      const expectedExtension = expectedExtensionForKind(scene.desiredKind);
      const expectedRelativePath = isShotQuery
        ? `visual-assets/scene-${String(scene.sceneOrder).padStart(2, "0")}-shot-${String(scene.shotOrder ?? 0).padStart(2, "0")}.${expectedExtension}`
        : `visual-assets/scene-${String(scene.sceneOrder).padStart(2, "0")}.${expectedExtension}`;
      const creationPackage: VisualAssetCreationPackage = {
        sceneOrder: scene.sceneOrder,
        sceneName: scene.sceneName,
        expectedRelativePath,
        expectedAbsolutePath: resolve(this.artifactsRootDir, input.executionId, expectedRelativePath),
        width: scene.targetWidth,
        height: scene.targetHeight,
        aspectRatio: scene.targetAspectRatio,
        prompt: buildCreationPrompt(scene),
        tags: scene.requiredTags,
        emotion: scene.emotion,
        narrativeFunction: scene.narrativeFunction,
        license: {
          name: "Gerado localmente pela IA desenvolvedora para uso do cliente",
          allowsCommercialUse: true,
          requiresAttribution: false,
        },
      };
      const assistedAsset = await readDeveloperAssistedAssetIfExists({
        executionId: input.executionId,
        artifactsRootDir: this.artifactsRootDir,
        pending: creationPackage,
        query: scene,
      });
      if (assistedAsset.resolved) {
        resolved.push(assistedAsset.resolved);
        warnings.push(...assistedAsset.warnings);
        continue;
      }
      pending.push(creationPackage);
      warnings.push(...assistedAsset.warnings);
      if (best) warnings.push(`Cena ${scene.sceneOrder}: melhor asset "${best.asset.id}" ficou abaixo da nota mínima (${best.score}/${this.minimumScore}).`);
    }

    // OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 13) — carimbo de proveniência desta
    // resolução específica, para `ASSET_RESOLUTION_STALE` (seção 13) e para o comando de
    // re-resolução explícita (seção 12) saberem se o catálogo mudou desde então.
    const resolutionMetadata = buildResolutionMetadata({
      catalogHash: computeCatalogFingerprint(
        Array.from(allCandidatesSeen.values()).map((asset) => ({
          id: asset.id, hash: asset.id, approvalStatus: asset.approvalStatus, validationDate: asset.validationDate,
        })),
      ),
      rankingPolicyVersion: RANKING_POLICY_VERSION,
      validatorVersion: LOCAL_ASSET_VALIDATOR_VERSION,
    });

    const reportRelativePath = await writeVisualAssetReport({
      executionId: input.executionId,
      artifactsRootDir: this.artifactsRootDir,
      resolved,
      pending,
      warnings,
      authenticityConflicts,
      resolutionMetadata,
      timingDeficits,
    });

    return { resolved, pending, warnings, reportRelativePath, authenticityConflicts, resolutionMetadata, timingDeficits };
  }
}

export async function validateDeveloperAssistedVisualAssets(input: {
  executionId: string;
  artifactsRootDir: string;
  pending: VisualAssetCreationPackage[];
}): Promise<{ resolved: VisualAssetResolved[]; stillPending: VisualAssetCreationPackage[]; warnings: string[] }> {
  const resolved: VisualAssetResolved[] = [];
  const stillPending: VisualAssetCreationPackage[] = [];
  const warnings: string[] = [];

  for (const pending of input.pending) {
    const absolutePath = resolve(input.artifactsRootDir, input.executionId, pending.expectedRelativePath);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile() || fileStat.size === 0) throw new Error("arquivo vazio ou inválido");
      const dimensions = await readRasterDimensions(absolutePath);
      if (dimensions.width < 640 || dimensions.height < 640) {
        throw new Error(`resolução muito baixa (${dimensions.width}x${dimensions.height}); mínimo 640px em cada lado`);
      }
      const asset: VisualAssetMetadata = {
        id: `developer-assisted-scene-${pending.sceneOrder}`,
        provider: "developer-assisted",
        origin: "developer_assisted",
        absolutePath,
        relativePath: pending.expectedRelativePath,
        license: pending.license,
        tags: pending.tags,
        theme: pending.sceneName,
        emotion: pending.emotion,
        width: dimensions.width,
        height: dimensions.height,
        aspectRatio: normalizeAspectRatio(dimensions.width, dimensions.height),
        kind: "photo",
      };
      resolved.push({
        sceneOrder: pending.sceneOrder,
        sceneName: pending.sceneName,
        query: {
          executionId: input.executionId,
          sceneOrder: pending.sceneOrder,
          sceneName: pending.sceneName,
          theme: pending.sceneName,
          emotion: pending.emotion,
          narrativeFunction: pending.narrativeFunction,
          desiredKind: "photo",
          requiredTags: pending.tags,
          targetWidth: pending.width,
          targetHeight: pending.height,
          targetAspectRatio: pending.aspectRatio,
        },
        asset,
        score: 100,
        scoreBreakdown: {
          eligibility: 100,
          authenticity: 100,
          requirementCoverage: 100,
          visualQuality: 100,
          semanticMatch: 100,
          freshness: 100,
          creativeFitness: 100,
        },
        authenticityClass: 'synthetic_approved',
        selectedFrom: 1,
      });
    } catch (error) {
      warnings.push(`Asset assistido pendente para cena ${pending.sceneOrder}: ${error instanceof Error ? error.message : String(error)}`);
      stillPending.push(pending);
    }
  }

  return { resolved, stillPending, warnings };
}

async function readDeveloperAssistedAssetIfExists(input: {
  executionId: string;
  artifactsRootDir: string;
  pending: VisualAssetCreationPackage;
  query: VisualAssetSearchQuery;
  /**
   * Quando `true`, nunca gera warning por ausência do arquivo — usado pelo check de override
   * ANTECIPADO (roda para TODO Shot, antes de qualquer scoring; a ausência do arquivo é o caso
   * normal, não um problema a reportar). O caminho de fallback tardio (nenhum candidato acima da
   * nota mínima) continua emitindo o warning normalmente.
   */
  silent?: boolean;
}): Promise<{ resolved?: VisualAssetResolved; warnings: string[] }> {
  const absolutePath = resolve(input.artifactsRootDir, input.executionId, input.pending.expectedRelativePath);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.size === 0) throw new Error("arquivo vazio ou inválido");
    const dimensions = await readAssetDimensions(absolutePath);
    if (dimensions.width < 640 || dimensions.height < 640) {
      throw new Error(`resolução muito baixa (${dimensions.width}x${dimensions.height}); mínimo 640px em cada lado`);
    }
    const asset: VisualAssetMetadata = {
      // SHOT-LEVEL ASSET RESOLUTION — usa `shotId` quando disponível para garantir um id único
      // por arquivo físico: dois Shots DIFERENTES da MESMA cena (`scene-03-shot-01`/`shot-02`)
      // nunca podem colidir no mesmo `developer-assisted-scene-3`, ou o dedupe do resolver (que
      // rastreia `asset.id`) trataria erroneamente o segundo arquivo distinto como reuso do
      // primeiro.
      id: `developer-assisted-${input.query.shotId ?? `scene-${input.pending.sceneOrder}`}`,
      provider: "developer-assisted",
      origin: "developer_assisted",
      absolutePath,
      relativePath: input.pending.expectedRelativePath,
      license: input.pending.license,
      tags: input.pending.tags,
      theme: input.query.theme,
      emotion: input.pending.emotion,
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: normalizeAspectRatio(dimensions.width, dimensions.height),
      // O arquivo físico real manda: se a IA desenvolvedora salvou um .mp4/.mov/.webm, o asset É
      // vídeo, mesmo que a query original pedisse `desiredKind: "photo"` (ex.: Shot flagado pelo
      // Asset Diversity Gate como "insufficient_video", que pede vídeo real independentemente do
      // `desiredKind` herdado da cena). Nunca confiar cegamente na intenção original da query
      // quando o arquivo em disco já revela a verdade.
      kind: isVideoExtension(extname(absolutePath))
        ? (isVideoLikeKind(input.query.desiredKind) ? input.query.desiredKind : "video")
        : input.query.desiredKind,
      durationSeconds: dimensions.durationSeconds,
    };
    return {
      resolved: {
        sceneOrder: input.pending.sceneOrder,
        sceneName: input.pending.sceneName,
        query: input.query,
        asset,
        score: 100,
        // ASSET DIVERSITY GATE — sem ecoar shotId/shotOrder/shotPurpose/continuityGroup aqui, um
        // Shot resolvido via Developer Assisted Mode ficaria INVISÍVEL para `shotEntriesOf()` (que
        // filtra por `typeof entry.shotId === "string"`) e nunca contaria na diversidade real da
        // execução — exatamente o tipo de contagem incorreta que este motor existe para evitar.
        shotId: input.query.shotId,
        shotOrder: input.query.shotOrder,
        shotPurpose: input.query.shotPurpose,
        continuityGroup: input.query.continuityGroup,
        scoreBreakdown: {
          eligibility: 100,
          authenticity: 100,
          requirementCoverage: 100,
          visualQuality: 100,
          semanticMatch: 100,
          freshness: 100,
          creativeFitness: 100,
        },
        authenticityClass: 'synthetic_approved',
        selectedFrom: 1,
      },
      warnings: [`Cena ${input.pending.sceneOrder}: asset criado pela IA desenvolvedora encontrado e validado em ${input.pending.expectedRelativePath}.`],
    };
  } catch (error) {
    if (input.silent) return { warnings: [] };
    return {
      warnings: [`Cena ${input.pending.sceneOrder}: nenhum asset adequado encontrado; criação assistida pendente (${error instanceof Error ? error.message : String(error)}).`],
    };
  }
}

export async function writeVisualAssetReport(input: {
  executionId: string;
  artifactsRootDir: string;
  resolved: VisualAssetResolved[];
  pending: VisualAssetCreationPackage[];
  warnings: string[];
  authenticityConflicts?: AuthenticityRankingConflict[];
  resolutionMetadata?: import("../../application/ports/visual-asset-provider.port.js").AssetResolutionMetadata;
  timingDeficits?: TimingDeficit[];
}): Promise<string> {
  const relativePath = "visual-assets/asset-report.json";
  const absolutePath = resolve(input.artifactsRootDir, input.executionId, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify({
    executionId: input.executionId,
    generatedAt: new Date().toISOString(),
    resolved: input.resolved,
    pending: input.pending,
    warnings: input.warnings,
    authenticityConflicts: input.authenticityConflicts ?? [],
    resolutionMetadata: input.resolutionMetadata,
    timingDeficits: input.timingDeficits ?? [],
  }, null, 2), "utf8");
  return relativePath;
}

// NOTA (auditoria seção 1 desta sprint): `scoreAsset`/`scoreTotal`/`mediaPriorityForKind` antigos
// foram REMOVIDOS daqui e substituídos por `scoreAssetLayered`/`scoreTotalLayered`/
// `mediaPriorityForKind` em `shared/utils/asset-authenticity-policy/layered-scoring.ts` — a
// fórmula anterior (9 dimensões, ~45-55% do peso vindo de `tagRatio`) está documentada por
// completo no relatório final da sprint "Official Asset Priority & Authenticity Policy", não
// duplicada aqui.

function chooseBestAssetForScene(
  scored: ScoredCandidate[],
  selectedAssetIds: Set<string>,
  scene: VisualAssetSearchQuery,
  minimumScore: number,
): ScoredCandidate | undefined {
  const best = scored[0];
  if (!best || best.score < minimumScore) return best;
  const functionalTags = scene.requiredTags.map(normalize).filter((tag) => FUNCTIONAL_SCENE_TAGS.includes(tag));
  if (functionalTags.length > 0) {
    const approvedFunctional = scored
      .filter((entry) => entry.score >= minimumScore && functionalMatchScore(entry.asset, scene) > 0)
      .sort((a, b) => {
        const functionalDelta = functionalMatchScore(b.asset, scene) - functionalMatchScore(a.asset, scene);
        if (functionalDelta !== 0) return functionalDelta;
        return b.score - a.score;
      });
    const bestFunctional = approvedFunctional[0];
    const bestUnusedFunctional = approvedFunctional.find((entry) => !selectedAssetIds.has(entry.asset.id));
    if (bestFunctional && bestUnusedFunctional) {
      const functionalDelta = functionalMatchScore(bestFunctional.asset, scene) - functionalMatchScore(bestUnusedFunctional.asset, scene);
      const scoreDelta = bestFunctional.score - bestUnusedFunctional.score;
      if (functionalDelta <= 3 && scoreDelta <= 40) return bestUnusedFunctional;
    }
    if (bestFunctional) return bestFunctional;
  }
  if (!selectedAssetIds.has(best.asset.id)) return best;

  const bestFunctionalMatch = functionalMatchScore(best.asset, scene);
  const bestUnused = scored.find((entry) => !selectedAssetIds.has(entry.asset.id) && entry.score >= minimumScore);
  if (!bestUnused) return best;

  const unusedFunctionalMatch = functionalMatchScore(bestUnused.asset, scene);
  const scoreDelta = best.score - bestUnused.score;
  if (bestFunctionalMatch > unusedFunctionalMatch) return best;
  if (scoreDelta > 35) return best;

  return bestUnused;
}

const FUNCTIONAL_SCENE_TAGS = ["overview", "rsvp", "presente", "presentes", "pix", "album", "foto", "fotos", "cronograma", "cta", "logo", "pessoa-usando-produto", "contexto-humano", "mockup-produto", "screenshot"];

function functionalMatchScore(asset: VisualAssetMetadata, scene: VisualAssetSearchQuery): number {
  const assetText = normalizedAssetText(asset);
  return scene.requiredTags
    .map(normalize)
    .filter((tag) => FUNCTIONAL_SCENE_TAGS.includes(tag))
    .filter((tag) => assetText.includes(tag))
    .length;
}

function normalizedAssetText(asset: VisualAssetMetadata): string {
  return normalize([asset.theme, asset.emotion, asset.kind, ...asset.tags].filter(Boolean).join(" "));
}

function buildCreationPrompt(scene: VisualAssetSearchQuery): string {
  return [
    `Crie uma imagem realista para a cena ${scene.sceneOrder} (${scene.sceneName}) de um vídeo vertical premium.`,
    `Tema: ${scene.theme}.`,
    `Função narrativa: ${scene.narrativeFunction}.`,
    `Emoção: ${scene.emotion}.`,
    `Tipo de imagem desejado: ${scene.desiredKind}.`,
    scene.framing ? `Enquadramento: ${scene.framing}.` : undefined,
    scene.movement ? `Movimento sugerido: ${scene.movement}.` : undefined,
    scene.lighting ? `Iluminação: ${scene.lighting}.` : undefined,
    scene.composition ? `Composição: ${scene.composition}.` : undefined,
    `Resolução obrigatória: ${scene.targetWidth}x${scene.targetHeight}, proporção ${scene.targetAspectRatio}.`,
    `Tags obrigatórias: ${scene.requiredTags.join(", ")}.`,
    "Estilo: fotografia/editorial premium, natural, sem aparência de banco genérico, sem texto embutido, sem watermark, sem logo de terceiros.",
    "Evitar: placeholder, ícone, clipart, vetor simples, fundo vazio, baixa resolução, pessoas deformadas, mãos distorcidas, texto ilegível ou marca não autorizada.",
  ].filter(Boolean).join("\n");
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// SHOT-LEVEL ASSET RESOLUTION — helpers de strict requirements e selectionReason
// ---------------------------------------------------------------------------------------------

// Importados de `shared/utils/visual-asset-tag-signals.ts` (não definidos aqui) para que
// `asset-diversity-gate.ts` classifique assets com o MESMO vocabulário de tags usado para
// aceitar/rejeitar candidatos aqui — nunca uma lista paralela que poderia divergir silenciosamente.

/**
 * SHOT-LEVEL ASSET RESOLUTION — quando o Shot declara requisitos ESTRITOS (product/human/etc.),
 * assets sem as tags correspondentes são REJEITADOS antes do scoring (não apenas pontuam menor).
 * Isso garante que um Shot cujo propósito exige produto real (`product`) nunca aceite uma foto
 * conceitual ou um plano ambiente como fallback. Sem `strict`, os requisitos apenas favorecem
 * o scoring via `scoreAsset` — mas não excluem candidatos.
 */
function passesStrictRequirements(
  asset: VisualAssetMetadata,
  strict: { product: boolean; human: boolean; mockup: boolean; screenshot: boolean },
): boolean {
  if (!strict.product && !strict.human && !strict.mockup && !strict.screenshot) return true;
  const text = normalize([asset.theme, asset.emotion, asset.kind, ...asset.tags].filter(Boolean).join(" "));
  if (strict.product && !PRODUCT_TAG_SIGNAL.some((tag) => text.includes(tag))) return false;
  if (strict.human && !HUMAN_TAG_SIGNAL.some((tag) => text.includes(tag))) return false;
  if (strict.mockup && !MOCKUP_TAG_SIGNAL.some((tag) => text.includes(tag))) return false;
  if (strict.screenshot && !SCREENSHOT_TAG_SIGNAL.some((tag) => text.includes(tag))) return false;
  return true;
}

/**
 * SHOT-LEVEL ASSET RESOLUTION — descrição humano-legível do porquê deste asset foi escolhido.
 * Formato compacto para caber em relatórios: `"score:82; media:video; tags:casal,rsvp"`. Usado
 * por Lucas/observability, nunca pelo compilador.
 */
function buildSelectionReason(
  best: { asset: VisualAssetMetadata; breakdown: VisualAssetScoreBreakdown; score: number },
  scene: VisualAssetSearchQuery,
): string {
  const kind = best.asset.kind;
  const matched = scene.requiredTags
    .map(normalize)
    .filter((tag) => best.asset.tags.map(normalize).includes(tag))
    .slice(0, 5)
    .join(",");
  const shotFragment = scene.shotId ? `; shot=${scene.shotId}` : "";
  return `score:${best.score}; media:${kind}; matched:${matched || "-"}${shotFragment}`;
}

