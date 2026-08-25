import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import type { CreativeContext, CreativePlan, CreativePlanAssetRole, CreativePlanRect } from "../../shared/utils/gpt-creative-plan.types.js";
import { COMMERCIAL_FACT_TYPE_LABELS_PT, extractCommercialFactsFromText } from "../../shared/utils/commercial-fact-normalizer.js";

/**
 * Quality gate do motor GPT — migração "GPT como motor criativo único" (PR 5/9), promovido de
 * `evaluate-gpt-prototype-quality-gate.ts` (protótipo isolado) com a lista completa de falhas
 * críticas pedida. DELIBERADAMENTE mais simples que o Quality Gate do motor legado
 * (`lucas-quality-review.skill.ts`, 10 dimensões de score) — só `pass`/`fail` + lista de motivos,
 * nunca um score que tenta substituir o julgamento criativo do GPT.
 */

export const CREATIVE_QUALITY_ISSUE_CODES = [
  "PRODUCT_MISMATCH",
  "WRONG_LOGO",
  "SCREENSHOT_MISCHARACTERIZED",
  "REQUIRED_ASSET_MISSING",
  "INVENTED_COMMERCIAL_FACT",
  "WRONG_PRICE",
  "TEXT_ILLEGIBLE_OR_CUT",
  "ELEMENT_CUT_OFF",
  "WRONG_ASPECT_RATIO",
  "CRITICAL_OVERLAP",
  "COMPOSITION_BROKEN",
  "NON_PUBLISHABLE_SOURCE",
  "PRODUCTION_GUIDELINES_VIOLATED",
  "COLOR_PALETTE_VIOLATED",
] as const;
export type CreativeQualityIssueCode = (typeof CREATIVE_QUALITY_ISSUE_CODES)[number];

export type CreativeQualityIssue = {
  code: CreativeQualityIssueCode;
  message: string;
};

export type CreativeQualityGateResult = {
  verdict: "pass" | "fail";
  issues: CreativeQualityIssue[];
};

const ASPECT_RATIO_TOLERANCE = 0.06;

function parseAspectRatio(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return undefined;
  return width / height;
}

/**
 * Falhas determinísticas — nunca dependem de IA, calculadas sobre dados REAIS (dimensões do
 * buffer final, quais assets foram de fato compostos, proveniência do artefato). Nada aqui
 * "adivinha" — cada issue vem de um dado concreto que já existe no resultado da execução.
 */
export function evaluateDeterministicCreativeChecks(input: {
  finalImageWidth: number;
  finalImageHeight: number;
  expectedAspectRatio: string;
  compositedAssetRoles: CreativePlanAssetRole[];
  contextAssetRoles: CreativePlanAssetRole[];
  /** `true` quando o artefato final tem proveniência não publicável (ver
   * `src/shared/utils/artifact-provenance.ts`) — nunca deve acontecer no caminho normal do motor
   * GPT, mas é a última rede de proteção determinística caso algo escape. */
  nonPublishableSource?: boolean;
}): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];

  const expectedRatio = parseAspectRatio(input.expectedAspectRatio);
  if (expectedRatio && input.finalImageWidth > 0 && input.finalImageHeight > 0) {
    const actualRatio = input.finalImageWidth / input.finalImageHeight;
    const deviation = Math.abs(actualRatio - expectedRatio) / expectedRatio;
    if (deviation > ASPECT_RATIO_TOLERANCE) {
      issues.push({
        code: "WRONG_ASPECT_RATIO",
        message: `Peça final ${input.finalImageWidth}x${input.finalImageHeight} não corresponde ao formato pedido "${input.expectedAspectRatio}" (desvio de ${(deviation * 100).toFixed(1)}%).`,
      });
    }
  }

  // Só logo/screenshot exigem composição determinística — produto real pode ter sido tratado por
  // edição via referência na própria geração (sem composição posterior), então não entra aqui.
  const rolesRequiringComposite: CreativePlanAssetRole[] = ["logo", "screenshot"];
  for (const role of rolesRequiringComposite) {
    if (input.contextAssetRoles.includes(role) && !input.compositedAssetRoles.includes(role)) {
      issues.push({
        code: "REQUIRED_ASSET_MISSING",
        message: `Asset obrigatório do tipo "${role}" estava disponível no contexto, mas não foi composto na peça final.`,
      });
    }
  }

  if (input.nonPublishableSource) {
    issues.push({
      code: "NON_PUBLISHABLE_SOURCE",
      message: "A imagem final tem origem marcada como não publicável (placeholder/fallback automático) — nunca pode virar peça entregável.",
    });
  }

  return issues;
}

/**
 * Determinístico, sem chamada de IA e sem custo: varre todo texto que a peça final vai exibir
 * (headline, subheadline, CTA, título, descrição, zonas de texto do plano) atrás de valores
 * comerciais (preço, desconto, frete, urgência) via `extractCommercialFactsFromText` — o mesmo
 * extrator regex já usado para o texto livre do usuário — e reprova qualquer valor que não esteja
 * EXATAMENTE entre os fatos já confirmados do `creative_context`. É a proteção direta contra o
 * GPT "quase acertar" um preço (ex.: arredondar R$39,99 para R$40) ou inventar uma condição
 * comercial que nunca foi confirmada.
 */
export function checkCommercialFactIntegrity(plan: CreativePlan, context: CreativeContext): CreativeQualityIssue[] {
  const texts = [plan.headline, plan.subheadline, plan.cta, plan.title, plan.description, ...plan.textZones.map((zone) => zone.text)].filter(
    (text): text is string => Boolean(text?.trim()),
  );
  if (texts.length === 0) return [];

  const mentionedFacts = extractCommercialFactsFromText(texts.join("\n"));
  const issues: CreativeQualityIssue[] = [];

  for (const fact of mentionedFacts) {
    const matchesConfirmed = context.confirmedFacts.some((line) => line.includes(fact.value));
    if (matchesConfirmed) continue;

    const label = COMMERCIAL_FACT_TYPE_LABELS_PT[fact.type];
    const sameTypeConfirmed = context.confirmedFacts.some((line) => line.startsWith(label));
    issues.push({
      code: sameTypeConfirmed ? "WRONG_PRICE" : "INVENTED_COMMERCIAL_FACT",
      message: sameTypeConfirmed
        ? `A peça menciona "${fact.value}" (${label}), mas o fato confirmado no contexto tem outro valor — nunca publicar um dado comercial diferente do confirmado.`
        : `A peça menciona "${fact.value}" (${label}), mas nenhum fato comercial confirmado desse tipo existe no contexto — nunca inventar preço, desconto ou condição comercial.`,
    });
  }

  return issues;
}

/** Margem de segurança (percentual do canvas) — achado ao vivo em produção: CTA/texto cortado na
 * borda inferior de peças reais. Diferente do check de vídeo/visão (`checkCreativeVisualIntegrity`,
 * que só reprova depois de renderizar e "olhar" a imagem), este check é determinístico e roda
 * sobre a GEOMETRIA JÁ DECLARADA pelo `creative_plan` — pega o defeito antes mesmo de compor a
 * peça. Só cobre `textZones` (não `assetPlacements`) de propósito: `renderer_reflow`
 * (`creative-repair.ts`) só sabe reduzir `fontScale` e re-renderizar zonas de TEXTO — não
 * reposiciona a geometria de logo/screenshot. Reportar uma violação de safe area em
 * `assetPlacements` aqui criaria um defeito sem caminho de reparo correspondente (nunca resolvido,
 * sempre esgotando as tentativas) — escopo deliberadamente restrito ao que o sistema já sabe
 * corrigir sem gerar uma imagem nova. */
const SAFE_AREA_MARGIN_PCT = 2;

function violatesSafeArea(rect: CreativePlanRect, marginPct = SAFE_AREA_MARGIN_PCT): boolean {
  return rect.xPct < marginPct || rect.yPct < marginPct || rect.xPct + rect.widthPct > 100 - marginPct || rect.yPct + rect.heightPct > 100 - marginPct;
}

/**
 * Hard failure de acabamento — texto (headline/subheadline/CTA/preço/desconto/URL/badge) cuja
 * geometria já declarada no `creative_plan` toca ou ultrapassa a margem de segurança do canvas.
 * `TEXT_ILLEGIBLE_OR_CUT` (zonas com `renderedBy: "renderer"`, o caso reportado ao vivo — CTA
 * cortado na borda) e `ELEMENT_CUT_OFF` (zonas com `renderedBy: "image_model"`, mesmo problema
 * geométrico mas desenhado pelo modelo de imagem em vez do renderer) — a distinção de código
 * importa para o roteamento de reparo (`creative-repair.ts`), embora ambos sejam
 * `renderer_reflow`-elegíveis hoje.
 */
export function checkSafeAreaCompliance(plan: CreativePlan): CreativeQualityIssue[] {
  const issues: CreativeQualityIssue[] = [];
  for (const zone of plan.textZones) {
    if (!violatesSafeArea(zone.rect)) continue;
    issues.push({
      code: zone.renderedBy === "renderer" ? "TEXT_ILLEGIBLE_OR_CUT" : "ELEMENT_CUT_OFF",
      message: `Zona de texto "${zone.kind}" (x=${zone.rect.xPct}%, y=${zone.rect.yPct}%, largura=${zone.rect.widthPct}%, altura=${zone.rect.heightPct}%) toca ou ultrapassa a margem de segurança do canvas (${SAFE_AREA_MARGIN_PCT}%) — risco real de corte na borda.`,
    });
  }
  return issues;
}

/** Achado ao vivo em produção (cliente real): uma peça saiu com fundo branco e cores
 * ciano/magenta quando a marca tem paleta configurada (preto/grafite + verde + amarelo) —
 * passou pelo gate inteiro "limpa" porque nenhum critério de visão perguntava sobre cor. As
 * cores oficiais só entram no prompt (e no schema pede o campo) quando `brandColors` vem
 * preenchido — sem paleta configurada, a instrução explícita é sempre responder `false`, nunca
 * inventar uma expectativa de cor que a marca não definiu. */
function buildVisualIntegrityPrompt(brandColors: readonly string[] | undefined): string {
  const colorsLine = brandColors && brandColors.length > 0
    ? `Paleta de cores oficial configurada para esta marca: ${brandColors.join(", ")}.`
    : "Nenhuma paleta de cores oficial foi configurada para esta marca.";
  return [
    "Avalie esta peça publicitária JÁ FINALIZADA (a imagem anexada) para defeitos GRAVES apenas — não julgue estética, apenas problemas objetivos que tornariam a peça inaceitável.",
    colorsLine,
    "Responda APENAS com JSON válido, sem markdown, no formato exato:",
    '{"productMismatch": true|false, "wrongLogo": true|false, "screenshotMischaracterized": true|false, "textIllegibleOrCut": true|false, "elementCutOff": true|false, "criticalOverlap": true|false, "compositionBroken": true|false, "colorPaletteViolated": true|false, "reasoning": "1-2 frases objetivas"}',
    "REGRAS:",
    "- \"productMismatch\": true SOMENTE se havia uma foto de produto real de referência e o produto na peça final é claramente outro produto (nunca marque true sem uma referência real para comparar).",
    "- \"wrongLogo\": true SOMENTE se havia uma logo real de referência e a logo na peça final é visivelmente diferente (cores, proporções, símbolo) — nunca marque true sem uma referência real.",
    "- \"screenshotMischaracterized\": true SOMENTE se havia um screenshot real de referência e a interface mostrada na peça final não corresponde a ele (ex.: uma tela genérica/inventada no lugar do site real).",
    "- \"textIllegibleOrCut\": true se algum texto principal (headline, CTA, preço) está cortado nas bordas, sobreposto de forma ilegível, ou com contraste tão baixo que não dá pra ler.",
    "- \"elementCutOff\": true se qualquer elemento visual importante (produto, logo, dispositivo/mockup) está cortado de forma que perde informação essencial.",
    "- \"criticalOverlap\": true se um elemento comercial (preço, CTA, badge) sobrepõe de forma destrutiva um rosto, o produto principal ou outro elemento essencial.",
    "- \"compositionBroken\": true se a composição está visivelmente quebrada — elementos deformados, pillarboxing (barras vazias nas laterais), ou artefatos visuais graves.",
    "- \"colorPaletteViolated\": true SOMENTE se uma paleta oficial foi informada acima E a peça final claramente NÃO usa essas cores (ex.: fundo e cores predominantes totalmente diferentes do pedido, nenhuma cor da paleta aparece de forma reconhecível). Sem paleta oficial informada, responda sempre false — nunca microgerencie tom/saturação exatos, só a ausência clara da paleta inteira.",
    "- Na dúvida, prefira false — este gate é para pegar defeitos ÓBVIOS, não para microgerenciar qualidade estética.",
  ].join("\n");
}

/** Chamada de visão best-effort, UMA chamada cobrindo todos os critérios juntos (deliberadamente
 * mais barato que o motor legado, que faz 1 chamada por critério) — falha ou resposta ilegível
 * nunca reprova por conta própria, só um veredito EXPLÍCITO de defeito grave gera issue. */
export async function checkCreativeVisualIntegrity(
  icaro: IcaroBrainPort,
  input: {
    finalImageUrl: string;
    referenceProductImageUrl?: string;
    referenceLogoUrl?: string;
    referenceScreenshotUrl?: string;
    specialistId: string;
    brandColors?: readonly string[];
  },
): Promise<CreativeQualityIssue[]> {
  try {
    const referenceUrls = [input.referenceProductImageUrl, input.referenceLogoUrl, input.referenceScreenshotUrl].filter(
      (url): url is string => Boolean(url),
    );
    const imageUrls = [...referenceUrls, input.finalImageUrl];
    const response = await icaro.request({
      taskType: "review",
      prompt: buildVisualIntegrityPrompt(input.brandColors),
      specialistId: input.specialistId,
      imageUrls,
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.2,
      maxTokens: 400,
      timeoutMs: 25_000,
    });

    if (response.status !== "completed") return [];
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Creative Quality Gate")) as {
      productMismatch?: unknown;
      wrongLogo?: unknown;
      screenshotMischaracterized?: unknown;
      textIllegibleOrCut?: unknown;
      elementCutOff?: unknown;
      criticalOverlap?: unknown;
      compositionBroken?: unknown;
      colorPaletteViolated?: unknown;
      reasoning?: unknown;
    };
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    const issues: CreativeQualityIssue[] = [];
    if (parsed.productMismatch === true) issues.push({ code: "PRODUCT_MISMATCH", message: reasoning ?? "O produto na peça final não corresponde à foto de referência." });
    if (parsed.wrongLogo === true) issues.push({ code: "WRONG_LOGO", message: reasoning ?? "A logo na peça final não corresponde à logo real de referência." });
    if (parsed.screenshotMischaracterized === true) issues.push({ code: "SCREENSHOT_MISCHARACTERIZED", message: reasoning ?? "A interface mostrada não corresponde ao screenshot real de referência." });
    if (parsed.textIllegibleOrCut === true) issues.push({ code: "TEXT_ILLEGIBLE_OR_CUT", message: reasoning ?? "Texto principal ilegível ou cortado." });
    if (parsed.elementCutOff === true) issues.push({ code: "ELEMENT_CUT_OFF", message: reasoning ?? "Elemento visual importante cortado, perdendo informação essencial." });
    if (parsed.criticalOverlap === true) issues.push({ code: "CRITICAL_OVERLAP", message: reasoning ?? "Elemento comercial sobrepõe destrutivamente rosto/produto/outro elemento essencial." });
    if (parsed.compositionBroken === true) issues.push({ code: "COMPOSITION_BROKEN", message: reasoning ?? "Composição visivelmente quebrada." });
    // Garantia no CÓDIGO, nunca só na instrução do prompt — sem paleta configurada, um "true"
    // vindo da IA (alucinação, ou simplesmente não seguiu a instrução) nunca reprova por conta
    // própria, mesmo que a peça já teste isso deliberadamente.
    const hasBrandColors = Boolean(input.brandColors && input.brandColors.length > 0);
    if (hasBrandColors && parsed.colorPaletteViolated === true) {
      issues.push({ code: "COLOR_PALETTE_VIOLATED", message: reasoning ?? "A peça final não usa a paleta de cores oficial configurada para a marca." });
    }
    return issues;
  } catch {
    return [];
  }
}

const PRODUCTION_GUIDELINES_PROMPT_HEADER = [
  "Você é um revisor de conformidade de marca. Um workspace configurou instruções PERMANENTES e OBRIGATÓRIAS que toda peça gerada precisa respeitar — abaixo estão essas instruções e o conteúdo de texto real da peça que acabou de ser planejada.",
  "Sua ÚNICA tarefa é dizer se o conteúdo da peça contraria alguma dessas instruções de forma CLARA e CONCRETA (nunca microgerencie estilo, tom ou gosto subjetivo — só violações objetivas: uma regra explícita que a peça claramente descumpre).",
  "Responda APENAS com JSON válido, sem markdown, no formato exato:",
  '{"violatesGuidelines": true|false, "reasoning": "1-2 frases objetivas citando a instrução violada e onde"}',
  "Na dúvida, responda false — este check é para pegar descumprimentos óbvios de uma regra explícita, nunca para reescrever a peça a seu critério.",
].join("\n");

/**
 * Reforço da migração "Prompt Persistente de Produção": até aqui, `productionInstructions`/
 * `behaviorPreferences` (ver `build-creative-context.ts`) chegavam ao GPT diretor só como texto
 * de prioridade 2 — o próprio modelo decidia sozinho se "respeitava" ou não, sem nenhuma
 * verificação automática depois. Achado ao vivo: uma peça pode passar o gate inteiro mesmo
 * ignorando claramente uma diretriz configurada, porque nenhum dos checks anteriores olha para
 * `productionInstructions`. Best-effort e determinadamente conservador (só reprova em violação
 * ÓBVIA e concreta, nunca gosto/estilo) — mesmo espírito de `checkCreativeVisualIntegrity`: uma
 * falha ou resposta ilegível do juiz NUNCA reprova por conta própria, só um veredito EXPLÍCITO.
 * Sem nenhuma diretriz configurada (`productionInstructions`/`behaviorPreferences` ambos vazios),
 * não há nada pra violar — retorna `[]` sem gastar a chamada.
 */
export async function checkProductionGuidelinesCompliance(
  icaro: IcaroBrainPort,
  input: { context: CreativeContext; plan: CreativePlan; specialistId: string },
): Promise<CreativeQualityIssue[]> {
  const guidelines = [input.context.productionInstructions?.trim(), ...(input.context.behaviorPreferences ?? [])].filter(
    (line): line is string => Boolean(line && line.trim()),
  );
  if (guidelines.length === 0) return [];

  const pieceTexts = [input.plan.headline, input.plan.subheadline, input.plan.cta, input.plan.title, input.plan.description, ...input.plan.textZones.map((zone) => zone.text)].filter(
    (text): text is string => Boolean(text?.trim()),
  );
  if (pieceTexts.length === 0) return [];

  try {
    const prompt = [
      PRODUCTION_GUIDELINES_PROMPT_HEADER,
      "",
      "INSTRUÇÕES PERMANENTES DESTE WORKSPACE:",
      ...guidelines.map((line) => `- ${line}`),
      "",
      "CONTEÚDO DE TEXTO REAL DA PEÇA PLANEJADA:",
      ...pieceTexts.map((text) => `- ${text}`),
    ].join("\n");

    const response = await icaro.request({
      taskType: "review",
      prompt,
      specialistId: input.specialistId,
      expectedOutput: "json",
      priority: "quality",
      temperature: 0.2,
      maxTokens: 300,
      timeoutMs: 20_000,
    });

    if (response.status !== "completed") return [];
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Production Guidelines Compliance")) as {
      violatesGuidelines?: unknown;
      reasoning?: unknown;
    };
    if (parsed.violatesGuidelines !== true) return [];
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : undefined;
    return [
      {
        code: "PRODUCTION_GUIDELINES_VIOLATED",
        message: reasoning ?? "A peça contraria uma instrução permanente configurada para este workspace.",
      },
    ];
  } catch {
    return [];
  }
}

export function combineCreativeQualityIssues(...groups: CreativeQualityIssue[][]): CreativeQualityGateResult {
  const issues = groups.flat();
  return { verdict: issues.length > 0 ? "fail" : "pass", issues };
}

/** Orquestra as três camadas (determinística + fatos comerciais + visão) — ponto único de
 * entrada usado por `run-gpt-creative-engine.ts`. Nunca produz um score — só `pass`/`fail` e a
 * lista de motivos, para nunca redirecionar a direção de arte do GPT. */
export async function evaluateCreativeQualityGate(
  icaro: IcaroBrainPort,
  input: {
    finalImageUrl: string;
    finalImageWidth: number;
    finalImageHeight: number;
    expectedAspectRatio: string;
    compositedAssetRoles: CreativePlanAssetRole[];
    context: CreativeContext;
    plan: CreativePlan;
    specialistId: string;
    nonPublishableSource?: boolean;
  },
): Promise<CreativeQualityGateResult> {
  const deterministicIssues = evaluateDeterministicCreativeChecks({
    finalImageWidth: input.finalImageWidth,
    finalImageHeight: input.finalImageHeight,
    expectedAspectRatio: input.expectedAspectRatio,
    compositedAssetRoles: input.compositedAssetRoles,
    contextAssetRoles: input.context.assets.map((asset) => asset.role),
    nonPublishableSource: input.nonPublishableSource,
  });

  const commercialFactIssues = checkCommercialFactIntegrity(input.plan, input.context);
  const safeAreaIssues = checkSafeAreaCompliance(input.plan);

  const referenceProductImageUrl = input.context.assets.find((asset) => asset.role === "product_photo")?.url;
  const referenceLogoUrl = input.context.assets.find((asset) => asset.role === "logo")?.url;
  const referenceScreenshotUrl = input.context.assets.find((asset) => asset.role === "screenshot")?.url;
  const visualIssues = await checkCreativeVisualIntegrity(icaro, {
    finalImageUrl: input.finalImageUrl,
    referenceProductImageUrl,
    referenceLogoUrl,
    referenceScreenshotUrl,
    specialistId: input.specialistId,
    brandColors: input.context.brandColors,
  });
  const productionGuidelinesIssues = await checkProductionGuidelinesCompliance(icaro, {
    context: input.context,
    plan: input.plan,
    specialistId: input.specialistId,
  });

  return combineCreativeQualityIssues(deterministicIssues, commercialFactIssues, safeAreaIssues, visualIssues, productionGuidelinesIssues);
}
