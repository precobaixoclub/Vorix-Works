import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativePlanPrompt, buildImageGenerationPromptFromPlan, parseCreativePlan } from "../dist/shared/utils/gpt-creative-plan.types.js";

function sampleContext(overrides = {}) {
  return {
    brandName: "Preço Baixo Club",
    objective: "Comunicar que é um site de ofertas Shopee + Mercado Livre",
    channel: "instagram",
    format: "4:5",
    ideaText: "Arte institucional divulgando o site.",
    assets: [],
    confirmedFacts: [],
    ...overrides,
  };
}

function samplePlanJson(overrides = {}) {
  const merged = {
    objective: "Comunicar clareza de proposta",
    angle: "Um site, todas as ofertas",
    targetAudience: "Caçadores de promoção",
    headline: "TODAS AS OFERTAS EM UM SÓ SITE",
    subheadline: "Shopee + Mercado Livre",
    cta: "ACESSE AGORA",
    visualDirection: "Fundo grafite, neon verde/amarelo",
    compositionIntent: "Mockup central de celular",
    assetUsage: { "https://x/logo.png": "logo no canto superior" },
    requiredElements: ["logo", "headline", "cta"],
    forbiddenElements: ["Comente QUERO"],
    visualDensity: "clean",
    styleNotes: "tecnológico, imponente",
    rationale: "Diferenciar de grupo de WhatsApp",
    ...overrides,
  };
  // allowedRenderedTexts sempre eco literal de headline/subheadline/cta — recomputado DEPOIS dos
  // overrides pra nunca dessincronizar quando um teste sobrescreve headline/cta diretamente.
  // `hasOwnProperty` (não `=== undefined`) porque um teste pode querer testar o campo REALMENTE
  // ausente do JSON (`allowedRenderedTexts: undefined` explícito nos overrides) — nesse caso não
  // deve ser auto-preenchido, senão o teste nunca exercitaria o caminho "campo ausente".
  if (!Object.prototype.hasOwnProperty.call(overrides, "allowedRenderedTexts")) {
    merged.allowedRenderedTexts = [merged.headline, merged.subheadline, merged.cta].filter(Boolean);
  }
  return JSON.stringify(merged);
}

test("parseCreativePlan: parseia um JSON completo e bem formado", () => {
  const plan = parseCreativePlan(samplePlanJson());
  assert.ok(plan);
  assert.equal(plan.headline, "TODAS AS OFERTAS EM UM SÓ SITE");
  assert.equal(plan.cta, "ACESSE AGORA");
  assert.deepEqual(plan.requiredElements, ["logo", "headline", "cta"]);
  assert.deepEqual(plan.forbiddenElements, ["Comente QUERO"]);
  assert.equal(plan.assetUsage["https://x/logo.png"], "logo no canto superior");
  assert.equal(plan.visualDensity, "clean");
  assert.deepEqual(plan.allowedRenderedTexts, ["TODAS AS OFERTAS EM UM SÓ SITE", "Shopee + Mercado Livre", "ACESSE AGORA"]);
});

test("parseCreativePlan: devolve undefined sem headline/cta (campos mínimos obrigatórios)", () => {
  assert.equal(parseCreativePlan(JSON.stringify({ objective: "x" })), undefined);
});

// Auditoria "motor de geração de criativos" — achado ao vivo: texto de peças finais trazia
// strings nunca pedidas ("TEXTO DE DESTAQUE", "SAIBA MAIS"). `allowedRenderedTexts` é a fonte de
// verdade que separa texto REAL (vira pixel) de instrução interna — deliberadamente estrito
// (rejeita o plano INTEIRO se ausente/malformado/inconsistente, nunca deriva silenciosamente).

test("parseCreativePlan: devolve undefined sem allowedRenderedTexts (campo obrigatório, nunca derivado silenciosamente)", () => {
  assert.equal(parseCreativePlan(samplePlanJson({ allowedRenderedTexts: undefined })), undefined);
});

test("parseCreativePlan: devolve undefined com allowedRenderedTexts vazio", () => {
  assert.equal(parseCreativePlan(samplePlanJson({ allowedRenderedTexts: [] })), undefined);
});

test("parseCreativePlan: devolve undefined com allowedRenderedTexts contendo item vazio/não-string", () => {
  assert.equal(parseCreativePlan(samplePlanJson({ allowedRenderedTexts: ["ACESSE AGORA", ""] })), undefined);
  assert.equal(parseCreativePlan(samplePlanJson({ allowedRenderedTexts: ["ACESSE AGORA", 123] })), undefined);
});

test("parseCreativePlan: devolve undefined quando allowedRenderedTexts não inclui o headline exato", () => {
  assert.equal(parseCreativePlan(samplePlanJson({ allowedRenderedTexts: ["algo diferente", "ACESSE AGORA"] })), undefined);
});

test("parseCreativePlan: devolve undefined quando allowedRenderedTexts não inclui o cta exato", () => {
  assert.equal(parseCreativePlan(samplePlanJson({ allowedRenderedTexts: ["TODAS AS OFERTAS EM UM SÓ SITE"] })), undefined);
});

test("parseCreativePlan: devolve undefined para JSON inválido, nunca lança", () => {
  assert.equal(parseCreativePlan("isto não é JSON"), undefined);
});

test("parseCreativePlan: densidade inválida cai pro neutro 'balanced', nunca inventa um valor da lista", () => {
  const plan = parseCreativePlan(samplePlanJson({ visualDensity: "extremamente denso" }));
  assert.equal(plan.visualDensity, "balanced");
});

test("parseCreativePlan: subheadline vazia vira undefined, nunca string vazia", () => {
  const plan = parseCreativePlan(samplePlanJson({ subheadline: "" }));
  assert.equal(plan.subheadline, undefined);
});

test("buildCreativePlanPrompt: inclui marca, objetivo, formato e ideia literalmente", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /Preço Baixo Club/);
  assert.match(prompt, /4:5/);
  assert.match(prompt, /Arte institucional divulgando o site\./);
});

test("buildCreativePlanPrompt: sem fatos comerciais, instrui explicitamente a não inventar preço/desconto", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ confirmedFacts: [] }));
  assert.match(prompt, /Não mencione preço, desconto/);
});

test("buildCreativePlanPrompt: com fatos comerciais, lista exatamente os fatos confirmados", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ confirmedFacts: ["Preço atual: R$ 149,90", "Desconto: 20%"] }));
  assert.match(prompt, /Preço atual: R\$ 149,90/);
  assert.match(prompt, /Desconto: 20%/);
});

// Achado ao vivo em produção: a orientação anterior ("prefira image_model pro headline") fez o
// headline sair cortado nas bordas do canvas em duas tentativas reais seguidas — texto desenhado
// livremente pelo modelo de imagem não tem garantia de caber, ao contrário do renderer
// determinístico. Agora "renderer" é o padrão pra todo texto principal, não só o factual.

test("buildCreativePlanPrompt: instrui preferir renderedBy='renderer' por padrão pra todo texto principal, incluindo headline", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /PREFIRA `"renderer"` para TODO texto principal/);
  assert.match(prompt, /nunca para o headline\/CTA principal da peça/);
});

// Auditoria "motor de geração de criativos" — achado ao vivo: texto de peças finais trazia
// strings nunca pedidas em lugar nenhum ("TEXTO DE DESTAQUE", "SAIBA MAIS"), porque campos de
// DIREÇÃO/ESTILO em prosa livre (visualDirection/styleNotes/compositionIntent) às vezes eram
// interpretados como algo a desenhar literalmente. `allowedRenderedTexts` separa rigidamente
// texto REAL de instrução interna.

test("buildCreativePlanPrompt: instrui allowedRenderedTexts como eco literal de headline/subheadline/cta/textZones, nunca derivado de campos de direção/estilo", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /allowedRenderedTexts.*array com EXATAMENTE os textos que podem aparecer/);
  assert.match(prompt, /nenhuma palavra desses campos pode ser desenhada como texto na peça final/);
});

// Achado ao vivo em produção: o retângulo do headline e o retângulo da logo se sobrepunham no
// mesmo plano real — nada proibia explicitamente essa colisão entre textZones e assetPlacements.

test("buildCreativePlanPrompt: proíbe explicitamente o retângulo de uma textZone se sobrepor ao retângulo de um assetPlacement", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /retângulo de NENHUMA `textZone` pode se sobrepor ao retângulo de NENHUM `assetPlacement`/);
});

test("buildCreativePlanPrompt: proíbe explicitamente o retângulo de uma textZone se sobrepor ao retângulo de OUTRA textZone", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /retângulo de NENHUMA `textZone` pode se sobrepor ao retângulo de NENHUMA outra `textZone`/);
});

test("buildCreativePlanPrompt: descreve o papel de cada asset (produto real vs. screenshot vs. logo)", () => {
  const prompt = buildCreativePlanPrompt(
    sampleContext({
      assets: [
        { url: "https://x/produto.png", role: "product_photo", description: "Tênis RV azul." },
        { url: "https://x/screenshot.png", role: "screenshot", description: "Home do site." },
        { url: "https://x/logo.png", role: "logo", description: "Logo oficial." },
      ],
    }),
  );
  assert.match(prompt, /PRODUTO REAL/);
  assert.match(prompt, /SCREENSHOT REAL DO SITE\/APP/);
  assert.match(prompt, /LOGO OFICIAL DA MARCA/);
});

test("buildCreativePlanPrompt: elementos proibidos aparecem no prompt", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ forbiddenElements: ["Comente QUERO"] }));
  assert.match(prompt, /Comente QUERO/);
});

// Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT"

test("buildCreativePlanPrompt: sempre inclui o preâmbulo explícito de precedência de instruções (pedido atual > workspace > materiais > marca > guardrails)", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /PRECED[ÊE]NCIA DE INSTRU[ÇC][ÕO]ES/);
  assert.match(prompt, /PEDIDO ATUAL/);
});

test("buildCreativePlanPrompt: com productionInstructions, o texto do prompt persistente aparece verbatim marcado como prioridade 2", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ productionInstructions: "Priorize fundo preto/grafite, verde neon, amarelo e branco." }));
  assert.match(prompt, /prioridade 2/);
  assert.match(prompt, /Priorize fundo preto\/grafite, verde neon, amarelo e branco\./);
});

test("buildCreativePlanPrompt: sem productionInstructions nem behaviorPreferences, a SEÇÃO de instruções permanentes do workspace não aparece (só o item da lista de precedência, sempre presente)", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.doesNotMatch(prompt, /respeite exceto quando conflitar/);
});

test("buildCreativePlanPrompt: brandMaterials selecionados aparecem com prioridade e instrução/regra de uso, cada um marcado como prioridade 3", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({
    brandMaterials: [
      { id: "logo-1", name: "Logo Oficial", type: "logo_principal", priority: "required", aiInstructions: "Sempre no canto superior.", usageRule: "Nunca redesenhar.", source: "asset_library", url: "https://x/logo.png", selectionReason: "Prioridade obrigatória." },
    ],
  }));
  assert.match(prompt, /prioridade 3/);
  assert.match(prompt, /Logo Oficial/);
  assert.match(prompt, /OBRIGAT[ÓO]RIO/);
  assert.match(prompt, /Sempre no canto superior\./);
  assert.match(prompt, /REGRA: Nunca redesenhar\./);
});

// Achado ao vivo em produção: peças reais saíam com fundo branco/cores erradas mesmo com
// brandColors configurado, e com texto de baixo contraste — nenhum dos dois tinha instrução
// direta e explícita nos prompts que de fato produzem o creative_plan e a imagem.

test("buildCreativePlanPrompt: com brandColors configurado, a paleta aparece como requisito obrigatório (não uma linha informativa solta)", () => {
  const prompt = buildCreativePlanPrompt(sampleContext({ brandColors: ["preto", "verde", "amarelo"] }));
  assert.match(prompt, /PALETA DE CORES OFICIAL DESTA MARCA \(obrigatória, não uma sugestão\): preto, verde, amarelo/);
  assert.match(prompt, /cores predominantes do fundo/);
});

test("buildCreativePlanPrompt: sem brandColors configurado, não menciona paleta nenhuma", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.doesNotMatch(prompt, /PALETA DE CORES/);
});

test("buildCreativePlanPrompt: sempre instrui alto contraste entre texto e fundo, mesmo sem paleta configurada", () => {
  const prompt = buildCreativePlanPrompt(sampleContext());
  assert.match(prompt, /ALTO CONTRASTE/);
  assert.match(prompt, /nunca texto claro sobre fundo claro/);
});

test("buildImageGenerationPromptFromPlan: instrui deixar espaço pra logo/screenshot em vez de desenhá-los, quando presentes no contexto", () => {
  const context = sampleContext({
    assets: [
      { url: "https://x/logo.png", role: "logo", description: "" },
      { url: "https://x/screenshot.png", role: "screenshot", description: "" },
    ],
  });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /NÃO desenhe uma logo/);
  assert.match(imagePrompt, /NÃO desenhe a interface do site/);
});

test("buildImageGenerationPromptFromPlan: sem logo/screenshot no contexto, não menciona deixar espaço pra eles", () => {
  const context = sampleContext({ assets: [] });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.doesNotMatch(imagePrompt, /NÃO desenhe uma logo/);
  assert.doesNotMatch(imagePrompt, /NÃO desenhe a interface do site/);
});

test("buildImageGenerationPromptFromPlan: inclui headline/cta literalmente entre aspas", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /"TODAS AS OFERTAS EM UM SÓ SITE"/);
  assert.match(imagePrompt, /"ACESSE AGORA"/);
});

// Achado ao vivo em produção: um plano que decide `renderedBy: "renderer"` pro headline/CTA (o
// compositor determinístico desenha por cima depois) mas cujo prompt de imagem ainda mandava o
// próprio modelo desenhar o mesmo texto — duas camadas de texto sobrepostas, sempre reprovadas
// (TEXT_ILLEGIBLE_OR_CUT/CRITICAL_OVERLAP/COMPOSITION_BROKEN) e sem chance real de reparo, porque
// nenhum `gpt_replan` corrige uma armadilha que está no PROMPT, não no plano.

test("buildImageGenerationPromptFromPlan: headline/cta com renderedBy='renderer' manda deixar a região limpa, NUNCA escrever o texto duas vezes", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(
    samplePlanJson({
      textZones: [
        { kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 20 }, emphasis: "primary", renderedBy: "renderer" },
        { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
      ],
    }),
  );
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.doesNotMatch(imagePrompt, /Headline \(desenhar exatamente este texto/);
  assert.doesNotMatch(imagePrompt, /CTA \(desenhar exatamente este texto/);
  assert.doesNotMatch(imagePrompt, /"TODAS AS OFERTAS EM UM SÓ SITE"/);
  assert.doesNotMatch(imagePrompt, /"ACESSE AGORA"/);
  assert.match(imagePrompt, /5%–95% na horizontal e 5%–25% na vertical completamente limpa, sem nenhum texto: o headline será desenhado por cima depois/);
  assert.match(imagePrompt, /10%–90% na horizontal e 80%–90% na vertical completamente limpa, sem nenhum texto: o cta será desenhado por cima depois/);
  // A lista de "textos permitidos" só cita o que o PRÓPRIO modelo ainda precisa desenhar
  // (subheadline, sem zona própria neste teste) — headline/cta (renderer) não aparecem nem aqui.
  assert.match(imagePrompt, /TEXTOS PERMITIDOS NESTA PEÇA — lista FECHADA e EXAUSTIVA de tudo que VOCÊ \(modelo de imagem\) pode desenhar como texto: "Shopee \+ Mercado Livre"/);
  assert.match(imagePrompt, /Os demais textos autorizados desta peça já foram tratados nas instruções acima/);
});

test("buildImageGenerationPromptFromPlan: com TODOS os textos autorizados sendo do renderer, vira proibição genérica — nenhum deles é citado", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(
    samplePlanJson({
      subheadline: undefined,
      textZones: [
        { kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 20 }, emphasis: "primary", renderedBy: "renderer" },
        { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 80, widthPct: 80, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" },
      ],
      allowedRenderedTexts: ["TODAS AS OFERTAS EM UM SÓ SITE", "ACESSE AGORA"],
    }),
  );
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.doesNotMatch(imagePrompt, /"TODAS AS OFERTAS EM UM SÓ SITE"/);
  assert.doesNotMatch(imagePrompt, /"ACESSE AGORA"/);
  assert.match(imagePrompt, /NUNCA escreva NENHUM texto além do que já foi instruído acima/);
});

test("buildImageGenerationPromptFromPlan: headline/cta com renderedBy='image_model' continua instruindo o modelo a desenhar o texto exato", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(
    samplePlanJson({
      textZones: [
        { kind: "headline", text: "TODAS AS OFERTAS EM UM SÓ SITE", rect: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 20 }, emphasis: "primary", renderedBy: "image_model" },
      ],
    }),
  );
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /"TODAS AS OFERTAS EM UM SÓ SITE"/);
});

test("buildImageGenerationPromptFromPlan: com brandColors configurado, repete a paleta como obrigatória NO prompt que gera a imagem (nunca só no prompt do plano, um passo antes)", () => {
  const context = sampleContext({ brandColors: ["preto", "verde", "amarelo"] });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /PALETA DE CORES OBRIGATÓRIA: preto, verde, amarelo/);
});

test("buildImageGenerationPromptFromPlan: sem brandColors configurado, não menciona paleta nenhuma", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.doesNotMatch(imagePrompt, /PALETA DE CORES/);
});

// Auditoria "motor de geração de criativos" — achado ao vivo: mesmo com headline/subheadline
// corretamente desenhados pelo renderer (sem corte, com contraste garantido), o modelo de imagem
// inventou tipografia decorativa extra por conta própria (slogan, rótulo técnico "TEXTO DE
// DESTAQUE", botão "SAIBA MAIS" — nada pedido em lugar nenhum do plano). Uma proibição genérica
// não bastou de forma confiável — agora o prompt repete a lista FECHADA de `allowedRenderedTexts`
// (a mesma fonte de verdade que o quality gate usa pra reprovar objetivamente).

test("buildImageGenerationPromptFromPlan: sempre lista os textos permitidos como lista FECHADA e proíbe qualquer texto fora dela", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /TEXTOS PERMITIDOS NESTA PEÇA — lista FECHADA e EXAUSTIVA/i);
  assert.match(imagePrompt, /"TODAS AS OFERTAS EM UM SÓ SITE"/);
  assert.match(imagePrompt, /"ACESSE AGORA"/);
  assert.match(imagePrompt, /NUNCA escreva nenhuma outra palavra/);
});

test("buildImageGenerationPromptFromPlan: sempre instrui alto contraste entre texto e fundo", () => {
  const context = sampleContext();
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /ALTO CONTRASTE/);
});

// Auditoria "motor de geração de criativos" — achado ao vivo: um headline sem textZone/rect
// (desenhado livremente pelo modelo) saiu cortado na borda MESMO com a margem de 6% (valor
// arbitrário) já instruída — porque 4:5/9:16/16:9 sofrem corte automático centralizado depois da
// geração (gpt-image-1 não suporta essas proporções nativamente), e o modelo desenha sobre um
// canvas nativo maior, sem saber que uma faixa das bordas será removida. Agora a margem é a
// EXATA que o corte de fato remove (ver `image-crop-geometry.ts`), não um número arbitrário.

test("buildImageGenerationPromptFromPlan: instrui a margem de borda EXATA que o corte automático de 4:5 remove (8.3%, não um valor arbitrário)", () => {
  const context = sampleContext({ format: "4:5" });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /pelo menos 8\.3% de distância de cada borda/);
});

test("buildImageGenerationPromptFromPlan: em 9:16, usa a margem exata desse formato (7.8%), diferente de 4:5", () => {
  const context = sampleContext({ format: "9:16" });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /pelo menos 7\.8% de distância de cada borda/);
});

test("buildImageGenerationPromptFromPlan: em 1:1 (sem corte automático), cai no piso de segurança geral de 6%", () => {
  const context = sampleContext({ format: "1:1" });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /pelo menos 6% de distância de cada borda/);
});

// Achado ao vivo em produção: sem nenhum screenshot real cadastrado, o modelo inventou uma
// interface de site fictícia inteira com nomes de marca digitados errado ("Shopce", "mereado
// livre") — texto pequeno gerado por modelo de imagem quase sempre sai com erro de grafia, então a
// única instrução confiável é nunca pedir esse texto.

test("buildImageGenerationPromptFromPlan: sem screenshot real cadastrado, proíbe texto legível dentro de qualquer mockup de dispositivo", () => {
  const context = sampleContext({ assets: [] });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /NUNCA escreva texto legível dentro dela/);
});

test("buildImageGenerationPromptFromPlan: com screenshot real cadastrado, não repete a proibição genérica de texto no mockup (já instrui deixar a região limpa)", () => {
  const context = sampleContext({ assets: [{ url: "https://x/screenshot.png", role: "screenshot", description: "" }] });
  const plan = parseCreativePlan(samplePlanJson());
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.doesNotMatch(imagePrompt, /NUNCA escreva texto legível dentro dela/);
});

// ---------------------------------------------------------------------------------------------
// PR 4/9 (migração "GPT como motor criativo único") — geometria de asset e zonas de texto
// ---------------------------------------------------------------------------------------------

test("parseCreativePlan: assetPlacements/textZones ausentes viram listas vazias (plano antigo continua válido)", () => {
  const plan = parseCreativePlan(samplePlanJson());
  assert.deepEqual(plan.assetPlacements, []);
  assert.deepEqual(plan.textZones, []);
});

test("parseCreativePlan: aceita assetPlacements/textZones bem formados", () => {
  const plan = parseCreativePlan(samplePlanJson({
    assetPlacements: [
      { role: "logo", url: "https://x/logo.png", rect: { xPct: 4, yPct: 4, widthPct: 18, heightPct: 10 }, frame: "none" },
      { role: "screenshot", url: "https://x/shot.png", rect: { xPct: 20, yPct: 30, widthPct: 60, heightPct: 45 }, frame: "phone" },
    ],
    textZones: [
      { kind: "cta", text: "ACESSE AGORA", rect: { xPct: 10, yPct: 85, widthPct: 80, heightPct: 8 }, emphasis: "primary", renderedBy: "renderer" },
    ],
  }));
  assert.equal(plan.assetPlacements.length, 2);
  assert.equal(plan.assetPlacements[0].role, "logo");
  assert.equal(plan.assetPlacements[1].frame, "phone");
  assert.equal(plan.textZones.length, 1);
  assert.equal(plan.textZones[0].renderedBy, "renderer");
});

test("parseCreativePlan: rejeita o PLANO INTEIRO quando um assetPlacement tem retângulo fora dos limites do canvas", () => {
  const plan = parseCreativePlan(samplePlanJson({
    assetPlacements: [{ role: "logo", url: "https://x/logo.png", rect: { xPct: 90, yPct: 4, widthPct: 30, heightPct: 10 } }],
  }));
  assert.equal(plan, undefined, "xPct+widthPct > 100 deveria invalidar o plano inteiro, nunca clampar silenciosamente");
});

test("parseCreativePlan: rejeita o plano inteiro quando um assetPlacement tem role desconhecido", () => {
  const plan = parseCreativePlan(samplePlanJson({
    assetPlacements: [{ role: "banner_generico", url: "https://x/x.png", rect: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 } }],
  }));
  assert.equal(plan, undefined);
});

test("parseCreativePlan: rejeita o plano inteiro quando uma textZone tem retângulo com largura/altura zero ou negativa", () => {
  const plan = parseCreativePlan(samplePlanJson({
    textZones: [{ kind: "cta", text: "ACESSE", rect: { xPct: 10, yPct: 10, widthPct: 0, heightPct: 10 }, emphasis: "primary", renderedBy: "renderer" }],
  }));
  assert.equal(plan, undefined);
});

test("parseCreativePlan: rejeita o plano inteiro quando uma textZone tem renderedBy/emphasis fora do vocabulário fechado", () => {
  const plan = parseCreativePlan(samplePlanJson({
    textZones: [{ kind: "cta", text: "ACESSE", rect: { xPct: 10, yPct: 10, widthPct: 10, heightPct: 10 }, emphasis: "primary", renderedBy: "modelo_qualquer" }],
  }));
  assert.equal(plan, undefined);
});

test("buildImageGenerationPromptFromPlan: com assetPlacement de logo/screenshot, usa a geometria exata em percentual (não mais a instrução genérica)", () => {
  const context = sampleContext({
    assets: [
      { url: "https://x/logo.png", role: "logo", description: "" },
      { url: "https://x/screenshot.png", role: "screenshot", description: "" },
    ],
  });
  const plan = parseCreativePlan(samplePlanJson({
    assetPlacements: [
      { role: "logo", url: "https://x/logo.png", rect: { xPct: 4, yPct: 4, widthPct: 18, heightPct: 10 } },
      { role: "screenshot", url: "https://x/screenshot.png", rect: { xPct: 20, yPct: 30, widthPct: 60, heightPct: 45 }, frame: "laptop" },
    ],
  }));
  const imagePrompt = buildImageGenerationPromptFromPlan(plan, context);
  assert.match(imagePrompt, /4%–22% na horizontal e 4%–14% na vertical/);
  assert.match(imagePrompt, /20%–80% na horizontal e 30%–75% na vertical/);
  assert.match(imagePrompt, /notebook/);
  assert.match(imagePrompt, /NÃO desenhe uma logo/);
  assert.match(imagePrompt, /NUNCA a interface do site/);
});
