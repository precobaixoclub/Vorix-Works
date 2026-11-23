/**
 * Diretiva do cliente — o que o USUÁRIO já decidiu para a peça e que o motor criativo não pode
 * descartar nem substituir (Fase 2 da evolução do motor, 22/11/2026).
 *
 * Achado do teste real com as 3 marcas: com um prompt detalhado do cliente ("módulos à esquerda,
 * núcleo integrado à direita"; "casal ao pôr do sol"), o motor (1) explorava direções "originais" e
 * trocava a cena por metáforas (constelação, reflexo no espelho), (2) o plano descartava linhas do
 * texto da arte e (3) o prompt do cliente nunca chegava ao modelo de imagem, que só recebia um resumo
 * do plano. Este módulo é o contrato ÚNICO entre quem monta o pedido (Bolsão,
 * `buildEditorialGenerationBrief`) e quem o executa (plano, validação e prompt de imagem):
 *
 * - restrições obrigatórias: cena/objetos/posições descritos no prompt, texto exato da arte, CTA;
 * - liberdade criativa: iluminação, profundidade, texturas, enquadramento não especificado,
 *   detalhes decorativos, tratamento e acabamento.
 *
 * Módulo puro (sem I/O), em `shared` para domínio, aplicação e testes usarem a mesma regra.
 */

export const DIRECTIVE_ART_TEXT_HEADER = "TEXTO DA ARTE OBRIGATÓRIO (todas as linhas, na ordem, sem resumir nem reescrever):";
export const DIRECTIVE_PROMPT_HEADER = "PROMPT CRIATIVO ESPECÍFICO (direção dominante de arte e narrativa):";
export const DIRECTIVE_PROMPT_END = "[FIM DO PROMPT CRIATIVO DO CLIENTE]";
export const DIRECTIVE_CTA_PREFIX = "CTA:";

export type CreativeDirective = {
  /** Prompt do cliente, íntegro (quando houver). */
  clientPrompt?: string;
  /** Linhas do texto da arte, na ordem, exatamente como cadastradas. */
  artTextLines: string[];
  /** Chamada para ação exata (quando houver). */
  cta?: string;
};

/** Linhas do texto da arte a partir do texto cadastrado (uma por linha não vazia). */
export function splitArtTextLines(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•]\s+/, "").trim())
    .filter(Boolean);
}

export function formatArtTextBlock(lines: readonly string[]): string {
  return [DIRECTIVE_ART_TEXT_HEADER, ...lines.map((line, index) => `${index + 1}) ${line}`)].join("\n");
}

/** Lê a diretiva de volta do texto do pedido (`ideaText`). `undefined` = pedido sem diretiva. */
export function parseCreativeDirective(ideaText: string | undefined): CreativeDirective | undefined {
  const text = ideaText ?? "";
  const artTextLines: string[] = [];
  const artStart = text.indexOf(DIRECTIVE_ART_TEXT_HEADER);
  if (artStart >= 0) {
    for (const line of text.slice(artStart + DIRECTIVE_ART_TEXT_HEADER.length).split(/\r?\n/).slice(1)) {
      const match = line.match(/^\s*\d+\)\s?(.*)$/);
      if (!match) break;
      if (match[1]!.trim()) artTextLines.push(match[1]!.trim());
    }
  }
  let clientPrompt: string | undefined;
  const promptStart = text.indexOf(DIRECTIVE_PROMPT_HEADER);
  if (promptStart >= 0) {
    const afterHeader = text.slice(promptStart + DIRECTIVE_PROMPT_HEADER.length);
    const end = afterHeader.indexOf(DIRECTIVE_PROMPT_END);
    // Sem o marcador de fim (pedido antigo ou cortado pelo orçamento), vai até a linha de CTA.
    const ctaCut = afterHeader.search(new RegExp(`\\n${DIRECTIVE_CTA_PREFIX}`));
    const body = end >= 0 ? afterHeader.slice(0, end) : ctaCut >= 0 ? afterHeader.slice(0, ctaCut) : afterHeader;
    clientPrompt = body.trim() || undefined;
  }
  const ctaMatch = text.match(new RegExp(`(?:^|\\n)${DIRECTIVE_CTA_PREFIX}\\s*(.+)`));
  const cta = ctaMatch?.[1]?.trim() || undefined;
  if (!clientPrompt && artTextLines.length === 0) return undefined;
  return { ...(clientPrompt ? { clientPrompt } : {}), artTextLines, ...(cta ? { cta } : {}) };
}

/** Comparação tolerante só a caixa, acentuação de pontuação e espaços: as PALAVRAS e sua ordem
 * precisam estar todas lá (nunca aceita resumo, corte ou troca de palavra). */
export function normalizeForTextMatch(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DirectiveTextIssue = { kind: "missing_art_text_line" | "cta_mismatch"; detail: string };

/**
 * Confere um plano contra a diretiva: cada linha do texto da arte precisa estar no título OU no
 * subtítulo (o diretor decide o agrupamento; o renderer editorial só desenha título, subtítulo, CTA,
 * preço e site) e o CTA precisa ser o do cliente. Lista vazia = plano fiel.
 */
export function findDirectiveTextIssues(plan: { headline: string; subheadline?: string; cta: string }, directive: CreativeDirective | undefined): DirectiveTextIssue[] {
  if (!directive) return [];
  const issues: DirectiveTextIssue[] = [];
  const rendered = ` ${normalizeForTextMatch(plan.headline)} | ${normalizeForTextMatch(plan.subheadline ?? "")} `;
  for (const line of directive.artTextLines) {
    const needle = normalizeForTextMatch(line);
    if (needle && !rendered.includes(needle)) issues.push({ kind: "missing_art_text_line", detail: line });
  }
  if (directive.cta && normalizeForTextMatch(plan.cta) !== normalizeForTextMatch(directive.cta)) {
    issues.push({ kind: "cta_mismatch", detail: directive.cta });
  }
  return issues;
}

export function describeDirectiveTextIssues(issues: readonly DirectiveTextIssue[]): string | undefined {
  if (issues.length === 0) return undefined;
  const missing = issues.filter((issue) => issue.kind === "missing_art_text_line").map((issue) => `"${issue.detail}"`);
  const cta = issues.find((issue) => issue.kind === "cta_mismatch");
  return [
    missing.length > 0 ? `o texto da arte do cliente perdeu linha(s): ${missing.join(", ")} — cada linha precisa aparecer INTEIRA (mesmas palavras, mesma ordem) dentro de "headline" ou "subheadline"; nunca resuma nem descarte.` : "",
    cta ? `o "cta" precisa ser exatamente "${cta.detail}".` : "",
  ].filter(Boolean).join(" ");
}

/** Bloco do prompt do diretor criativo: o que é obrigatório e o que é liberdade criativa. */
export function buildDirectivePlanLines(directive: CreativeDirective): string[] {
  const lines = [
    "",
    "BRIEF DO CLIENTE — RESTRIÇÕES OBRIGATÓRIAS (o cliente já decidiu o conceito; seu papel é EXECUTAR com excelência, nunca reinventar):",
  ];
  if (directive.clientPrompt) {
    lines.push(
      "- A cena, os personagens/objetos, as POSIÇÕES (esquerda/direita/centro/topo/base), o formato e o conceito descritos no prompt do cliente são OBRIGATÓRIOS. Nunca troque por metáfora, alegoria ou outra cena. Exemplos do que é PROIBIDO: o prompt pede módulos à esquerda e núcleo integrado à direita e o plano usa constelações; o prompt pede casal ao pôr do sol e o plano usa reflexo no espelho; o prompt pede uma composição de produtos e o plano troca, remove ou muda a relação entre eles.",
      "- `artDirection.concept`, `artDirection.visualFocus`, `visualDirection`, `compositionIntent` e `layoutPlan` precisam descrever ESSA cena, com os MESMOS elementos e as MESMAS posições pedidas.",
      "- Liberdade criativa SOMENTE em: iluminação, profundidade, texturas, enquadramento (quando não especificado), detalhes decorativos, tratamento visual e acabamento estético.",
      "- Instruções do prompt sobre tipografia, logo e textos valem para o layout desenhado pelo renderer — nunca peça para o modelo de imagem desenhar letras.",
    );
  }
  lines.push(
    "- IDENTIDADE DA MARCA CONFIGURADA (Perfil da Marca deste workspace, descrito mais abaixo) é tão obrigatória quanto o brief: paleta de cores por papel, logo oficial (só o arquivo real, nunca redesenhada), tipografia, caixa do título, estilo, formas e padrões PROIBIDOS. Em conflito de cor, logo, tipografia ou proibição entre o prompt do cliente e o Perfil da Marca, o PERFIL DA MARCA vence; a liberdade criativa nunca passa por cima dele.",
  );
  if (directive.artTextLines.length > 0) {
    lines.push(
      `- TEXTO DA ARTE (obrigatório): ${directive.artTextLines.map((line) => `"${line}"`).join(" / ")}. TODAS as linhas precisam aparecer INTEIRAS, na ordem, dentro de \`headline\` e \`subheadline\` (você decide o agrupamento: ex. linhas 1-2 no headline e o restante no subheadline). Nunca resuma, corte, reescreva, traduza nem invente palavras. \`allowedRenderedTexts\` repete exatamente esses textos.`,
    );
  }
  if (directive.cta) lines.push(`- \`cta\` = exatamente "${directive.cta}".`);
  return lines;
}

/** Seções do prompt do cliente que tratam de texto/marca: ficam fora do prompt de IMAGEM (o
 * renderer cuida delas) para o modelo de imagem nunca desenhar letras ou logos. */
const NON_VISUAL_SECTION = /TIPOGRAF|TEXTO|IDENTIDADE|LOGO|MARCA|OBJETIVO COMERCIAL|RESULTADO ESPERADO|CTA|CHAMADA/i;

/**
 * Prompt do cliente para o MODELO DE IMAGEM: mantém as seções visuais (conceito, cena, composição,
 * direção de arte, evitar, acabamento) e remove as de tipografia/marca/objetivo. Sem seções
 * marcadas (`**TÍTULO**`), devolve o texto inteiro.
 */
export function buildClientSceneBriefForImage(clientPrompt: string | undefined): string | undefined {
  if (!clientPrompt?.trim()) return undefined;
  const sections: { heading?: string; body: string[] }[] = [{ body: [] }];
  for (const line of clientPrompt.split(/\r?\n/)) {
    const heading = line.match(/^\s*(?:\*\*|#{1,4}\s*)(.+?)(?:\*\*)?\s*$/);
    if (heading && /\*\*|#/.test(line)) sections.push({ heading: heading[1]!.replace(/\*\*/g, "").trim(), body: [] });
    else sections[sections.length - 1]!.body.push(line);
  }
  const kept = sections
    .filter((section) => !section.heading || !NON_VISUAL_SECTION.test(section.heading))
    .map((section) => [section.heading ? `${section.heading}:` : "", ...section.body].join("\n").trim())
    .filter(Boolean);
  const result = kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return result || undefined;
}

export const CLIENT_SCENE_BRIEF_IMAGE_INTRO =
  "CLIENT SCENE BRIEF — MANDATORY subject matter, objects, positions and composition (follow it literally; you may only improve lighting, depth, textures, unspecified framing, decorative details and finishing). Ignore any mention of words, typography, titles or logos in it: all text and the real logo are composited later. The brief is in Portuguese:";
