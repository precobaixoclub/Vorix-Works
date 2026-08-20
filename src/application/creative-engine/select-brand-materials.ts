import type { CreativePlanAssetRole } from "../../shared/utils/gpt-creative-plan.types.js";

/**
 * Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — seleção
 * determinística e explicável de QUAIS materiais da Asset Library entram no `creative_context`
 * de uma geração específica. Função pura (sem I/O) — quem chama (`build-creative-context.ts`) já
 * resolveu a lista de materiais disponíveis e as URLs reais; aqui só decide relevância.
 *
 * Regra deliberadamente simples (heurística por palavra-chave/tipo), não um sistema de relevância
 * sofisticado — o pedido explícito era "não enviar todos indiscriminadamente" e "seleção deve ser
 * explicável", não "seleção ótima". Cada resultado carrega `reason`, nunca "porque sim".
 */

export type SelectableBrandMaterial = {
  id: string;
  name: string;
  materialType?: string;
  /** Ausente é tratado como "automatic" — nunca como "required"/"on_request" por omissão. */
  usagePriority?: string;
  aiInstructions?: string;
  usageRule?: string;
  /** `undefined` = material cadastrado só como metadado, sem arquivo real ainda — nunca
   * selecionável (não há o que enviar ao motor GPT). */
  url?: string;
};

export type BrandMaterialSelectionRequest = {
  ideaText: string;
  objective: string;
};

export type BrandMaterialSelectionResult = {
  material: SelectableBrandMaterial;
  reason: string;
};

const SITE_KEYWORDS_RE = /\bsite\b|\bsítio\b|\bplataforma\b|\bwebsite\b/i;
const APP_KEYWORDS_RE = /\baplicativo\b|\bapp\b/i;

/**
 * Materiais `required` entram sempre. `on_request` só entra se o nome do material aparecer
 * literalmente no texto do pedido atual. `preferred`/`automatic` (ou ausência de prioridade) são
 * avaliados por um pequeno conjunto de regras de relevância por tipo — logo sempre entra
 * automaticamente; screenshot do site/app entra quando o pedido menciona site/app; produto entra
 * quando o pedido menciona o nome do produto. Qualquer material sem essas correspondências e sem
 * prioridade "preferred" explícita fica de fora — irrelevante para ESTE pedido, não descartado
 * para sempre.
 */
export function selectRelevantBrandMaterials(materials: readonly SelectableBrandMaterial[], request: BrandMaterialSelectionRequest): BrandMaterialSelectionResult[] {
  const requestText = `${request.ideaText} ${request.objective}`;
  const requestTextLower = requestText.toLowerCase();
  const mentionsSite = SITE_KEYWORDS_RE.test(requestText);
  const mentionsApp = APP_KEYWORDS_RE.test(requestText);

  const results: BrandMaterialSelectionResult[] = [];

  for (const material of materials) {
    if (!material.url) continue;
    const priority = material.usagePriority ?? "automatic";
    const nameLower = material.name.trim().toLowerCase();
    const mentionsName = nameLower.length > 0 && requestTextLower.includes(nameLower);

    if (priority === "required") {
      results.push({ material, reason: "Prioridade \"obrigatório\" — sempre incluído, independente do pedido atual." });
      continue;
    }

    if (priority === "on_request") {
      if (mentionsName) results.push({ material, reason: `Prioridade "somente quando solicitado" — o pedido atual menciona "${material.name}".` });
      continue;
    }

    if (material.materialType === "logo_principal" || material.materialType === "logo_secundaria") {
      results.push({ material, reason: "Logo da marca — incluída automaticamente em qualquer geração." });
      continue;
    }

    if (material.materialType === "screenshot_site" && mentionsSite) {
      results.push({ material, reason: "O pedido atual menciona o site e há screenshot real cadastrado com esse papel." });
      continue;
    }

    if (material.materialType === "screenshot_app" && mentionsApp) {
      results.push({ material, reason: "O pedido atual menciona o aplicativo e há screenshot real cadastrado com esse papel." });
      continue;
    }

    if (material.materialType === "produto" && mentionsName) {
      results.push({ material, reason: `O pedido atual menciona o produto "${material.name}".` });
      continue;
    }

    if (priority === "preferred") {
      results.push({ material, reason: "Prioridade \"preferencial\" — incluído por padrão nesta geração." });
      continue;
    }
    // "automatic" sem nenhuma correspondência de relevância acima: fora desta seleção — irrelevante
    // para ESTE pedido específico, não removido da biblioteca.
  }

  return results;
}

const MATERIAL_TYPE_TO_ASSET_ROLE: Record<string, CreativePlanAssetRole> = {
  logo_principal: "logo",
  logo_secundaria: "logo",
  screenshot_site: "screenshot",
  screenshot_app: "screenshot",
  produto: "product_photo",
  referencia_visual: "reference_style",
};

/** Mapeia `AssetMaterialType` para o papel de composição já existente (`CreativePlanAssetRole`) —
 * só para tipos com um papel de composição determinística claro (logo/screenshot/produto/
 * referência de estilo); qualquer outro tipo devolve `undefined` (nunca força um papel de
 * composição sem sentido, ex.: "selo"/"ícone"/"campanha" continuam só como contexto textual em
 * `brandMaterials`, sem entrar na composição determinística). */
export function materialTypeToAssetRole(materialType: string | undefined): CreativePlanAssetRole | undefined {
  if (!materialType) return undefined;
  return MATERIAL_TYPE_TO_ASSET_ROLE[materialType];
}
