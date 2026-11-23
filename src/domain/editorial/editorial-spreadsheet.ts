/**
 * Modelo de PLANILHA (CSV) do bolsão de pautas — baixar como modelo e importar.
 *
 * Mesma substância do pacote `vorix.editorial-pack/v1` (ver `editorial-idea.model.ts`), só que numa
 * planilha de colunas fixas: assim dá para gerar as pautas em qualquer ferramenta (inclusive outra
 * IA) e importar direto no bolsão. O CSV vira um pacote e passa pela MESMA validação do import JSON
 * (`parseEditorialPack`) — nada entra sem estar completo e correto.
 *
 * Roteiros (carrossel/vídeo) moram numa única coluna, porque a planilha é plana:
 *   - carouselScript: `Título 1 :: Corpo 1 || Título 2 :: Corpo 2 || ...`  (2 a 10 telas)
 *   - videoScript:    `0–3s :: Cena :: Texto na tela || 3–10s :: ... || ...` (2 a 12 cenas)
 */

import { EDITORIAL_PACK_SCHEMA, EditorialPackError } from "./editorial-idea.model.js";

/** Colunas do modelo, na ordem do CSV. Os cabeçalhos são as próprias chaves do pacote Vorix. */
export const EDITORIAL_SHEET_COLUMNS = [
  "id", "title", "category", "commercialObjective", "targetAudience", "concept", "keyMessage",
  "format", "approach", "visualDirection", "narrativeStructure", "caption", "cta", "priority",
  "suggestedDate", "creativePrompt", "carouselScript", "videoScript",
] as const;

export type EditorialSheetColumn = (typeof EDITORIAL_SHEET_COLUMNS)[number];

/** Colunas obrigatórias (as demais podem ficar em branco). */
const REQUIRED_COLUMNS: readonly EditorialSheetColumn[] = [
  "id", "title", "category", "commercialObjective", "targetAudience", "concept", "keyMessage",
  "format", "approach", "visualDirection", "narrativeStructure", "caption", "cta",
];

const SLIDE_SEP = "||";
const FIELD_SEP = "::";
export const EDITORIAL_SHEET_MAX_ROWS = 500;

// ---------------------------------------------------------------------------------------------
// Download do modelo
// ---------------------------------------------------------------------------------------------

/** Linhas de exemplo (ids "EXEMPLO-*") que mostram cada formato e a codificação dos roteiros. */
const TEMPLATE_EXAMPLES: Record<EditorialSheetColumn, string>[] = [
  {
    id: "EXEMPLO-1", title: "Troque o print pelo histórico", category: "Atendimento",
    commercialObjective: "Mostrar que o histórico de conversa guardado evita retrabalho no atendimento.",
    targetAudience: "Pequenos negócios que atendem por WhatsApp e perdem contexto entre conversas.",
    concept: "Quando o combinado fica espalhado em prints e áudios, a equipe pergunta de novo o que o cliente já disse.",
    keyMessage: "O contexto do cliente precisa ficar registrado, não na memória de quem atendeu.",
    format: "single_image", approach: "Problema e virada",
    visualDirection: "Fundo escuro, tipografia grande, um balão de conversa em destaque.",
    narrativeStructure: "Dor concreta no topo, a solução no fecho.",
    caption: "A conversa acabou. O contexto precisa ficar. Veja como centralizar o histórico de cada cliente.",
    cta: "Conheça a Vorix Works", priority: "high", suggestedDate: "", creativePrompt: "",
    carouselScript: "", videoScript: "",
  },
  {
    id: "EXEMPLO-2", title: "3 sinais de que sua planilha travou o time", category: "Educação",
    commercialObjective: "Gerar identificação e autoridade mostrando limites da planilha.",
    targetAudience: "Gestores que ainda controlam vendas e clientes em planilhas.",
    concept: "A planilha resolve no começo, mas some com histórico, trava em duas mãos e não avisa nada.",
    keyMessage: "Planilha não escala atendimento nem relacionamento.",
    format: "carousel", approach: "Lista",
    visualDirection: "Carrossel escuro, um sinal por tela, número grande.",
    narrativeStructure: "Gancho, três sinais, convite.",
    caption: "Sua planilha já deu o que tinha que dar? Veja 3 sinais — e o próximo passo.",
    cta: "Fale com a gente", priority: "normal", suggestedDate: "", creativePrompt: "",
    carouselScript: "Planilha travou? :: Três sinais de que o controle manual virou gargalo || 1. Sem histórico :: Ninguém sabe o que foi combinado antes || 2. Trava a dois :: Duas pessoas editam e o dado se perde || Próximo passo :: Centralize em um só lugar",
    videoScript: "",
  },
  {
    id: "EXEMPLO-3", title: "Bastidor: do pedido ao retorno", category: "Bastidores",
    commercialObjective: "Humanizar a marca mostrando o fluxo real de atendimento.",
    targetAudience: "Seguidores da marca interessados em como o produto funciona na prática.",
    concept: "Mostrar, em poucos segundos, um pedido chegando e o retorno saindo com todo o contexto à mão.",
    keyMessage: "Atendimento com contexto é mais rápido e menos estressante.",
    format: "video", approach: "Demonstração",
    visualDirection: "Captura de tela real do sistema com destaques animados.",
    narrativeStructure: "Gancho, demonstração, fecho com CTA.",
    caption: "Do pedido ao retorno, sem perder o fio. Veja o fluxo real.",
    cta: "Agende uma demonstração", priority: "normal", suggestedDate: "", creativePrompt: "",
    carouselScript: "",
    videoScript: "0–3s :: Abre no painel com uma conversa :: \"E quando o cliente volta?\" || 3–10s :: Mostra o histórico aparecendo :: Tudo que foi combinado, à mão || 10–18s :: Fecho com a marca :: Atenda com contexto",
  },
];

function csvCell(value: string): string {
  // Anti-injeção de fórmula + escape RFC-4180. Sempre entre aspas para não depender do delimitador.
  const guarded = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** CSV do modelo: cabeçalho + 3 linhas de exemplo (um de cada formato). UTF-8 com BOM, CRLF. */
export function buildEditorialTemplateCsv(): string {
  const header = EDITORIAL_SHEET_COLUMNS.map(csvCell).join(",");
  const rows = TEMPLATE_EXAMPLES.map((example) => EDITORIAL_SHEET_COLUMNS.map((column) => csvCell(example[column] ?? "")).join(","));
  return `﻿${[header, ...rows].join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// Parsing do CSV importado
// ---------------------------------------------------------------------------------------------

/** Parser CSV (RFC-4180): aspas com `""`, delimitador `,` ou `;` detectado pelo cabeçalho, CRLF/LF. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  // Delimitador: compara vírgulas x ponto-e-vírgula na primeira linha (fora de aspas).
  let commas = 0, semicolons = 0, inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '"') { if (inQuotes && clean[i + 1] === '"') i += 1; else inQuotes = !inQuotes; }
    else if (!inQuotes) { if (char === "\n" || char === "\r") break; if (char === ",") commas += 1; if (char === ";") semicolons += 1; }
  }
  const delimiter = semicolons > commas ? ";" : ",";

  const records: string[][] = [];
  let cells: string[] = [], cell = "", quoted = false, closed = false, started = false;
  const pushCell = () => { cells.push(cell); cell = ""; closed = false; started = true; };
  const pushRow = () => { pushCell(); if (cells.some((value) => value.trim() !== "") || cells.length > 1) records.push(cells); cells = []; started = false; };
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"') { if (clean[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; closed = true; } }
      else cell += char;
      continue;
    }
    if (char === '"' && !cell && !closed) { quoted = true; started = true; }
    else if (char === delimiter) pushCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && clean[i + 1] === "\n") i += 1; if (started || cells.length) pushRow(); }
    else cell += char;
  }
  if (quoted) throw new EditorialPackError("o arquivo CSV tem aspas que não fecham.");
  if (started || cells.length) pushRow();
  return records;
}

type PackIdea = Record<string, unknown>;

function decodeSlides(value: string): PackIdea[] | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  return raw.split(SLIDE_SEP).map((slide) => {
    const [headline, ...body] = slide.split(FIELD_SEP);
    return { headline: (headline ?? "").trim(), body: body.join(FIELD_SEP).trim() };
  });
}

function decodeScenes(value: string): PackIdea[] | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  return raw.split(SLIDE_SEP).map((scene) => {
    const parts = scene.split(FIELD_SEP);
    return { time: (parts[0] ?? "").trim(), visual: (parts[1] ?? "").trim(), text: parts.slice(2).join(FIELD_SEP).trim() };
  });
}

/**
 * Converte o CSV do modelo num pacote `vorix.editorial-pack/v1` (pronto para `parseEditorialPack`).
 * Cabeçalhos são case-insensitive; colunas desconhecidas são ignoradas; colunas obrigatórias
 * ausentes falham com mensagem clara. A validação de conteúdo fica por conta do `parseEditorialPack`.
 */
export function editorialCsvToPack(csvText: string): { schema: string; ideas: PackIdea[] } {
  const records = parseCsv(csvText);
  if (records.length < 2) throw new EditorialPackError("o arquivo CSV precisa do cabeçalho e de pelo menos uma ideia.");
  const headers = records[0]!.map((header) => header.trim().toLowerCase());
  const indexOf = new Map<string, number>();
  headers.forEach((header, index) => { if (!indexOf.has(header)) indexOf.set(header, index); });
  const missing = REQUIRED_COLUMNS.filter((column) => !indexOf.has(column.toLowerCase()));
  if (missing.length > 0) throw new EditorialPackError(`faltam colunas obrigatórias no cabeçalho: ${missing.join(", ")}.`);

  const dataRows = records.slice(1);
  if (dataRows.length > EDITORIAL_SHEET_MAX_ROWS) throw new EditorialPackError(`no máximo ${EDITORIAL_SHEET_MAX_ROWS} ideias por arquivo CSV.`);

  const cellAt = (row: string[], column: EditorialSheetColumn): string => {
    const index = indexOf.get(column.toLowerCase());
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const ideas = dataRows.map((row) => {
    const idea: PackIdea = {
      id: cellAt(row, "id"),
      title: cellAt(row, "title"),
      category: cellAt(row, "category"),
      commercialObjective: cellAt(row, "commercialObjective"),
      targetAudience: cellAt(row, "targetAudience"),
      concept: cellAt(row, "concept"),
      keyMessage: cellAt(row, "keyMessage"),
      format: cellAt(row, "format"),
      approach: cellAt(row, "approach"),
      visualDirection: cellAt(row, "visualDirection"),
      narrativeStructure: cellAt(row, "narrativeStructure"),
      caption: cellAt(row, "caption"),
      cta: cellAt(row, "cta"),
    };
    const priority = cellAt(row, "priority");
    if (priority) idea.priority = priority.toLowerCase();
    const suggestedDate = cellAt(row, "suggestedDate");
    if (suggestedDate) idea.suggestedDate = suggestedDate;
    const creativePrompt = cellAt(row, "creativePrompt");
    if (creativePrompt) idea.creativePrompt = creativePrompt;
    const carouselScript = decodeSlides(cellAt(row, "carouselScript"));
    if (carouselScript) idea.carouselScript = carouselScript;
    const videoScript = decodeScenes(cellAt(row, "videoScript"));
    if (videoScript) idea.videoScript = videoScript;
    return idea;
  });

  return { schema: EDITORIAL_PACK_SCHEMA, ideas };
}
