import { createHash } from "node:crypto";
import type { IcaroBrainPort } from "../ai/icaro-brain.contract.js";
import type { IcaroAIResponse } from "../ai/icaro.types.js";
import type { ScreenshotTextInventoryStorePort } from "../ports/screenshot-text-inventory-store.port.js";
import { extractJson } from "../../shared/utils/skill-parsing.js";
import { normalizeRenderedText } from "./evaluate-creative-quality-gate.js";

/**
 * SCREENSHOT_TEXT_INVENTORY — quais textos existem legitimamente DENTRO de um screenshot real.
 *
 * Pertence ao ASSET (lido do próprio screenshot, antes da composição), nunca à visão final da peça.
 * Achado do P2 real (execution-mv2s493a-h8frmz): a visão final reconheceu corretamente strings do
 * site real ("Criar meu site" da barra superior, o aviso de demonstração), mas devolveu bboxes
 * 10–40 pt fora da região do screenshot — a posição era o erro, não o texto.
 *
 * Só serve para PROVENIÊNCIA / AUTORIZAÇÃO / RECONCILIAÇÃO DE DUPLICIDADE no gate. Nunca é fonte de
 * fato comercial: preço, desconto, headline, CTA ou claim lidos no screenshot nunca entram em
 * `confirmedFacts` nem no plano (só fontes comerciais autorizadas geram fatos — 839fab5).
 *
 * Não é whitelist: cada texto tem orçamento de ocorrências (`occurrenceCount`), e o gate só o usa
 * com o screenshot composto, visível e fiel em pixel, do mesmo tenant/workspace.
 */
export const SCREENSHOT_TEXT_INVENTORY_VERSION = 1;

export type ScreenshotTextInventoryEntry = { text: string; normalizedText: string; occurrenceCount: number };

export type ScreenshotTextInventory = {
  source: "VERIFIED_SCREENSHOT";
  inventorySource: "VISION_ASSET_SCAN";
  status: "AVAILABLE" | "NOT_AVAILABLE";
  tenantId: string;
  workspaceId: string;
  /** URL do asset nesta execução (o cache é pelos bytes; a URL é só informativa). */
  assetUrl: string;
  assetSha256: string;
  version: number;
  provider?: string;
  model?: string;
  scannedAt: string;
  texts: ScreenshotTextInventoryEntry[];
  reason?: string;
  /** HIT = reaproveitado do cache (mesmo hash, mesmo workspace); MISS = lido agora. */
  cache?: "HIT" | "MISS";
};

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildScreenshotTextInventoryPrompt(): string {
  return [
    "Você recebe UMA captura de tela REAL de uma interface (site ou aplicativo). Ela não foi gerada por IA.",
    "Transcreva TODO texto legível dela, exatamente como aparece (mesma grafia e acentos; não traduza, não resuma, não corrija): títulos, menus, botões, rótulos, avisos, preços, parágrafos, nomes.",
    "Um item por bloco visual de texto (uma linha de menu, um botão, um título, um preço, um parágrafo — as linhas quebradas de um MESMO parágrafo vão juntas num item só).",
    "Se o mesmo texto aparece em vários lugares (ex.: o mesmo botão em cada card), repita o item uma vez para CADA ocorrência visível.",
    "Não invente: textura ou forma que só lembra letras não conta; texto dentro de fotos só se for legível.",
    'Responda somente JSON: {"texts": ["...", "..."]}. Lista vazia se não houver texto legível.',
  ].join("\n");
}

/** Agrupa as ocorrências lidas por texto normalizado (a contagem é o orçamento de ocorrência). */
export function aggregateScreenshotTexts(rawTexts: readonly string[]): ScreenshotTextInventoryEntry[] {
  const byText = new Map<string, ScreenshotTextInventoryEntry>();
  for (const raw of rawTexts) {
    const text = raw.replace(/\s+/g, " ").trim();
    const normalizedText = normalizeRenderedText(text);
    if (!normalizedText) continue;
    const existing = byText.get(normalizedText);
    if (existing) existing.occurrenceCount += 1;
    else byText.set(normalizedText, { text, normalizedText, occurrenceCount: 1 });
  }
  return [...byText.values()];
}

/** Uma leitura de visão SÓ sobre o screenshot (nunca sobre a peça). Falha vira NOT_AVAILABLE — o
 * gate então não usa inventário (mantém só a regra espacial da região verificada). */
export async function scanScreenshotTextInventory(
  icaro: IcaroBrainPort,
  input: { tenantId: string; workspaceId: string; assetUrl: string; assetSha256: string; specialistId: string; scannedAt: string; onCost?: (response: IcaroAIResponse | undefined) => void },
): Promise<ScreenshotTextInventory> {
  const base = {
    source: "VERIFIED_SCREENSHOT" as const,
    inventorySource: "VISION_ASSET_SCAN" as const,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    assetUrl: input.assetUrl,
    assetSha256: input.assetSha256,
    version: SCREENSHOT_TEXT_INVENTORY_VERSION,
    scannedAt: input.scannedAt,
  };
  try {
    const response = await icaro.request({
      taskType: "review",
      prompt: buildScreenshotTextInventoryPrompt(),
      specialistId: input.specialistId,
      imageUrls: [input.assetUrl],
      expectedOutput: "json",
      priority: "quality",
      temperature: 0,
      maxTokens: 3000,
      timeoutMs: 40_000,
    });
    input.onCost?.(response);
    const providerInfo = { ...(response?.provider?.id ? { provider: response.provider.id } : {}), ...(response?.model?.id ? { model: response.model.id } : {}) };
    if (response.status !== "completed") return { ...base, ...providerInfo, status: "NOT_AVAILABLE", texts: [], reason: `visão não concluiu (${response.status})` };
    const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Screenshot text inventory")) as { texts?: unknown };
    if (!Array.isArray(parsed.texts)) return { ...base, ...providerInfo, status: "NOT_AVAILABLE", texts: [], reason: "resposta sem lista de textos" };
    const rawTexts = parsed.texts.flatMap((item) => {
      const text = typeof item === "string" ? item : typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
      return text.trim() ? [text] : [];
    });
    const texts = aggregateScreenshotTexts(rawTexts);
    // Lista vazia de um screenshot com interface é leitura falha, não "sem texto": não autoriza nada.
    if (texts.length === 0) return { ...base, ...providerInfo, status: "NOT_AVAILABLE", texts: [], reason: "nenhum texto lido no screenshot" };
    return { ...base, ...providerInfo, status: "AVAILABLE", texts };
  } catch (error) {
    return { ...base, status: "NOT_AVAILABLE", texts: [], reason: error instanceof Error ? error.message : "erro desconhecido" };
  }
}

/**
 * Inventário do screenshot desta execução: reaproveita o cache quando o MESMO arquivo (hash) já foi
 * lido no MESMO tenant/workspace; senão lê agora e grava (só se AVAILABLE). Erro no cache nunca
 * derruba a peça — vira leitura direta.
 */
export async function resolveScreenshotTextInventory(
  deps: { icaro: IcaroBrainPort; store?: ScreenshotTextInventoryStorePort; now?: () => Date },
  input: { tenantId: string; workspaceId: string; assetUrl: string; buffer: Buffer; specialistId: string; onCost?: (response: IcaroAIResponse | undefined) => void },
): Promise<ScreenshotTextInventory> {
  const assetSha256 = sha256Hex(input.buffer);
  const key = { tenantId: input.tenantId, workspaceId: input.workspaceId, assetSha256, version: SCREENSHOT_TEXT_INVENTORY_VERSION };
  const cached = await deps.store?.get(key).catch(() => undefined);
  if (cached && cached.status === "AVAILABLE" && cached.tenantId === input.tenantId && cached.workspaceId === input.workspaceId && cached.assetSha256 === assetSha256) {
    return { ...cached, assetUrl: input.assetUrl, cache: "HIT" };
  }
  const scanned = await scanScreenshotTextInventory(deps.icaro, { ...key, assetUrl: input.assetUrl, specialistId: input.specialistId, scannedAt: (deps.now?.() ?? new Date()).toISOString(), onCost: input.onCost });
  if (scanned.status === "AVAILABLE") await deps.store?.save(scanned).catch(() => undefined);
  return { ...scanned, cache: "MISS" };
}

/** Distância de edição (Levenshtein) — tolera diferença de leitura de 1–2 caracteres. */
function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]!;
      previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

const FUZZY_MIN_CHARS = 8;
const FUZZY_MIN_SIMILARITY = 0.9;

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < FUZZY_MIN_CHARS) return false;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length) >= FUZZY_MIN_SIMILARITY;
}

/** Quantas vezes a sequência de palavras `detected` aparece dentro de `entry` (palavras inteiras;
 * com 2+ palavras, a primeira pode ser fim de palavra e a última começo — corte de crop). */
function countWordWindows(detected: string[], entry: string[]): number {
  if (detected.length === 0 || detected.length > entry.length) return 0;
  let count = 0;
  for (let start = 0; start + detected.length <= entry.length; start += 1) {
    const window = entry.slice(start, start + detected.length);
    const ok = detected.every((word, index) => {
      const candidate = window[index]!;
      if (word === candidate) return true;
      if (detected.length < 2) return false;
      if (index === 0 && word.length >= 2 && candidate.endsWith(word)) return true;
      if (index === detected.length - 1 && word.length >= 2 && candidate.startsWith(word)) return true;
      return false;
    });
    if (ok) count += 1;
  }
  if (count === 0 && similar(detected.join(" "), entry.join(" "))) return 1;
  if (count === 0 && detected.length < entry.length) {
    const joined = detected.join(" ");
    for (let start = 0; start + detected.length <= entry.length; start += 1) {
      if (similar(joined, entry.slice(start, start + detected.length).join(" "))) count += 1;
    }
  }
  return count;
}

export type ScreenshotInventoryMatch = {
  /** Orçamento de ocorrências legítimas desse texto dentro do screenshot. */
  budget: number;
  matchedEntries: string[];
};

/** O texto lido pela visão existe no screenshot? Devolve o orçamento de ocorrências (nunca
 * ilimitado). Texto curto demais (menos de 2 caracteres úteis) nunca casa. */
export function matchScreenshotInventoryText(normalizedDetected: string, inventory: Pick<ScreenshotTextInventory, "texts">): ScreenshotInventoryMatch | undefined {
  const detected = normalizedDetected.split(" ").filter(Boolean);
  if (detected.join("").length < 2) return undefined;
  let budget = 0;
  const matchedEntries: string[] = [];
  for (const entry of inventory.texts) {
    const windows = countWordWindows(detected, entry.normalizedText.split(" ").filter(Boolean));
    if (windows > 0) {
      budget += windows * entry.occurrenceCount;
      matchedEntries.push(entry.normalizedText);
    }
  }
  return budget > 0 ? { budget, matchedEntries } : undefined;
}
