// Orquestração de UMA tela da peça: arquétipo planejado → composição/IA → renderização → Quality Gate
// de fidelidade → revisão direcionada pelo motivo da reprovação, com limite de tentativas e de custo.
//
// JavaScript puro, sem acesso ao banco nem ao dist/: usado pelo agendador (no host, que chama o
// renderizador dentro do container) e pelo comparativo local (que chama o renderizador direto).
// Tudo que decide (plano, gate, revisão) vem pronto do núcleo do motor criativo.

const AI_OPERATIONS = new Set(["ai_edit_with_reference", "ai_generation", "ai_scene_with_composite"]);

/** Monta a composição controlada a partir do arquétipo e dos arquivos originais do plano. */
export function compositionRequest(spec, archetype, transmitted, assets) {
  if (spec.mode === "physical_product") {
    const products = transmitted.filter((item) => item.role === "product_photo" || item.role === "product_variant")
      .map((item) => ({ id: item.id, data: assets[item.id]?.data, productCode: item.productCode, variantLabel: item.variantLabel }))
      .filter((item) => item.data);
    if (!products.length) return undefined;
    return { mode: spec.mode, archetype, products };
  }
  if (spec.mode === "software") {
    const captures = transmitted.filter((item) => item.role === "software_capture");
    const wantsMobile = archetype === "phone_conversation";
    const capture = captures.find((item) => (assets[item.id]?.form === "mobile") === wantsMobile) ?? captures[0];
    const asset = capture && assets[capture.id];
    if (!asset) return undefined;
    return { mode: spec.mode, archetype, capture: { id: capture.id, data: asset.data, devicePixelRatio: asset.devicePixelRatio, focus: asset.focus, feature: asset.feature, form: asset.form } };
  }
  return { mode: spec.mode, archetype };
}

const operationOf = (archetypeId, archetypes) => archetypes[archetypeId]?.operation ?? "deterministic_composite";

/** Posição do texto que repetiu ("Mesma composição (concept_scene, texto top) em 2 das 3…"), se foi só isso que reprovou. */
function repeatedLayout(gate) {
  const failures = gate?.failures ?? [];
  if (!failures.length || failures.some((failure) => failure.code !== "REPETITION")) return undefined;
  const messages = failures.map((failure) => failure.message ?? "").join(" ");
  if (/Quase idêntica|praticamente igual/.test(messages)) return undefined;
  return messages.match(/Mesma composição \([^,]+, texto (top|left|bottom)\)/)?.[1];
}

/**
 * Produz uma tela aprovada ou devolve o motivo para revisão manual. `render(request)` executa o
 * renderizador; `generateAi({ spec, instruction, transmitted, correction })` gera a base pela IA
 * (ou `undefined` quando a IA não está disponível/autorizada).
 *
 * `reuse` (refação direcionada): base aprovada da versão anterior desta tela ({ archetype, base, layout,
 * logoPlacement, protectedAreas, aiReview?, sceneReview? }). Enquanto o arquétipo for o mesmo e nenhuma
 * correção de imagem for pedida, a tela é recomposta sobre ela — sem gerar imagem nova (o cliente não
 * criticou esta imagem). A revisão da cena aprovada antes vale para a mesma base.
 */
export async function produceScreen({ planned, brand, assets, history, render, generateAi, reviewScene, archetypes, maxAttempts = 3, budgetUsd = 0, aiAttemptCostUsd = 0, seriesKey, reuse }) {
  const { spec, screen, transmitted } = planned;
  const fashionCampaign = spec.presentation === "fashion_campaign";
  const attempts = [];
  const tried = new Set();
  let archetype = spec.composition.archetype;
  let correction;
  let spentUsd = 0;
  let logoConfig = brand.logoConfig;
  let layoutRetried = false;
  let generation;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    tried.add(archetype);
    const operation = operationOf(archetype, archetypes);
    const fidelity = {
      spec: { mode: spec.mode, subject: spec.subject, requiredReferences: spec.requiredReferences, blockers: spec.blockers },
      operation, archetype, transmittedReferenceIds: transmitted.map((item) => item.id), ...(seriesKey ? { seriesKey } : {}),
      revisionContext: { attempt, maxAttempts, spentUsd, budgetUsd, aiAttemptCostUsd },
    };
    const request = { ...brand, logoConfig, ...screen, presentation: spec.presentation, fidelity, history };
    generation = undefined;
    if (AI_OPERATIONS.has(operation)) {
      const reusing = Boolean(reuse?.base) && reuse.archetype === archetype && !correction;
      const generated = reusing
        ? { base: reuse.base, layout: reuse.layout, logoPlacement: reuse.logoPlacement, protectedAreas: reuse.protectedAreas ?? [], costUsd: 0, reused: true, ...(reuse.aiReview ? { aiReview: reuse.aiReview } : {}) }
        : generateAi ? await generateAi({ spec, archetype, instruction: planned.instruction, transmitted, correction }) : undefined;
      if (!generated) {
        // IA indisponível/sem orçamento: cai na composição controlada equivalente.
        archetype = spec.composition.fallback ?? Object.keys(archetypes).find((id) => archetypes[id].mode === spec.mode && archetypes[id].operation === "deterministic_composite" && !tried.has(id));
        attempts.push({ attempt, archetype: [...tried].at(-1), outcome: "skipped", reason: "IA indisponível ou sem orçamento autorizado — usando composição controlada." });
        attempt -= 1;
        if (!archetype || tried.has(archetype)) break;
        continue;
      }
      spentUsd += generated.costUsd ?? 0;
      generation = { archetype, operation, base: generated.base, layout: generated.layout, logoPlacement: generated.logoPlacement, protectedAreas: generated.protectedAreas ?? [], reused: generated.reused === true, ...(generated.aiReview ? { aiReview: generated.aiReview } : {}) };
      Object.assign(request, { base: generated.base, layout: generated.layout, logoPlacement: generated.logoPlacement, protectedAreas: generated.protectedAreas });
      const primary = transmitted.find((item) => item.role === "product_photo");
      if (spec.mode === "physical_product" && primary && assets[primary.id]) fidelity.reference = assets[primary.id].data;
      if (generated.aiReview) fidelity.aiReview = generated.aiReview;
      if (spec.mode === "software") {
        // A IA fez só o cenário: a tela real entra por composição sobre ele.
        request.composition = { ...compositionRequest(spec, spec.composition.fallback ?? "device_laptop", transmitted, assets), scene: generated.base };
      }
    } else {
      const composition = compositionRequest(spec, archetype, transmitted, assets);
      if (!composition) {
        attempts.push({ attempt, archetype, outcome: "failed", reason: "Arquivo original da referência indisponível para compor." });
        return { ok: false, attempts, reason: "Arquivo original da referência indisponível." };
      }
      request.composition = composition;
    }
    let result;
    try {
      result = await render(request);
      const generatedScene = AI_OPERATIONS.has(operation);
      // Revisão da cena só quando a IA gerou a cena: a composição tipográfica não tem foto para "conferir com a
      // direção visual" (26/11/2026: frase tipográfica reprovada por "faltar a fotografia de home office").
      const needsSceneReview = (spec.mode === "conceptual" && generatedScene && (spec.visualDirection || spec.brandIdentity?.colors?.length || spec.brandIdentity?.notes?.trim()))
        || (fashionCampaign && spec.mode === "physical_product" && generatedScene && spec.visualDirection);
      if (needsSceneReview && result.gate?.approved === true) {
        // Mesma base já aprovada na revisão da cena (só o texto mudou): não gasta outra revisão.
        const sceneReview = generation?.reused && reuse?.sceneReview?.verdict === "approve" ? reuse.sceneReview : await reviewScene?.({ spec, instruction: planned.instruction, image: result.image });
        if (generation && sceneReview) generation.sceneReview = sceneReview;
        const verified = await render({ ...request, fidelity: { ...fidelity, sceneReviewRequired: true, sceneReview } });
        if (!result.gate.imageSha256 || verified.gate?.imageSha256 !== result.gate.imageSha256) {
          return { ok: false, attempts, reason: "A arte mudou durante a revisão visual da cena." };
        }
        result = verified;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ attempt, archetype, outcome: "failed", reason: message });
      if (!/QUALITY_/.test(message)) throw error;
      // Imagem gerada fora do formato: gera de novo pedindo o retrato, sem trocar a composição.
      if (/QUALITY_ASPECT/.test(message) && AI_OPERATIONS.has(operation)) {
        correction = "A imagem anterior saiu fora do formato. Gere obrigatoriamente em retrato vertical 4:5 (1080 x 1350), nunca quadrada ou horizontal.";
        continue;
      }
      // Composição recusada antes do gate (texto sobre rosto/produto): outro arquétipo.
      const next = spec.composition.alternatives.find((id) => !tried.has(id) && (generateAi || operationOf(id, archetypes) === "deterministic_composite"));
      if (!next) break;
      archetype = next;
      continue;
    }
    // Sem veredito do Quality Gate = inconclusivo: nunca segue como aprovada.
    if (!result.gate) {
      attempts.push({ attempt, archetype, operation, outcome: "failed", reason: "Quality Gate sem veredito (inconclusivo)." });
      return { ok: false, attempts, reason: "Quality Gate sem veredito (inconclusivo) — encaminhada para revisão." };
    }
    attempts.push({ attempt, archetype, operation, outcome: result.gate.approved === true ? "approved" : "rejected", gate: result.gate, revision: result.revision, ...(generation?.reused ? { reused: true } : {}) });
    if (result.gate.approved === true) return { ok: true, image: result.image, quality: result.quality, gate: result.gate, fingerprint: result.fingerprint, evidence: result.evidence, archetype: result.appliedArchetype ?? archetype, attempts, spentUsd, ...(generation ? { generation } : {}) };
    const action = result.revision?.action ?? "manual_review";
    if (action === "manual_review") break;
    if (action === "switch_to_controlled_composite") archetype = spec.composition.fallback ?? (fashionCampaign ? "fashion_poster" : "product_editorial");
    else if (action === "use_original_photo") archetype = fashionCampaign ? "fashion_poster" : tried.has("product_scene") ? "product_editorial" : "product_scene";
    else if (action === "insert_real_capture") archetype = "device_laptop";
    else if (action === "enlarge_capture") archetype = tried.has("ui_focus") ? "browser_window" : "ui_focus";
    else if (action === "replace_logo_variant") logoConfig = { ...(logoConfig ?? {}), treatment: "halo" };
    else if (action === "regenerate_scene_with_correction") correction = result.revision.correction;
    else if (action === "switch_archetype" && AI_OPERATIONS.has(operation) && !layoutRetried && repeatedLayout(result.gate)) {
      // Cena gerada reprovada só porque a POSIÇÃO do texto repetiu as peças recentes: gera de novo com o texto
      // em outra área, em vez de abandonar a cena (antes caía na frase tipográfica — 26/11/2026, Preço Baixo Club).
      const repeated = repeatedLayout(result.gate);
      const other = ["left", "bottom", "top"].filter((layout) => layout !== repeated);
      layoutRetried = true;
      correction = `O texto no layout '${repeated}' repetiu a composição das peças recentes da marca. Use obrigatoriamente o layout '${other[0]}' (ou '${other[1]}'), com a área de respiro nessa posição, e uma cena com enquadramento diferente.`;
    }
    else {
      const next = spec.composition.alternatives.find((id) => !tried.has(id) && (generateAi || operationOf(id, archetypes) === "deterministic_composite"));
      if (!next) break;
      archetype = next;
    }
  }
  const last = attempts.at(-1);
  return { ok: false, attempts, reason: last?.revision?.reason ?? last?.reason ?? "Não aprovada pelo Quality Gate." };
}

// ---------------------------------------------------------------- revisão manual

/**
 * Fila de revisão do piloto (arquivo no host, sem tabela nova): peça reprovada sem correção automática,
 * referência que não carregou ou pauta sem o material obrigatório. A pauta entra uma vez (alerta único),
 * deixa de ser escolhida automaticamente e volta quando a pessoa a remove da fila depois de corrigir.
 */
export function addToReviewQueue(queue, entry) {
  const list = Array.isArray(queue) ? queue : [];
  if (list.some((item) => item.workspaceId === entry.workspaceId && item.ideaId === entry.ideaId)) return { queue: list, added: false };
  return { queue: [...list, { ...entry, reason: String(entry.reason ?? "").slice(0, 600) }], added: true };
}

export function reviewSkipIds(queue, workspaceId) {
  return (Array.isArray(queue) ? queue : []).filter((item) => item.workspaceId === workspaceId).map((item) => item.ideaId);
}

/** Aprovações por tela no formato que a trava do backend confere (veredito + hash da imagem aprovada). */
export function screenApprovals(results) {
  return results.map((result, index) => ({ screen: index + 1, approved: result.gate?.approved === true, imageSha256: result.gate?.imageSha256, failures: result.gate?.failures ?? [] }));
}

// ---------------------------------------------------------------- revisão visual da IA

/**
 * Pergunta da revisão visual: compara SÓ o produto da foto original com o da imagem gerada, separando
 * diferença MATERIAL (o cliente receberia outra peça: elemento a mais/a menos, desenho ou texto diferente,
 * outra cor de tecido, estampa em outro lugar) de variação aceitável de fotografia (luz, ângulo, caimento,
 * pose, espessura de traço). Calibração de 25/11/2026: a 1ª versão reprovava variação de luz e traço como
 * "estampa diferente" mesmo com a estampa idêntica à vista.
 */
export function productReviewPrompt({ productCode, variantLabel }) {
  return `Você é um revisor de fidelidade de produto para anúncios de moda. A Imagem 1 é a FOTO ORIGINAL do produto anunciado` +
    `${productCode ? ` (modelo ${productCode}${variantLabel ? `, cor ${variantLabel}` : ""})` : ""}. A Imagem 2 é a peça publicitária gerada por IA. ` +
    `Compare SOMENTE o produto, elemento por elemento da estampa (cada desenho, cada palavra, cada cor da estampa) e a cor do tecido. ` +
    `DIFERENÇA MATERIAL (reprova): elemento da estampa faltando ou a mais; desenho trocado por outro; texto com palavras/letras diferentes; ` +
    `cor do tecido claramente diferente (outra cor comercial); estampa em outro lugar da peça ou com tamanho muito diferente; outro tipo de peça. ` +
    `VARIAÇÃO ACEITÁVEL (não reprova): luz, sombra, ângulo, pose, caimento no corpo, dobras, corpo masculino/feminino, leve diferença de espessura ou nitidez do traço. ` +
    `Responda só JSON: {"garmentMatches":bool,"fabricColorMatches":bool,"printElementsMatch":bool,"printPositionMatches":bool,` +
    `"materialDifferences":[string em português, só diferenças materiais],"acceptableVariations":[string em português],"verdict":"approve"|"reject"}. ` +
    `verdict = "reject" se e somente se houver alguma diferença material.`;
}

/** Converte a resposta da revisão visual no formato do Quality Gate (aprovação só sem diferença material). */
export function aiReviewFromVerdict(review) {
  if (!review || typeof review !== "object") return { verdict: "unavailable" };
  // Aceita também o formato anterior (sameGarment/sameColor/samePrint/samePrintPosition).
  const garment = review.garmentMatches ?? review.sameGarment;
  const color = review.fabricColorMatches ?? review.sameColor;
  const print = review.printElementsMatch ?? review.samePrint;
  const position = review.printPositionMatches ?? review.samePrintPosition;
  const material = Array.isArray(review.materialDifferences) ? review.materialDifferences : review.verdict === "reject" ? (review.findings ?? []) : [];
  const same = garment === true && color === true && print === true && position === true;
  if (same && material.length === 0 && review.verdict === "approve") {
    return { verdict: "approve", ...(Array.isArray(review.acceptableVariations) && review.acceptableVariations.length ? { notes: review.acceptableVariations.slice(0, 5) } : {}) };
  }
  const details = material.join("; ").slice(0, 200);
  const findings = [
    ...(garment === true ? [] : [{ code: "PRODUCT_MISMATCH", message: "Revisão visual: a peça não é a mesma do produto anunciado." }]),
    ...(color === true ? [] : [{ code: "COLOR_MISMATCH", message: "Revisão visual: a cor do produto mudou." }]),
    ...(print === true && position === true ? [] : [{ code: "PRINT_ALTERED", message: `Revisão visual: estampa diferente da original${details ? ` (${details})` : ""}.` }]),
  ];
  return { verdict: "reject", findings: findings.length ? findings : [{ code: "AI_REVIEW_REJECTED", message: details || "Revisão visual reprovou." }] };
}

export function sceneReviewFromVerdict(review) {
  if (!review || typeof review.paletteMatches !== "boolean" || typeof review.directionMatches !== "boolean" || !["approve", "reject"].includes(review.verdict)) return { verdict: "unavailable" };
  const details = Array.isArray(review.findings) ? review.findings.filter((item) => typeof item === "string").join(" ").slice(0, 350) : "";
  if (review.verdict === "approve" && review.paletteMatches && review.directionMatches && !details) return { verdict: "approve" };
  const findings = [];
  if (!review.paletteMatches) findings.push({ code: "BRAND_PALETTE_MISMATCH", message: details || "Cores ou hierarquia da paleta divergentes do perfil da marca." });
  if (!review.directionMatches || !findings.length) findings.push({ code: "VISUAL_DIRECTION_MISMATCH", message: details || "Cena divergente da direção visual da pauta." });
  return { verdict: "reject", findings };
}

// ---------------------------------------------------------------- refação direcionada: logo

/**
 * Motivo da reprovação que falou da logo → ajuste do renderizador (sem IA): tamanho ou tratamento.
 * "logo muito grande" → menor; "pequena" → maior; "apagada/sumiu/sem contraste" → halo; "caixa/fundo" → sem caixa.
 */
export function logoAdjustment(reason, current = {}) {
  const text = String(reason ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const scale = Number(current.scale) || 1;
  if (/\b(grande|enorme|exagerad\w*|chamativ\w*)\b/.test(text)) return { ...current, scale: Math.max(0.6, Number((scale * 0.75).toFixed(2))) };
  if (/\b(pequen\w*|minuscul\w*|miud\w*)\b/.test(text)) return { ...current, scale: Math.min(1.6, Number((scale * 1.3).toFixed(2))) };
  if (/\b(caixa|fundo|quadrado|retangulo|tarja)\b/.test(text)) return { ...current, treatment: "none" };
  return { ...current, treatment: "halo" };
}
