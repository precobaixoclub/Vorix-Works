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

/**
 * Produz uma tela aprovada ou devolve o motivo para revisão manual. `render(request)` executa o
 * renderizador; `generateAi({ spec, instruction, transmitted, correction })` gera a base pela IA
 * (ou `undefined` quando a IA não está disponível/autorizada).
 */
export async function produceScreen({ planned, brand, assets, history, render, generateAi, archetypes, maxAttempts = 3, budgetUsd = 0, aiAttemptCostUsd = 0, seriesKey }) {
  const { spec, screen, transmitted } = planned;
  const attempts = [];
  const tried = new Set();
  let archetype = spec.composition.archetype;
  let correction;
  let spentUsd = 0;
  let logoConfig = brand.logoConfig;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    tried.add(archetype);
    const operation = operationOf(archetype, archetypes);
    const fidelity = {
      spec: { mode: spec.mode, subject: spec.subject, requiredReferences: spec.requiredReferences, blockers: spec.blockers },
      operation, archetype, transmittedReferenceIds: transmitted.map((item) => item.id), ...(seriesKey ? { seriesKey } : {}),
      revisionContext: { attempt, maxAttempts, spentUsd, budgetUsd, aiAttemptCostUsd },
    };
    const request = { ...brand, logoConfig, ...screen, fidelity, history };
    if (AI_OPERATIONS.has(operation)) {
      const generated = generateAi ? await generateAi({ spec, archetype, instruction: planned.instruction, transmitted, correction }) : undefined;
      if (!generated) {
        // IA indisponível/sem orçamento: cai na composição controlada equivalente.
        archetype = spec.composition.fallback ?? Object.keys(archetypes).find((id) => archetypes[id].mode === spec.mode && archetypes[id].operation === "deterministic_composite" && !tried.has(id));
        attempts.push({ attempt, archetype: [...tried].at(-1), outcome: "skipped", reason: "IA indisponível ou sem orçamento autorizado — usando composição controlada." });
        attempt -= 1;
        if (!archetype || tried.has(archetype)) break;
        continue;
      }
      spentUsd += generated.costUsd ?? 0;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ attempt, archetype, outcome: "failed", reason: message });
      if (!/QUALITY_/.test(message)) throw error;
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
    attempts.push({ attempt, archetype, operation, outcome: result.gate.approved === true ? "approved" : "rejected", gate: result.gate, revision: result.revision });
    if (result.gate.approved === true) return { ok: true, image: result.image, quality: result.quality, gate: result.gate, fingerprint: result.fingerprint, evidence: result.evidence, archetype: result.appliedArchetype ?? archetype, attempts, spentUsd };
    const action = result.revision?.action ?? "manual_review";
    if (action === "manual_review") break;
    if (action === "switch_to_controlled_composite") archetype = spec.composition.fallback ?? "product_editorial";
    else if (action === "use_original_photo") archetype = tried.has("product_scene") ? "product_editorial" : "product_scene";
    else if (action === "insert_real_capture") archetype = "device_laptop";
    else if (action === "enlarge_capture") archetype = tried.has("ui_focus") ? "browser_window" : "ui_focus";
    else if (action === "replace_logo_variant") logoConfig = { ...(logoConfig ?? {}), treatment: "halo" };
    else if (action === "regenerate_scene_with_correction") correction = result.revision.correction;
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

/** Pergunta da revisão visual: compara SÓ o produto da foto original com o da imagem gerada. */
export function productReviewPrompt({ productCode, variantLabel }) {
  return `Você é um revisor de fidelidade de produto para anúncios. A Imagem 1 é a FOTO ORIGINAL do produto anunciado` +
    `${productCode ? ` (modelo ${productCode}${variantLabel ? `, cor ${variantLabel}` : ""})` : ""}. A Imagem 2 é a peça publicitária gerada por IA. ` +
    `Compare SOMENTE o produto: modelagem (gola, mangas, formato), cor, estampa (desenho, textos/letras, cores da estampa) e posição/tamanho da estampa. ` +
    `Qualquer diferença perceptível na estampa ou na cor reprova. Responda só JSON: ` +
    `{"sameGarment":bool,"sameColor":bool,"samePrint":bool,"samePrintPosition":bool,"findings":[string em português],"verdict":"approve"|"reject"}.`;
}

/** Converte a resposta da revisão visual no formato do Quality Gate (aprovação só com tudo igual). */
export function aiReviewFromVerdict(review) {
  if (!review || typeof review !== "object") return { verdict: "unavailable" };
  const same = review.sameGarment === true && review.sameColor === true && review.samePrint === true && review.samePrintPosition === true;
  if (same && review.verdict === "approve") return { verdict: "approve" };
  const details = (Array.isArray(review.findings) ? review.findings : []).join("; ").slice(0, 200);
  const findings = [
    ...(review.sameGarment === true ? [] : [{ code: "PRODUCT_MISMATCH", message: "Revisão visual: a peça não é a mesma do produto anunciado." }]),
    ...(review.sameColor === true ? [] : [{ code: "COLOR_MISMATCH", message: "Revisão visual: a cor do produto mudou." }]),
    ...(review.samePrint === true && review.samePrintPosition === true ? [] : [{ code: "PRINT_ALTERED", message: `Revisão visual: estampa diferente da original${details ? ` (${details})` : ""}.` }]),
  ];
  return { verdict: "reject", findings: findings.length ? findings : [{ code: "AI_REVIEW_REJECTED", message: details || "Revisão visual reprovou." }] };
}
