// Preparação da PRIMEIRA CAMPANHA DE VÍDEO do Preço Baixo Club (prova controlada, somente aprovação).
// Roda no container da API (mesmo dist), uma vez e idempotente:
//   1. capturas REAIS do site público (celular) → armazenamento do workspace + materiais da marca (screenshot_site);
//   2. pauta de vídeo de TESTE no Bolsão pelo import oficial (parseManualEditorialIdea + importMany), com as
//      capturas anexadas e os únicos fatos permitidos (os do próprio site).
// Não publica, não agenda, não chama IA. Uso: node pbc-campaign-setup.mjs <pasta-com-pbc-tela-1..3.png>
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import pg from "pg";
import { buildApiContainer } from "/app/dist/interfaces/api/di/container.js";
import { loadApiConfig } from "/app/dist/interfaces/api/config/api-config.js";
import { parseManualEditorialIdea } from "/app/dist/domain/editorial/editorial-idea.model.js";

const TENANT = "tenant-vorix";
const WORKSPACE = "workspace-mwmu8kgf-uhe66l";
const EXTERNAL_ID = "PBC-TESTE-VIDEO-001";
const dir = process.argv[2];
if (!dir) throw new Error("Uso: node pbc-campaign-setup.mjs <pasta>");

const config = loadApiConfig();
const c = buildApiContainer(config);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const existing = (await c.editorialIdeaRepository.listByWorkspace(WORKSPACE)).find((idea) => idea.externalId === EXTERNAL_ID);
  if (existing) {
    console.log(JSON.stringify({ idea: { id: existing.id, externalId: existing.externalId, status: existing.status, format: existing.format, referenceImages: existing.referenceImages.length }, reused: true }));
  } else {
    const { rows: [library] } = await db.query("select id from asset_libraries where workspace_id=$1", [WORKSPACE]);
    if (!library) throw new Error("biblioteca de materiais do PBC não encontrada");
    const urls = [];
    const assets = [];
    const labels = ["topo do site: proposta, busca, filtros e categorias", "ofertas das lojas com o selo da loja", "vitrine por categoria (Video games)"];
    for (const [index, label] of labels.entries()) {
      const png = await readFile(join(dir, `pbc-tela-${index + 1}.png`));
      const jpeg = await sharp(png).resize({ width: 1080, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      const key = `assets/${TENANT}/${WORKSPACE}/site-pbc-${index + 1}-${createHash("sha256").update(jpeg).digest("hex").slice(0, 16)}.jpg`;
      const { url } = await c.objectStorage.put({ key, body: jpeg, contentType: "image/jpeg" });
      urls.push(url);
      const id = `asset-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
      await db.query(`insert into assets (id, library_id, kind, name, status, created_at, updated_at, tags, storage_ref, material_type, ai_instructions, usage_rule, usage_priority)
        values ($1,$2,'mockup',$3,'active',now(),now(),$4,$5,'screenshot_site',$6,$7,null)`,
        [id, library.id, `Site PBC (celular) — ${label}`, ["site", "captura real", "celular"],
          JSON.stringify({ provider: "object_storage", objectKey: key, metadata: { url, contentType: "image/jpeg" } }),
          "Captura real do site precobaixoclub.com.br no celular (28/11/2026). Use para demonstrar o benefício real: busca, filtros, categorias, ofertas das lojas e o histórico de preço.",
          "Não destacar valores, percentuais nem a faixa de campanha (Cyber Monday) — são da data da captura. Não redesenhar a interface."]);
      assets.push({ id, key, label });
    }
    const content = parseManualEditorialIdea({
      title: "Você ainda pesquisa loja por loja?",
      format: "video", priority: "normal", category: "Compra inteligente", approach: "Problema e solução",
      commercialObjective: "Mostrar o benefício real do site: comparar ofertas das principais lojas num lugar só, sem cadastro.",
      targetAudience: "Quem compra online e abre várias lojas para achar o menor preço.",
      concept: "Você ainda pesquisa loja por loja? Compare ofertas em um só lugar.",
      keyMessage: "As ofertas das principais lojas num lugar só",
      visualDirection: "Identidade do Preço Baixo Club: fundo azul-marinho escuro, verde neon e verde-limão no destaque, títulos fortes em caixa alta com a palavra-chave em verde. Demonstrar com as capturas reais do site no celular (busca, filtros, categorias, lojas).",
      narrativeStructure: "Dor (abrir loja por loja) → o site junta ofertas reais das principais lojas → demonstração na tela real → chamada.",
      caption: "Você ainda abre loja por loja pra achar o menor preço? No Preço Baixo Club as ofertas das principais lojas ficam num lugar só, atualizadas o dia todo. Link na bio.",
      cta: "Compare antes de comprar",
      creativePrompt: "PAUTA DE TESTE CONTROLADO: campanha de prova, só para aprovação no WhatsApp — não publicar. Fatos permitidos (do próprio site): ofertas reais das principais lojas, garimpadas e atualizadas o dia todo; filtrar por categoria; ver o histórico e saber se o preço está bom de verdade; comprar direto na loja; acesso gratuito, sem cadastro. Nunca inventar preços, descontos, cupons ou funcionalidades. Não destacar valores nem a faixa de campanha (Cyber Monday) das capturas. Lojas citáveis: Mercado Livre, Shopee, AliExpress e KaBuM!. Sem URL na legenda.",
      referenceImages: urls,
    }, EXTERNAL_ID);
    const result = await c.editorialIdeaRepository.importMany({ tenantId: TENANT, workspaceId: WORKSPACE, ideas: [content] });
    const idea = (await c.editorialIdeaRepository.listByWorkspace(WORKSPACE)).find((item) => item.externalId === EXTERNAL_ID);
    console.log(JSON.stringify({ import: result, idea: idea && { id: idea.id, externalId: idea.externalId, status: idea.status, format: idea.format, referenceImages: idea.referenceImages.length, createdAt: idea.createdAt }, assets }));
  }
} finally {
  await db.end();
  await c.identity?.pool?.end().catch(() => undefined);
}
process.exit(0);
