import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { VIDEO_EDIT_DRAFT_SCHEMA_VERSION } from "../schemas/video-edit-draft.v1.js";

/**
 * `video_edit_planning` v1 — a IA como diretora e editora. Recebe fatos sobre os materiais (nunca
 * os arquivos), as frases numeradas da transcrição e a identidade da marca; devolve um rascunho de
 * edição pela ferramenta. Três modos: criar, revisar (pedido de alteração por conversa) e reparar
 * (rascunho anterior recusado pelo validador).
 */

export type VideoEditPlanningContext = {
  mode: "create" | "revise" | "repair";
  request: string;
  aspect: string;
  targetDurationSeconds?: number;
  style?: { editing?: string; transitions?: string; captions?: boolean; music?: boolean };
  brand?: { name?: string; tone?: string; palette?: string[]; ctaExamples?: string[] };
  materials: { id: string; kind: string; role: string; label?: string; orientation?: string; durationSeconds?: number; hasSpeech?: boolean; colors?: string[]; notes?: string }[];
  sentences?: { id: string; materialId: string; start: number; end: number; text: string }[];
  products?: { name: string; details?: string }[];
  recentStrategies?: string[];
  previousDraft?: unknown;
  revisionRequest?: string;
  revisionScope?: { scenesAllowed: number[] | "all"; textsOnly?: boolean; captions?: boolean; audio?: boolean; logo?: boolean };
  repairIssues?: string[];
};

const INSTRUCTIONS = `Você é diretor(a) e editor(a) de vídeos publicitários curtos para redes sociais de pequenas e médias marcas brasileiras.
Você decide a edição; um sistema executa exatamente o que você decidir. Responda APENAS pela ferramenta.

Regras de edição (obrigatórias):
1. Use SOMENTE os materiais listados (pelo id) ou "CARD" (cartão com as cores da marca, bom para abertura de impacto ou encerramento com CTA).
2. Vídeo com fala: escolha frases pelo id, sempre CONSECUTIVAS e na ordem original, com começo e fim de ideia (nunca corte no meio de um raciocínio, nunca mude o sentido). Prefira os trechos com mais valor para o objetivo: gancho/dor, prova, benefício, chamada. Pule hesitações, repetições e pausas ("é...", "deixa eu ver").
3. Você nunca escreve fala nem legenda: as legendas saem da transcrição. Seus textos na tela são títulos curtos (gancho e CTA com até 6 palavras).
4. Nunca invente preço, desconto, prazo, número, garantia ou característica que não esteja no pedido ou nos dados. Na dúvida, não afirme.
5. Abertura forte nos primeiros 2 segundos (gancho visual ou de texto). Termine com chamada para ação clara (cena "cta", normalmente um CARD).
6. Ritmo: cenas de 1,5 a 4 s em anúncios com fotos; respeite a duração pedida. Varie movimento e transição entre cenas, sem exagero: no máximo 2 tipos de transição por vídeo além do corte; fala entre cenas de fala usa corte.
7. Produto e tela: mostre inteiros e nítidos; texto nunca no centro de um produto; prefira top/bottom. Para detalhe da estampa, use push_in com foco onde o detalhe está.
8. Não repita a estratégia das peças recentes da marca quando houver alternativa.
9. Português do Brasil, tom da marca. Se algo pedido não for possível com os materiais, registre em "warnings".
10. Composição (campo "layout", só para imagem) — evite vídeo com cara de apresentação de fotos: use 2 a 4 composições diferentes por vídeo. "parallax" dá profundidade ao gancho; "framed" valoriza o produto num cartão; "split" põe a foto ao lado de um painel da marca com o texto (o texto vai para o painel e pode usar position "center"); "inset" amplia um detalhe numa lupa (use focus onde o detalhe está); "device_phone"/"device_laptop" põem uma captura de tela real dentro do aparelho. "full" = tela cheia. Texto "kinetic" faz as palavras entrarem uma a uma (bom para gancho). "punch_in" é aproximação rápida (gancho); "drift" é deriva lenta.`;

export const VIDEO_EDIT_PLAN_PROMPT_HASH = createHash("sha256").update(INSTRUCTIONS).digest("hex");

function list<T>(items: T[] | undefined, render: (item: T) => string): string[] {
  return (items ?? []).map(render);
}

export const videoEditPlanPromptV1: PromptTemplate<VideoEditPlanningContext> = {
  id: "video-edit-plan",
  version: 1,
  operation: "video_edit_planning",
  changelog: "v1: rascunho de edição em alto nível (cenas, ritmo, transições, textos, legendas, trilha, logo) com frases por id.",
  hash: VIDEO_EDIT_PLAN_PROMPT_HASH,
  buildSystemInstructions() {
    return [INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${VIDEO_EDIT_DRAFT_SCHEMA_VERSION}.`].join("\n");
  },
  buildUserInput(context) {
    const lines: string[] = [];
    if (context.mode === "revise") {
      lines.push("MODO: REVISÃO de um vídeo já gerado.", `Pedido de alteração: ${context.revisionRequest ?? context.request}`);
      const scope = context.revisionScope;
      if (scope) lines.push(`Pode mudar: cenas ${scope.scenesAllowed === "all" ? "todas" : scope.scenesAllowed.map((n) => n + 1).join(", ") || "nenhuma"}${scope.textsOnly ? " (só os textos)" : ""}; legendas: ${scope.captions ? "sim" : "não"}; áudio: ${scope.audio ? "sim" : "não"}; logo: ${scope.logo ? "sim" : "não"}. Todo o resto deve ficar IDÊNTICO ao rascunho anterior.`);
      lines.push("Rascunho anterior (JSON):", JSON.stringify(context.previousDraft), "");
    } else if (context.mode === "repair") {
      lines.push("MODO: CORREÇÃO. O rascunho anterior foi recusado pelo validador. Corrija SOMENTE estes problemas, mantendo as boas decisões:", ...list(context.repairIssues, (issue) => `- ${issue}`), "Rascunho recusado (JSON):", JSON.stringify(context.previousDraft), "");
    }
    lines.push(`Pedido do cliente: ${context.request}`, `Formato: ${context.aspect}${context.targetDurationSeconds ? ` · duração desejada: ~${context.targetDurationSeconds}s` : ""}`);
    if (context.style) lines.push(`Estilo: edição ${context.style.editing ?? "padrão"}; transições ${context.style.transitions ?? "moderadas"}; legendas ${context.style.captions === false ? "não" : "sim, se houver fala"}; trilha ${context.style.music === false ? "não" : "sim"}.`);
    if (context.brand) lines.push(`Marca: ${context.brand.name ?? "—"}${context.brand.tone ? ` · tom: ${context.brand.tone}` : ""}${context.brand.palette?.length ? ` · cores: ${context.brand.palette.join(", ")}` : ""}${context.brand.ctaExamples?.length ? ` · CTAs da marca: ${context.brand.ctaExamples.join(" | ")}` : ""}`);
    if (context.products?.length) lines.push("Produtos:", ...list(context.products, (product) => `- ${product.name}${product.details ? `: ${product.details}` : ""}`));
    lines.push("", "Materiais:", ...list(context.materials, (m) => `- ${m.id} · ${m.kind} · ${m.role}${m.label ? ` · "${m.label}"` : ""}${m.orientation ? ` · ${m.orientation}` : ""}${m.durationSeconds ? ` · ${m.durationSeconds.toFixed(1)}s` : ""}${m.hasSpeech ? " · com fala" : ""}${m.colors?.length ? ` · cores ${m.colors.join(" ")}` : ""}${m.notes ? ` · ${m.notes}` : ""}`));
    if (context.sentences?.length) lines.push("", "Frases da transcrição (id · material · início–fim · texto):", ...list(context.sentences, (s) => `- ${s.id} · ${s.materialId} · ${s.start.toFixed(1)}–${s.end.toFixed(1)}s · "${s.text}"`));
    if (context.recentStrategies?.length) lines.push("", `Estratégias usadas recentemente pela marca (evite repetir): ${context.recentStrategies.join(", ")}`);
    return lines.join("\n");
  },
};
