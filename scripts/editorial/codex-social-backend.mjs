import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildApiContainer } from "./dist/interfaces/api/di/container.js";
import { loadApiConfig } from "./dist/interfaces/api/config/api-config.js";
import { resolveEffectiveEntitlements } from "./dist/application/billing/entitlement-use-cases.js";
import { parseManualEditorialIdea } from "./dist/domain/editorial/editorial-idea.model.js";
import { hasPermission } from "./dist/domain/identity/identity.model.js";
import { classifyObjectKeyOwner, parseOwnedObjectUrl, signForExternalPublication } from "./dist/shared/utils/object-url-signing.js";
import { PRODUCT_THEME_DEMANDS, planEditorialCreative, rankProductsForIdea, rotationOrder, screensForIdea } from "./dist/application/creative-engine/plan-editorial-creative.js";
import { COMPOSITION_ARCHETYPES } from "./dist/application/creative-engine/creative-spec.js";
import { redactSecrets } from "./dist/application/creative-engine/creative-trace.js";
import { rankIdeasForSlot } from "./dist/application/creative-engine/editorial-calendar.js";
import { matchesRejectedPiece, redoScopeViolations, resolveRedoScope, scopedText } from "./dist/application/creative-engine/redo-scope.js";
import { applyProductMemory, buildCreativeMemory, feedbackEventsFromRows, memoryGuidance } from "./dist/application/creative-engine/creative-memory.js";
import { verifyApprovedArt } from "./dist/application/creative-engine/publication-guard.js";
import { catalogPhotoSignals } from "./dist/infrastructure/media/creative/catalog-photo-signals.js";
import { dHash, sha256Prefix, siteCaptureScore } from "./dist/infrastructure/media/creative/image-analysis.js";

// Loaded on stdin from the host, in the Vorix API container. The renderer has no DB access.
const tenantId = "tenant-vorix";
const cmkvWorkspaceId = "workspace-cee-prelaunch-mv47cmfh";
// Estampas da CMKV — conferidas uma a uma nas fotos do catálogo em 26/11/2026 (o catálogo só diz "Camisa").
// Do que cada estampa fala: o planejador escolhe a peça que combina com o assunto da pauta. Temas de
// ocasião (fitness, praia, western, natal…) fazem a peça sair só em pauta daquela ocasião.
const cmkvProductThemes = {
  "000028": ["western", "country", "rodeio*", "fazenda", "rancho", "ranch", "boi", "longhorn"],
  "000032": ["girassol", "girassois", "mudanca", "mudar", "inspira*", "proposito", "change", "flor*"],
  "000033": ["flor*", "floral", "natureza", "primavera", "supera*", "resilien*", "recomec*", "delicad*"],
  "000034": ["fe", "deus", "god", "lua", "luas", "gratidao", "espiritual*", "abencoad*"],
  "000035": ["coracao", "coracoes", "amor", "amar", "carinho", "afeto", "romantic*", "minimalis*"],
  "000036": ["amor", "amar", "coracao", "romantic*", "carinho", "namorad*", "apaixonad*"],
  "000037": ["fe", "deus", "gratidao", "grata", "espiritual*", "oracao", "abencoad*", "bencao"],
  "000038": ["deus", "fe", "gratidao", "espiritual*", "abencoad*", "testemunho"],
  "000039": ["borboleta*", "leveza", "liberdade", "transforma*", "delicad*"],
  "000040": ["praia", "pe na areia", "verao", "drink*", "coco", "chope", "ferias", "litoral"],
  "000041": ["panda*", "fofo*", "fofura", "divertid*", "amizade", "amigos", "amigas", "turma", "bichinho*"],
  "000042": ["paris", "viage*", "viajar", "torre eiffel", "franca", "sonho*", "turismo"],
  "000043": ["limao", "limoes", "limonada", "verao", "refrescan*", "fruta*", "piquenique", "alegria", "divertid*"],
  "000044": ["amor", "love", "romantic*", "namorad*", "casal", "coracao", "coracoes"],
  "000045": ["fitness", "treino*", "academia", "malha*", "capivara", "motiva*", "foco", "disciplina", "supera*", "humor", "engracad*"],
  "000046": ["natal", "natalin*", "papai noel", "fim de ano", "humor", "trocadilho"],
  "000047": ["amor", "love", "coracao", "coracoes", "onca", "animal print", "atitude", "ousad*"],
  "000048": ["borboleta*", "autoestima", "seja voce", "be yourself", "autentic*", "essencia", "transforma*", "rosa"],
  "000049": ["borboleta*", "transforma*", "transforme", "mudanca", "recomec*", "renova*", "rosa"],
  "000050": ["coracao", "coracoes", "amor", "carinho", "afeto"],
  "000057": ["pet", "pets", "cachorro*", "cao", "caes", "gato*", "pata", "patinha*", "bicho*", "adocao"],
};
// Liberadas para as pautas automáticas: todas as estampas próprias acima.
const cmkvEditorialProducts = Object.keys(cmkvProductThemes);
// Logo de outra marca (Levi's, Adidas, Nike, Hugo Boss, Calvin Klein, Lacoste, Puma…): ficam no site, mas
// NUNCA aparecem em post — nem no rodízio, nem anexadas à pauta (risco de denúncia de marca e queda do post).
const cmkvThirdPartyBrandProducts = ["000001", "000002", "000003", "000004", "000005", "000006", "000007", "000010", "000011", "000012", "000013", "000014", "000015", "000016", "000017", "000018", "000019", "000020", "000021", "000022", "000023", "000024", "000025", "000026", "000027", "000029", "000030", "000031", "000051", "000052", "000053", "000054", "000055", "000056"];
// Funcionalidades da Vorix que as peças podem demonstrar (a captura real vem da Biblioteca da marca).
const VORIX_FEATURES = [
  { key: "atendimento_whatsapp", label: "Atendimento pelo WhatsApp", keywords: ["whatsapp", "atendimento", "mensagens", "responder", "caixa de entrada"] },
  { key: "continuidade_atendimento", label: "Histórico e continuidade do atendimento", keywords: ["historico", "continuidade", "transferencia", "repasse", "muda de pessoa", "proximo atendente", "contexto"] },
  { key: "conteudo_ia", label: "Produção de conteúdo com IA", keywords: ["conteudo", "conteudos", "posts", "redes sociais", "calendario", "pautas", "marketing"] },
  { key: "reunioes_analise", label: "Gravação e análise de reuniões", keywords: ["reuniao", "reunioes", "gravacao", "gravador", "transcricao", "resumo", "decisoes", "ata"] },
  { key: "editor_site", label: "Editor de site e loja da Vorix", keywords: ["pagina", "site", "landing page", "editor do site", "pagina publicada", "navegacao", "clique"] },
];
// Por workspace: contas IG+FB e, opcionalmente, como aplicar a logo nesta marca.
// creative.businessKind decide o modo das pautas (produto físico / software / conceitual); creative.products
// são os produtos do catálogo liberados para pautas automáticas (rodízio); creative.features, o que o
// software demonstra. Marcas sem catálogo nem software seguem conceituais, como antes.
// logo.placement: top_left|top_center|top_right|bottom_left|bottom_center|bottom_right (fixa a posição);
// logo.treatment: auto|none|shadow|halo|plate (auto = sem caixa, sombra suave só se faltar contraste);
// logo.scale: 0.6–1.6. Sem configuração, vale o que as notas do Perfil da Marca dizem, senão o automático.
const brands = new Map([
  // Rumo ao Altar (casamento): sem a linguagem "3D tecnológico" — foge do clima romântico da marca.
  ["workspace-mwmumsxd-fmvh3h", { accounts: ["soc-mwmvbruu-sz6rkd12", "soc-mwmvbryk-dthxstki"], logo: {}, creative: { businessKind: "services", avoidArchetypes: ["concept_3d"] } }],
  ["workspace-mscc9pi2-jkvwbo", { accounts: ["soc-mwk1mgoy-xhcr2duq", "soc-mwk1my6f-lbham9eo"], logo: { preserveWordmarkContrast: true }, creative: { businessKind: "software", features: VORIX_FEATURES } }],
  ["workspace-mwmu8kgf-uhe66l", { accounts: ["soc-mwmu9f8k-kj2covm2", "soc-mwmugp3j-hwva5nax"], logo: {}, creative: { businessKind: "unknown" } }],
  [cmkvWorkspaceId, { accounts: ["soc-mwkwg3lc-zj3g4xyk", "soc-mwmuj7ud-3py2gdyo"], logo: {}, creative: { businessKind: "physical_products", products: cmkvEditorialProducts, productThemes: cmkvProductThemes, blockedProducts: cmkvThirdPartyBrandProducts, presentation: "fashion_campaign" } }],
]);
const timezone = "America/Sao_Paulo";
const prefix = "codex-editorial-v1";
const c = buildApiContainer(loadApiConfig());
const db = c.pool;
const mode = request.action;
const workspaceId = request.workspaceId;
const scope = { tenantId, workspaceId };

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function actorForPublish() {
  const { rows } = await db.query(`select u.id, m.role from users u join tenant_members m on m.user_id=u.id
    where m.tenant_id=$1 and m.role='owner' and u.status='active'`, [tenantId]);
  requireCondition(rows.length === 1 && hasPermission(rows[0].role, "marketing:social_publish"), "Responsável pelo Vorix indisponível para publicação");
  const entitlement = await resolveEffectiveEntitlements(c.identity, tenantId);
  requireCondition(!entitlement.readOnly && await c.solutionAccess.hasAccess(tenantId, "marketing"), "Marketing indisponível para publicação");
  return { userId: rows[0].id, role: rows[0].role };
}

async function ownedImage(url) {
  const key = parseOwnedObjectUrl(url)?.key;
  const owner = key && classifyObjectKeyOwner(key);
  requireCondition(owner?.kind === "workspace" && owner.tenantId === tenantId && owner.workspaceId === workspaceId,
    "A imagem de referência ou a logo precisa pertencer ao workspace");
  const response = await fetch(signForExternalPublication(url), { signal: AbortSignal.timeout(20000) });
  requireCondition(response.ok, `Imagem do workspace indisponível (${response.status})`);
  return sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
}

async function logoFile(url) {
  // PNG preserva a transparência original; o renderizador decide tamanho e tratamento.
  return ownedImage(url);
}

async function brandFor(workspace, config, profile) {
  const identity = profile?.identity;
  // Todas as versões oficiais (com os fundos para os quais servem): o renderizador escolhe a compatível.
  const logos = [];
  for (const logo of [...(identity?.logos ?? [])].sort((a, b) => a.priority - b.priority)) {
    const asset = await db.query(`select a.storage_ref->>'objectKey' as key from assets a join asset_libraries l on l.id=a.library_id
      where a.id=$1 and l.workspace_id=$2 and a.status='active'`, [logo.assetId, workspaceId]);
    const key = asset.rows[0]?.key;
    if (!key) continue;
    logos.push({ data: (await logoFile(c.objectStorage.resolvePublicUrl(key))).toString("base64"), variant: logo.variant, backgrounds: logo.backgrounds ?? [] });
  }
  if (!logos.length && workspace.settings?.logoUrl) {
    // Último recurso: avatar do workspace (costuma ter fundo sólido; o renderizador remove o fundo).
    logos.push({ data: (await logoFile(workspace.settings.logoUrl)).toString("base64"), variant: "AVATAR", backgrounds: [] });
  }
  requireCondition(logos.length, "Workspace sem logo oficial configurada no Perfil da Marca");
  return { profile, name: workspace.name, logos, logoConfig: config?.logo ?? {} };
}

/**
 * Peças desta marca já publicadas ou agendadas perto do horário (14 dias para trás e tudo o que está à frente),
 * de qualquer origem — piloto ou publicação manual. Base do calendário inteligente.
 */
async function nearbyPieces(allIdeas) {
  const byId = new Map(allIdeas.map(idea => [idea.id, idea]));
  const { rows } = await db.query(`select source_artifacts->0->'payload'->>'editorialIdeaId' as idea_id,
      case when jsonb_typeof(source_artifacts->0->'payload'->'imageUrls')='array' then jsonb_array_length(source_artifacts->0->'payload'->'imageUrls') else 0 end as images,
      coalesce(published_at, scheduled_at, created_at) as at
    from publication_plans where tenant_id=$1 and workspace_id=$2 and state not in ('cancelled','failed','superseded')
      and coalesce(published_at, scheduled_at, created_at) > now() - interval '14 days'
    order by at desc limit 30`, [tenantId, workspaceId]);
  return rows.map(row => {
    const idea = row.idea_id ? byId.get(row.idea_id) : undefined;
    return { ...(idea ? { ideaId: idea.id, title: idea.title, category: idea.category, approach: idea.approach, text: idea.keyMessage } : {}),
      format: idea?.format ?? (Number(row.images) > 1 ? "carousel" : "single_image"), at: new Date(row.at).toISOString() };
  });
}

async function cmkvCatalogPhotos() {
  const { rows } = await db.query(`select distinct p.code, v.option_values->>'color' as color, v.image_url as url
    from products p join product_variants v on v.product_id=p.id and v.workspace_id=p.workspace_id and v.tenant_id=p.tenant_id
    where p.tenant_id=$1 and p.workspace_id=$2 and p.active and v.active and v.image_url is not null
      and p.details->>'siteVisible'='true' and p.details->>'catalogVisible'='true' and p.details->>'type'='APPAREL'
      and coalesce(v.option_values->>'color','') <> ''
    order by p.code, color, url`, [tenantId, workspaceId]);
  return rows;
}

function cmkvIdeaPhotos(idea, photosByUrl) {
  const photos = (idea.referenceImages ?? []).map(url => photosByUrl.get(url));
  const fits = idea.format === "carousel" ? photos.length >= 2 : photos.length >= 1 && photos.length <= 3;
  return fits && photos.every(Boolean) ? photos : undefined;
}

function cmkvFallbackIdea(slot, products, previous) {
  const order = rotationOrder([...products.keys()], previous);
  const product = order.map(code => [code, products.get(code)]).find(([, photos]) => photos.length >= 2);
  requireCondition(product, "Catálogo da CMKV sem duas fotos de cores distintas dos modelos editoriais");
  const [code, photos] = product;
  const uses = previous.filter(item => item.codes?.includes(code)).length;
  const pair = [photos[uses % photos.length], photos[(uses + 1) % photos.length]];
  const colors = pair.map(photo => photo.color.toLocaleLowerCase("pt-BR"));
  const themes = [
    ["A cor muda tudo", "Já reparou como a mesma estampa muda de clima quando troca o fundo?", "Qual das duas você pegaria primeiro?"],
    ["Qual vai com seu jeans?", "Pensa naquele jeans que você usa sem pensar. Agora imagina o desenho nas duas cores.", "Qual entraria no seu rodízio?"],
    ["Mesma estampa. Outro clima.", "Tem cor que faz o traço aparecer de cara. Tem cor que deixa o detalhe pra quem chega perto.", "Qual dessas é mais a sua cara?"],
  ];
  const [title, hook, question] = themes[uses % themes.length];
  return parseManualEditorialIdea({
    title, format: "single_image", category: "Vitrine CMKV", approach: "Comparação de cores",
    keyMessage: title,
    visualDirection: "Campanha de moda com as duas fotos reais do mesmo modelo, em luz de recorte. Proporções diferentes, tecido em destaque e uma manchete curta. Dourado discreto nos reflexos, sem rótulos de vitrine.",
    caption: `${hook}\n\n${colors.join(" ou ")}? ${question} As fotos são do modelo ${code}.`,
    cta: question, suggestedDate: slot.slice(0, 10),
    referenceImages: pair.map(photo => photo.url),
  }, `CMKV-AUTO-${slot.slice(0, 10)}-${slot.slice(11, 13)}`);
}

async function selectCmkvIdea({ slot, ideas, candidates, used, allowCreate }) {
  const photos = await cmkvCatalogPhotos();
  const photosByUrl = new Map(photos.map(photo => [photo.url, photo]));
  const fallbackId = `CMKV-AUTO-${slot.slice(0, 10)}-${slot.slice(11, 13)}`;
  const current = ideas.find(idea => idea.externalId === fallbackId);
  for (const idea of candidates) {
    if (idea.externalId.startsWith("CMKV-AUTO-") && idea.externalId !== fallbackId) continue;
    const catalogPhotos = cmkvIdeaPhotos(idea, photosByUrl);
    if (catalogPhotos) return { idea, catalogPhotos };
  }
  if (!allowCreate) return {};
  requireCondition(!current, "A pauta automática deste horário não tem fotos oficiais válidas");
  // Pauta automática de vitrine (comparação de cores): só estampas de uso geral — nunca peça de ocasião (Natal, academia…).
  const occasions = new Set(PRODUCT_THEME_DEMANDS.map(demand => demand.theme));
  const products = new Map(cmkvEditorialProducts.filter(code => !cmkvProductThemes[code].some(theme => occasions.has(theme))).map(code => [code, []]));
  for (const photo of photos) {
    const group = products.get(photo.code);
    if (group && !group.some(entry => entry.color === photo.color || entry.url === photo.url)) group.push(photo);
  }
  const fallback = cmkvFallbackIdea(slot, products, used);
  await c.editorialIdeaRepository.importMany({ tenantId, workspaceId, ideas: [fallback] });
  const { rows } = await db.query("select id from editorial_ideas where tenant_id=$1 and workspace_id=$2 and external_id=$3",
    [tenantId, workspaceId, fallback.externalId]);
  const idea = rows[0] && await c.editorialIdeaRepository.get(workspaceId, rows[0].id);
  const catalogPhotos = idea?.status === "available" && cmkvIdeaPhotos(idea, photosByUrl);
  requireCondition(catalogPhotos, "Não foi possível recuperar a pauta automática da CMKV");
  return { idea, catalogPhotos };
}

// ---------------------------------------------------------------- memória criativa da marca

/**
 * Aprovações e reprovações (com motivo) desta marca pelo WhatsApp, com as linguagens e produtos de cada peça.
 * Só leitura e só deste workspace: a memória de uma marca nunca vê as decisões de outra.
 */
async function brandMemory() {
  const { rows } = await db.query(`select q.workspace_id, q.publication_id, q.decision, q.reason, q.decided_at,
      jsonb_build_object('editorialIdeaId', p.source_artifacts->0->'payload'->'editorialIdeaId', 'imageUrls', p.source_artifacts->0->'payload'->'imageUrls',
        'catalogProductCodes', p.source_artifacts->0->'payload'->'catalogProductCodes',
        'creative', jsonb_build_object('archetypes', p.source_artifacts->0->'payload'->'creative'->'archetypes')) as payload
    from publication_approval_requests q join publication_plans p on p.id=q.publication_id and p.tenant_id=q.tenant_id and p.workspace_id=q.workspace_id
    where q.tenant_id=$1 and q.workspace_id=$2 and q.decision is not null and q.decided_at > now() - interval '60 days'
    order by q.decided_at desc limit 120`, [tenantId, workspaceId]);
  return buildCreativeMemory(feedbackEventsFromRows(rows), { workspaceId });
}

const memorySummary = memory => ({
  lessons: memory.lessons.map(lesson => ({ category: lesson.category, occurrences: lesson.occurrences, examples: lesson.examples })),
  observedOnce: memory.observed.map(item => item.category), archetypeBias: memory.archetypeBias, avoidProducts: memory.avoidProducts, sample: memory.sample,
});

// ---------------------------------------------------------------- motor criativo: plano da pauta

const ARCHETYPES = Object.fromEntries(COMPOSITION_ARCHETYPES.map(item => [item.id, { operation: item.operation, mode: item.mode }]));

async function ownedBytes(url) {
  const key = parseOwnedObjectUrl(url)?.key;
  const owner = key && classifyObjectKeyOwner(key);
  requireCondition(owner?.kind === "workspace" && owner.tenantId === tenantId && owner.workspaceId === workspaceId, "A referência precisa pertencer ao workspace");
  const response = await fetch(signForExternalPublication(url), { signal: AbortSignal.timeout(20000) });
  requireCondition(response.ok, `Imagem do workspace indisponível (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/** Fotos do catálogo físico do workspace (produto ativo, visível, com cor e foto). */
async function catalogPhotos() {
  const { rows } = await db.query(`select distinct p.code, v.option_values->>'color' as color, v.image_url as url
    from products p join product_variants v on v.product_id=p.id and v.workspace_id=p.workspace_id and v.tenant_id=p.tenant_id
    where p.tenant_id=$1 and p.workspace_id=$2 and p.active and v.active and v.image_url is not null
      and p.details->>'siteVisible'='true' and p.details->>'catalogVisible'='true'
      and coalesce(v.option_values->>'color','') <> ''
    order by p.code, color, url`, [tenantId, workspaceId]);
  return rows;
}

const variantName = color => String(color ?? "").replace(/\s*-\s*Logo.*$/i, "").trim();

/** Capturas reais do software na Biblioteca da marca. Etiquetas: feature:, form:, dpr:, focus:x,y,w,h. */
async function libraryCaptures() {
  const { rows } = await db.query(`select a.id, a.name, a.tags, a.material_type, a.ai_instructions, a.storage_ref->>'objectKey' as key
    from assets a join asset_libraries l on l.id=a.library_id
    where l.workspace_id=$1 and a.status='active' and a.material_type in ('screenshot_app','screenshot_site')`, [workspaceId]);
  return rows.filter(row => row.key).map(row => {
    const tag = prefix => row.tags.find(item => item.startsWith(prefix))?.slice(prefix.length);
    const focus = tag("focus:")?.split(",").map(Number);
    return {
      candidate: { id: row.id, source: "brand_library", materialType: row.material_type, name: row.name, tags: row.tags, notes: row.ai_instructions ?? undefined, form: tag("form:") === "mobile" ? "mobile" : "desktop" },
      url: c.objectStorage.resolvePublicUrl(row.key),
      meta: { devicePixelRatio: Number(tag("dpr:")) || 1, ...(focus?.length === 4 && focus.every(Number.isFinite) ? { focus: { x: focus[0], y: focus[1], w: focus[2], h: focus[3] } } : {}), feature: tag("feature:"), form: tag("form:") === "mobile" ? "mobile" : "desktop" },
    };
  });
}

/** Histórico visual recente da marca (impressões das peças publicadas pela automação). */
async function visualHistory(usedRows) {
  const history = [];
  for (const row of usedRows.slice(0, 6)) {
    const stored = row.creative?.fingerprints;
    if (Array.isArray(stored) && stored.length) { history.push(...stored); continue; }
    // Peças anteriores ao motor novo: impressão calculada da primeira arte publicada.
    const url = row.image;
    if (!url) continue;
    try { history.push({ archetype: "legado", textLayout: "top", productCount: 0, palette: [], dHash: await dHash(await ownedBytes(url)) }); } catch { /* arte antiga indisponível: segue sem ela */ }
  }
  return history.slice(0, 8);
}

/** Monta o plano criativo de uma pauta e os arquivos originais das referências escolhidas. */
async function planIdea(idea, creative, context) {
  const titleAndMessage = `${idea.title} ${idea.keyMessage ?? ""}`.normalize("NFD").replace(/\p{M}/gu, "");
  const siteFeature = context.requireRealScreen && /\b(paginas?|sites?|landing pages?)\b/i.test(titleAndMessage)
    ? creative.features?.find(feature => feature.key === "editor_site") : undefined;
  const ideaReferences = [];
  const urls = new Map();
  for (const url of idea.referenceImages ?? []) {
    const photo = context.photosByUrl.get(url);
    // Camiseta com logo de outra marca nunca vai para post, mesmo anexada à pauta: o planejador escolhe uma estampa própria.
    if (photo && creative.blockedProducts?.includes(photo.code)) continue;
    const id = photo ? `produto:${photo.code}:${variantName(photo.color)}` : `pauta:${sha256Prefix(Buffer.from(url))}`;
    urls.set(id, url);
    const bytes = await ownedBytes(url);
    if (photo) ideaReferences.push({ id, source: "catalog", productCode: photo.code, variantLabel: variantName(photo.color), ...(await catalogPhotoSignals(bytes, variantName(photo.color))), ...(ideaReferences.some(item => item.productCode === photo.code) ? { explicitRole: "product_variant" } : {}) });
    else ideaReferences.push({ id, source: "idea_upload", siteCaptureScore: await siteCaptureScore(bytes) });
  }
  const captureMeta = new Map();
  const libraryCandidates = [];
  if (creative.businessKind === "software") {
    const editorialSiteCaptures = siteFeature && context.captures.some(capture => capture.meta.feature === siteFeature.key && capture.candidate.tags.includes("view:editorial"));
    for (const capture of context.captures) {
      if (context.requireRealScreen && capture.meta.form !== "desktop") continue;
      if (siteFeature && capture.meta.feature !== siteFeature.key) continue;
      if (editorialSiteCaptures && !capture.candidate.tags.includes("view:editorial")) continue;
      libraryCandidates.push(capture.candidate); urls.set(capture.candidate.id, capture.url); captureMeta.set(capture.candidate.id, capture.meta);
    }
  }
  // Produtos liberados para pauta automática, em rodízio: só o primeiro com foto utilizável é medido.
  const editorialProducts = [];
  if (creative.businessKind === "physical_products" && creative.products?.length) {
    // Rodízio, reordenado pelo assunto da pauta. Nenhuma peça atende a ocasião pedida: mede a primeira do
    // rodízio mesmo assim — o planejador recusa e registra o motivo (a pauta vai para revisão).
    // Refação pedida por causa do produto: as peças das versões reprovadas saem do rodízio (se sobrar alguma).
    const kept = (context.keepProducts ?? []).filter(code => creative.products.includes(code) && !context.excludeProducts?.includes(code));
    const allowed = creative.products.filter(code => !context.excludeProducts?.includes(code));
    // Memória da marca: peça reprovada por produto em pautas diferentes vai para o fim do rodízio (não é bloqueada).
    const rotation = applyProductMemory(rotationOrder(allowed.length ? allowed : creative.products, context.used), context.memory);
    const rotated = [...kept, ...rotation.filter(code => !kept.includes(code))].map(code => ({ code, themes: creative.productThemes?.[code] ?? [] }));
    const ranked = rankProductsForIdea(rotated, idea);
    for (const { code, themes } of ranked.length ? ranked : rotated) {
      const photos = context.photos.filter(photo => photo.code === code);
      const seen = new Set();
      const measured = [];
      for (const photo of photos) {
        const label = variantName(photo.color);
        if (seen.has(label)) continue;
        seen.add(label);
        const signals = await catalogPhotoSignals(await ownedBytes(photo.url), label);
        if (signals.siteCaptureScore >= 0.62 || signals.variantColorCheck?.consistent === false) continue;
        const id = `produto:${code}:${label}`;
        urls.set(id, photo.url);
        measured.push({ id, variantLabel: label, siteCaptureScore: signals.siteCaptureScore, photoKind: signals.photoKind });
        if (measured.length >= 3) break;
      }
      if (measured.length) { editorialProducts.push({ code, themes, photos: measured }); break; }
    }
  }
  const plan = planEditorialCreative({
    workspaceId, brandName: context.brandName, brandIdentity: context.profile?.identity, presentation: creative.presentation, businessKind: creative.businessKind, softwareFeatures: siteFeature ? [siteFeature] : creative.features, idea,
    ideaReferences, libraryCaptures: libraryCandidates, editorialProducts, history: context.history, allowAi: !context.requireRealScreen,
    avoidArchetypes: context.requireRealScreen ? [...(creative.avoidArchetypes ?? []), "phone_conversation"] : creative.avoidArchetypes,
    ...(context.requireRealScreen ? { explicitMode: "software" } : {}),
    ...(context.memory ? { memory: { archetypeBias: context.memory.archetypeBias, guidance: memoryGuidance(context.memory, "image") } } : {}),
  });
  const assets = {};
  const traced = [];
  const screenReferences = [...new Map([...plan.resolved.transmitted, ...plan.screens.flatMap(item => item.transmitted)].map(reference => [reference.id, reference])).values()];
  for (const reference of screenReferences) {
    const url = urls.get(reference.id);
    if (!url) continue;
    const bytes = reference.role === "software_capture" ? await ownedBytes(url) : await sharp(await ownedBytes(url)).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(bytes).metadata();
    assets[reference.id] = { data: bytes.toString("base64"), ...(captureMeta.get(reference.id) ?? {}) };
    traced.push({ id: reference.id, source: reference.source, role: reference.role, sha256: sha256Prefix(bytes), bytes: bytes.length, width: meta.width, height: meta.height, ...(reference.productCode ? { productCode: reference.productCode, variantLabel: reference.variantLabel } : {}) });
  }
  if (context.requireRealScreen && !plan.blocked) {
    requireCondition(plan.screens.every(item => item.transmitted.some(ref => ref.role === "software_capture" && assets[ref.id])), "A refação exige captura real em todas as artes.");
    const desktopLayouts = ["device_laptop", "browser_window", "ui_focus"];
    for (const [index, { spec }] of plan.screens.entries()) {
      const archetype = desktopLayouts[index % desktopLayouts.length];
      Object.assign(spec.composition, { archetype, operation: "deterministic_composite",
        alternatives: desktopLayouts.filter(id => id !== archetype) });
    }
  }
  return {
    plan: {
      mode: plan.decision.mode, modeReasons: plan.decision.reasons, feature: plan.decision.feature?.feature.key, autoSelected: plan.autoSelected,
      blockers: plan.resolved.missing, excluded: plan.resolved.excluded.map(entry => ({ id: entry.reference.id, role: entry.reference.role, reason: entry.reason })),
      screens: plan.screens.map(item => ({ screen: item.screen, spec: item.spec, instruction: item.instruction, transmitted: item.transmitted.map(({ id, role, source, productCode, variantLabel }) => ({ id, role, source, productCode, variantLabel })) })),
    },
    blocked: plan.blocked, assets, traced, productCodes: [...new Set(plan.resolved.transmitted.map(reference => reference.productCode).filter(Boolean))],
  };
}

function summarizes(post) {
  return { id: post.id, state: post.state, destinations: post.destinations.map(({ network, state, externalUrl, problem }) => ({ network, state, externalUrl, problem })) };
}

function publishedOnBoth(post) {
  return post.destinations.length === 2 && post.destinations.every(destination => destination.state === "PUBLISHED");
}

async function reconcile() {
  const { rows } = await db.query(`select p.id, a.editorial_idea_id from publication_plans p
    cross join lateral (select p.source_artifacts->0->'payload'->>'editorialIdeaId' as editorial_idea_id) a
    join editorial_ideas e on e.id=a.editorial_idea_id and e.workspace_id=p.workspace_id
    where p.tenant_id=$1 and p.workspace_id=$2 and p.idempotency_key like $3 and e.status in ('available','approved')`,
  [tenantId, workspaceId, `social:${prefix}:%`]);
  for (const row of rows) {
    const post = await c.social.posts.get({ ...scope, postId: row.id });
    if (publishedOnBoth(post)) {
      await db.query(`update editorial_ideas set status='published',status_changed_at=now(),updated_at=now()
        where id=$1 and workspace_id=$2 and tenant_id=$3 and status in ('available','approved')`, [row.editorial_idea_id, workspaceId, tenantId]);
    }
  }
}

// ---------------------------------------------------------------- refação depois da reprovação no WhatsApp

/** Escopo da refação direcionada (o que muda e o que fica), a partir do motivo e da leitura do Codex. */
function redoScopeFor(idea) {
  if (typeof request.redoReason !== "string" || !request.redoReason.trim()) return undefined;
  return resolveRedoScope({ reason: request.redoReason, screenCount: screensForIdea(idea).length, codex: request.redoCodex && typeof request.redoCodex === "object" ? request.redoCodex : undefined });
}

/** Texto reescrito pelo Codex, mas só nas telas que o motivo criticou: as demais voltam ao texto original. */
function effectiveTextOverride(idea) {
  const scope = redoScopeFor(idea);
  if (!request.textOverride || !scope) return request.textOverride;
  const screens = screensForIdea(idea);
  const original = idea.format === "carousel"
    ? { headline: screens[0]?.headline ?? "", body: screens[0]?.body ?? "", slides: (idea.carouselScript ?? []).map(slide => ({ headline: slide.headline, body: slide.body ?? "" })) }
    : { headline: screens[0]?.headline ?? idea.title, body: screens[0]?.body ?? "" };
  return scopedText(original, request.textOverride, scope);
}

/** Texto reescrito na refação (título/subtítulo/telas): aplicado só na pauta refeita, sem alterar o Bolsão. */
function withTextOverride(idea) {
  const override = effectiveTextOverride(idea);
  if (!override || !request.onlyIdea || (idea.id !== request.onlyIdea && idea.externalId !== request.onlyIdea)) return idea;
  const clean = (value, max) => String(value ?? "").replace(/[\r\n]+/g, " ").replace(/["“”']/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  if (idea.format === "carousel") {
    if (!Array.isArray(override.slides) || override.slides.length !== (idea.carouselScript ?? []).length) return idea;
    return { ...idea, carouselScript: idea.carouselScript.map((slide, index) => ({ ...slide, headline: clean(override.slides[index]?.headline, 90) || slide.headline, body: clean(override.slides[index]?.body, 220) || slide.body })) };
  }
  const headline = clean(override.headline, 90);
  const body = clean(override.body, 220);
  if (!headline) return idea;
  const prompt = String(idea.creativePrompt ?? "").replace(/TEXTO EXATO DA (?:CAPA\/ARTE|ARTE)\s*:\s*['“"][^\r\n'”"]+['”"]/gi, "").trim();
  return { ...idea, keyMessage: body ? `${headline}\n\n${body}` : headline, creativePrompt: `TEXTO EXATO DA ARTE: "${headline}"${prompt ? `\n${prompt}` : ""}` };
}

/** Pega a próxima refação pendente desta marca (com o contexto que o Codex precisa para refazer). */
async function claimRedo() {
  await db.query(`update publication_redo_requests set status='failed', detail='A refação foi interrompida.', updated_at=now()
    where workspace_id=$1 and status='running' and updated_at < now() - interval '40 minutes'`, [workspaceId]);
  const { rows: [job] } = await db.query(`update publication_redo_requests set status='running', updated_at=now() where id = (
      select id from publication_redo_requests where tenant_id=$1 and workspace_id=$2 and status='pending' order by created_at limit 1 for update skip locked)
    returning id, publication_id, idea_id, reason, attempt, slot`, [tenantId, workspaceId]);
  if (!job) return { job: null };
  const idea = await c.editorialIdeaRepository.get(workspaceId, job.idea_id);
  if (!idea || idea.status !== "available") {
    await db.query("update publication_redo_requests set status='failed', detail=$2, updated_at=now() where id=$1", [job.id, "A pauta não está mais disponível no Bolsão."]);
    return { job: null };
  }
  const { rows: [plan] } = await db.query("select source_artifacts->0->'payload' as payload from publication_plans where id=$1", [job.publication_id]);
  const { rows: history } = await db.query(`select r.reason, p.source_artifacts->0->'payload'->'catalogProductCodes' as codes from publication_redo_requests r
    join publication_plans p on p.id=r.publication_id where r.idea_id=$1 order by r.created_at`, [job.idea_id]);
  let previousImage;
  const url = plan?.payload?.imageUrls?.[0];
  if (url) {
    try { previousImage = (await sharp(await ownedBytes(url)).resize({ width: 720, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString("base64"); } catch { /* sem a arte anterior: o Codex refaz só pelo texto */ }
  }
  // Aprendizado da marca para a reescrita (texto, legenda, informação) — só erros recorrentes.
  const memory = await brandMemory().catch(() => undefined);
  // Versão reprovada, tela a tela: a refação direcionada recompõe sobre a base aprovada as telas que o motivo
  // não criticou (sem gerar imagem nova) e garante que as criticadas mudem.
  const creative = plan?.payload?.creative ?? {};
  const screensMeta = Array.isArray(creative.screens) ? creative.screens : [];
  const previousScreens = [];
  for (const [index, archetype] of (Array.isArray(creative.archetypes) ? creative.archetypes : []).entries()) {
    const meta = screensMeta[index] ?? {};
    let base;
    if (meta.baseUrl) {
      try { base = (await ownedBytes(meta.baseUrl)).toString("base64"); } catch { /* base indisponível: esta tela é gerada de novo */ }
    }
    previousScreens.push({ screen: index + 1, archetype: String(archetype), operation: ARCHETYPES[archetype]?.operation, imageSha256: creative.approvals?.[index]?.imageSha256,
      ...(creative.fingerprints?.[index] ? { fingerprint: creative.fingerprints[index] } : {}),
      ...(base ? { base, layout: meta.layout, logoPlacement: meta.logoPlacement, protectedAreas: meta.protectedAreas ?? [], ...(meta.aiReview ? { aiReview: meta.aiReview } : {}), ...(meta.sceneReview ? { sceneReview: meta.sceneReview } : {}) } : {}) });
  }
  const hint = resolveRedoScope({ reason: job.reason, screenCount: screensForIdea(idea).length });
  // Vídeo reprovado: a refação parte da versão exata que foi ao WhatsApp (o orquestrador de vídeo refaz).
  const video = typeof plan?.payload?.videoVersionId === "string" ? { versionId: plan.payload.videoVersionId, projectId: plan.payload.videoProjectId, sha256: plan.payload.videoSha256 } : undefined;
  return { job: {
    ...(video ? { video, brand: (await c.workspaceRepository.getById(workspaceId))?.name } : {}),
    id: job.id, reason: job.reason, attempt: job.attempt, slot: job.slot, previousImage, memory: memoryGuidance(memory, "redo"),
    previousScreens, previousVersionProducts: Array.isArray(plan?.payload?.catalogProductCodes) ? plan.payload.catalogProductCodes.map(String) : [],
    scopeHint: { text: hint.text, image: hint.image, caption: hint.caption, product: hint.product, logo: hint.logo, unclear: hint.reading.unclear, changed: hint.changed, kept: hint.kept },
    previousArchetypes: Array.isArray(plan?.payload?.creative?.archetypes) ? plan.payload.creative.archetypes.map(String) : [],
    reasons: history.map(row => row.reason), previousProducts: [...new Set(history.flatMap(row => Array.isArray(row.codes) ? row.codes.map(String) : []))],
    idea: { id: idea.id, externalId: idea.externalId, title: idea.title, format: idea.format, category: idea.category, keyMessage: idea.keyMessage, caption: idea.caption,
      cta: idea.cta, visualDirection: idea.visualDirection, screens: screensForIdea(idea), carouselScript: idea.carouselScript ?? [] },
  } };
}

// >>> RAMO DE VÍDEO (Reels) — início do bloco autocontido
// ---------------------------------------------------------------- vídeo (Reels) a partir de pauta "video"

// Chave própria das publicações de vídeo e horário próprio (20h): não ocupa nem desloca os horários das
// 12h/19h das imagens e carrosséis.
const videoPrefix = "codex-editorial-video-v1";
const VIDEO_HOUR = "20";
const VIDEO_MAX_MATERIALS = 6;

// Bloco AUTOCONTIDO: só depende do que existe em qualquer versão deste backend (requireCondition,
// actorForPublish, catalogPhotos, libraryCaptures, ownedBytes, variantName, brands) e carrega o resto do
// dist sob demanda — as rodadas de imagem/carrossel não passam a depender de nada do vídeo.
async function videoModules() {
  const [route, processing, transcript, calendar, memory] = await Promise.all([
    import("./dist/interfaces/api/routes/v1/video-projects.route.js"),
    import("./dist/application/video-editing/process-video-version.js"),
    import("./dist/application/video-editing/transcript-tools.js"),
    import("./dist/application/creative-engine/editorial-calendar.js"),
    import("./dist/application/creative-engine/creative-memory.js"),
  ]);
  const config = loadApiConfig();
  return { service: route.buildVideoProjectsService({ pool: db, objectStorage: c.objectStorage, videoEngine: config.videoEngine }), videoSheetKey: processing.videoSheetKey, videoSourcePreviewKey: processing.videoSourcePreviewKey, buildSentences: transcript.buildSentences, engine: config.videoEngine, rankIdeasForSlot: calendar.rankIdeasForSlot, memory };
}

async function videoMotionModules() {
  const { buildMotionGenerationService } = await import("./dist/infrastructure/video-motion/build-motion-service.js");
  return buildMotionGenerationService({ config: loadApiConfig().videoMotion, pool: db, storage: c.objectStorage });
}

async function videoMotionStatus() {
  const { service, defaults } = await videoMotionModules();
  const config = loadApiConfig().videoMotion;
  const allowed = config.enabled && (config.workspaces.includes("*") || config.workspaces.includes(workspaceId));
  const estimate = service.estimate(defaults.provider, defaults.model, 4);
  const budget = await service.budget(scope);
  return { enabled: allowed && budget.remainingUsd >= estimate.usd, provider: defaults.provider, model: defaults.model, seconds: estimate.seconds, usdPerScene: estimate.usd, maxScenes: Math.max(0, Math.min(2, Math.floor(budget.remainingUsd / Math.max(0.01, estimate.usd)))), ...budget };
}

/** Peças da marca perto do horário (14 dias), para a variedade do calendário. */
async function videoRecentPieces(allIdeas) {
  const byId = new Map(allIdeas.map((idea) => [idea.id, idea]));
  const { rows } = await db.query(`select source_artifacts->0->'payload'->>'editorialIdeaId' as idea_id, coalesce(published_at, scheduled_at, created_at) as at
    from publication_plans where tenant_id=$1 and workspace_id=$2 and state not in ('cancelled','failed','superseded')
      and coalesce(published_at, scheduled_at, created_at) > now() - interval '14 days' order by at desc limit 30`, [tenantId, workspaceId]);
  return rows.map((row) => { const idea = row.idea_id ? byId.get(row.idea_id) : undefined;
    return { ...(idea ? { ideaId: idea.id, title: idea.title, category: idea.category, approach: idea.approach, text: idea.keyMessage } : {}), format: idea?.format ?? "single_image", at: new Date(row.at).toISOString() }; });
}

/** Aprovações/reprovações desta marca no WhatsApp (só leitura, só deste workspace). */
async function videoBrandMemory(memory) {
  const { rows } = await db.query(`select q.workspace_id, q.publication_id, q.decision, q.reason, q.decided_at,
      jsonb_build_object('editorialIdeaId', p.source_artifacts->0->'payload'->'editorialIdeaId', 'catalogProductCodes', p.source_artifacts->0->'payload'->'catalogProductCodes',
        'creative', jsonb_build_object('archetypes', p.source_artifacts->0->'payload'->'creative'->'archetypes')) as payload
    from publication_approval_requests q join publication_plans p on p.id=q.publication_id and p.tenant_id=q.tenant_id and p.workspace_id=q.workspace_id
    where q.tenant_id=$1 and q.workspace_id=$2 and q.decision is not null and q.decided_at > now() - interval '60 days' order by q.decided_at desc limit 120`, [tenantId, workspaceId]);
  return memory.buildCreativeMemory(memory.feedbackEventsFromRows(rows), { workspaceId });
}

async function keyBytes(key) {
  const response = await fetch(signForExternalPublication(c.objectStorage.resolvePublicUrl(key)), { signal: AbortSignal.timeout(60000) });
  requireCondition(response.ok, `Arquivo do workspace indisponível (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/** Miniatura JPEG para o diretor criativo (Codex) enxergar o material. */
async function thumbnail(bytes) {
  return (await sharp(bytes).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()).toString("base64");
}

const ownedKey = (url) => {
  const key = parseOwnedObjectUrl(url)?.key;
  const owner = key && classifyObjectKeyOwner(key);
  return owner?.kind === "workspace" && owner.tenantId === tenantId && owner.workspaceId === workspaceId ? key : undefined;
};

/** Texto do pedido do vídeo (vai para a validação: número/preço só se estiver aqui). */
function videoRequestText(idea) {
  return [`Pauta: ${idea.title}`, idea.keyMessage && `Mensagem: ${idea.keyMessage}`, idea.cta && `Chamada: ${idea.cta}`, idea.visualDirection && `Direção visual: ${idea.visualDirection}`, idea.caption && `Legenda: ${idea.caption}`]
    .filter(Boolean).join("\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").slice(0, 1450);
}

/**
 * Materiais da pauta de vídeo: anexos da pauta (foto, captura, gravação), senão o que a marca tem —
 * fotos oficiais do catálogo (nunca peça com logo de terceiros), capturas reais do software pela
 * funcionalidade da pauta. Sem nada: o diretor criativo cria imagens conceituais (cenário "só a ideia").
 */
async function videoMaterials(idea, creative, modules) {
  const materials = [];
  const photos = creative.businessKind === "physical_products" ? await catalogPhotos() : [];
  const photosByUrl = new Map(photos.map((photo) => [photo.url, photo]));
  for (const url of idea.referenceImages ?? []) {
    if (materials.length >= VIDEO_MAX_MATERIALS) break;
    const key = ownedKey(url);
    if (!key) continue;
    const photo = photosByUrl.get(url);
    if (photo && creative.blockedProducts?.includes(photo.code)) continue;
    const video = /\.(mp4|mov)$/i.test(key);
    if (video) { materials.push({ objectKey: key, kind: "video", role: "footage", label: "gravação anexada à pauta" }); continue; }
    const bytes = await ownedBytes(url);
    const meta = await sharp(bytes).metadata();
    const site = photo ? 0 : await siteCaptureScore(bytes);
    materials.push({ objectKey: key, kind: "image", role: photo ? "product_photo" : site >= 0.62 ? "screenshot" : "reference",
      label: photo ? `produto ${photo.code} (${variantName(photo.color)})` : site >= 0.62 ? "captura de tela anexada" : "imagem anexada à pauta",
      width: meta.width, height: meta.height, thumb: await thumbnail(bytes), ...(photo ? { productCode: photo.code } : {}) });
  }
  if (!materials.length && creative.businessKind === "physical_products" && creative.products?.length) {
    // Pauta que cita os modelos pelo código (ex.: quiz "000037 e 000043"): exatamente essas peças, até 3 fotos
    // de cores diferentes de cada (nunca peça com logo de terceiros).
    const cited = [...new Set(`${idea.title} ${idea.keyMessage ?? ""} ${idea.visualDirection ?? ""} ${idea.creativePrompt ?? ""}`.match(/\b0\d{5}\b/g) ?? [])]
      .filter((code) => creative.products.includes(code) && !creative.blockedProducts?.includes(code)).slice(0, 3);
    for (const code of cited) {
      const seen = new Set();
      for (const photo of photos.filter((item) => item.code === code)) {
        const label = variantName(photo.color);
        const key = ownedKey(photo.url);
        if (!key || seen.has(label) || seen.size >= (cited.length > 1 ? 2 : 3)) continue;
        const bytes = await ownedBytes(photo.url);
        const signals = await catalogPhotoSignals(bytes, label);
        if (signals.siteCaptureScore >= 0.62 || signals.variantColorCheck?.consistent === false) continue;
        seen.add(label);
        const meta = await sharp(bytes).metadata();
        materials.push({ objectKey: key, kind: "image", role: "product_photo", label: `camiseta ${label.toLocaleLowerCase("pt-BR")} — estampa ${code}`, width: meta.width, height: meta.height, thumb: await thumbnail(bytes), productCode: code });
      }
    }
  }
  if (!materials.length && creative.businessKind === "physical_products" && creative.products?.length) {
    // Rodízio de estampas próprias, pelo assunto da pauta: a primeira peça com fotos de cores diferentes.
    const memory = await videoBrandMemory(modules.memory).catch(() => undefined);
    const usedRows = (await db.query(`select source_artifacts->0->'payload'->'catalogProductCodes' as codes from publication_plans
      where tenant_id=$1 and workspace_id=$2 and idempotency_key like $3 order by created_at desc limit 30`, [tenantId, workspaceId, `social:${prefix}%`])).rows;
    const rotated = modules.memory.applyProductMemory(rotationOrder(creative.products.filter((code) => !creative.blockedProducts?.includes(code)), usedRows), memory).map((code) => ({ code, themes: creative.productThemes?.[code] ?? [] }));
    const ranked = rankProductsForIdea(rotated, idea);
    for (const { code } of ranked.length ? ranked : rotated) {
      const seen = new Set();
      for (const photo of photos.filter((item) => item.code === code)) {
        const label = variantName(photo.color);
        const key = ownedKey(photo.url);
        if (!key || seen.has(label) || materials.length >= 3) continue;
        const bytes = await ownedBytes(photo.url);
        const signals = await catalogPhotoSignals(bytes, label);
        if (signals.siteCaptureScore >= 0.62 || signals.variantColorCheck?.consistent === false) continue;
        seen.add(label);
        const meta = await sharp(bytes).metadata();
        materials.push({ objectKey: key, kind: "image", role: "product_photo", label: `camiseta ${label.toLocaleLowerCase("pt-BR")} — estampa ${code}`, width: meta.width, height: meta.height, thumb: await thumbnail(bytes), productCode: code });
      }
      if (materials.length) break;
    }
  }
  if (!materials.length && creative.businessKind === "software") {
    // Capturas reais da funcionalidade de que a pauta fala (etiqueta feature: na Biblioteca).
    const text = `${idea.title} ${idea.keyMessage ?? ""} ${idea.visualDirection ?? ""}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const feature = (creative.features ?? []).map((item) => ({ item, hits: item.keywords.filter((word) => text.includes(word)).length })).sort((a, b) => b.hits - a.hits)[0];
    const captures = await libraryCaptures();
    const chosen = captures.filter((capture) => !feature?.hits || capture.meta.feature === feature.item.key).slice(0, 4);
    for (const capture of chosen.length ? chosen : captures.slice(0, 4)) {
      const key = ownedKey(capture.url);
      if (!key) continue;
      const bytes = await ownedBytes(capture.url);
      const meta = await sharp(bytes).metadata();
      materials.push({ objectKey: key, kind: "image", role: "screenshot", label: `${capture.candidate.name}${capture.meta.feature ? ` (${capture.meta.feature})` : ""}`, width: meta.width, height: meta.height, thumb: await thumbnail(bytes) });
    }
  }
  return materials.map((material, index) => ({ id: `M${index + 1}`, ...material }));
}

function videoPostSummary(post) {
  return { id: post.id, state: post.state, destinations: post.destinations.map(({ network, state, format }) => ({ network, state, format })) };
}

async function videoAction(workspace, brandConfig) {
  const modules = await videoModules();
  const { service, videoSheetKey, videoSourcePreviewKey, buildSentences, engine } = modules;
  const creative = brandConfig.creative ?? { businessKind: "unknown" };
  const date = typeof request.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.date) ? request.date : undefined;
  requireCondition(engine.allWorkspaces || engine.enabledWorkspaces.includes(workspaceId), "Motor de vídeo não habilitado para esta marca");

  if (mode === "video_select") {
    requireCondition(date, "Data do vídeo inválida");
    const slot = `${date}T${VIDEO_HOUR}:00`;
    const allIdeas = await c.editorialIdeaRepository.listByWorkspace(workspaceId);
    const ideas = allIdeas.filter((idea) => idea.format === "video" && idea.status === "available" && (!idea.scheduledDate || idea.scheduledDate <= date));
    // Pauta com vídeo em produção (ou pronto e ainda não agendado): retoma em vez de abrir outro.
    const { rows: open } = await db.query(`select p.id as project_id, p.settings->'origin'->>'ideaId' as idea_id, v.id as version_id, v.status, v.stage
      from video_projects p join lateral (select id, status, stage from video_versions where project_id=p.id order by number desc limit 1) v on true
      where p.tenant_id=$1 and p.workspace_id=$2 and p.settings->'origin'->>'kind'='editorial_pilot' and p.created_at > now() - interval '3 days'
      order by p.created_at desc`, [tenantId, workspaceId]);
    const { rows: usedRows } = await db.query(`select source_artifacts->0->'payload'->>'editorialIdeaId' as id, state from publication_plans
      where tenant_id=$1 and workspace_id=$2 and idempotency_key like $3`, [tenantId, workspaceId, `social:${videoPrefix}:%`]);
    const used = new Set(usedRows.filter((row) => row.state !== "cancelled").map((row) => row.id));
    const { rows: redoing } = await db.query(`select idea_id from publication_redo_requests where workspace_id=$1 and status in ('pending','running')`, [workspaceId]);
    const skip = new Set([...(Array.isArray(request.skipIdeaIds) ? request.skipIdeaIds.map(String) : []), ...redoing.map((row) => row.idea_id)]);
    const only = request.onlyIdea ? String(request.onlyIdea) : undefined;
    const eligible = ideas.filter((idea) => (only ? idea.id === only || idea.externalId === only : !used.has(idea.id) && !skip.has(idea.id)));
    const resume = !only && open.find((row) => eligible.some((idea) => idea.id === row.idea_id) && !["failed", "cancelled", "approved"].includes(row.status));
    const ranking = modules.rankIdeasForSlot(eligible, { slot, recent: await videoRecentPieces(allIdeas) });
    const idea = resume ? eligible.find((item) => item.id === resume.idea_id) : ranking[0]?.idea;
    if (!idea) return { brand: workspace.name, empty: true, videoIdeas: ideas.length };
    const { rows: [brandRow] } = await db.query("select profile from brand_visual_profiles where workspace_id=$1", [workspaceId]);
    const identity = brandRow?.profile?.identity;
    const { rows: strategies } = await db.query(`select v.plan->>'strategy' as strategy from video_versions v join video_projects p on p.id=v.project_id
      where p.workspace_id=$1 and v.plan is not null order by v.created_at desc limit 5`, [workspaceId]);
    const memory = await videoBrandMemory(modules.memory).catch(() => undefined);
    return {
      brand: workspace.name, slot,
      idea: { id: idea.id, externalId: idea.externalId, title: idea.title, keyMessage: idea.keyMessage, caption: idea.caption, cta: idea.cta, visualDirection: idea.visualDirection, category: idea.category, updatedAt: idea.updatedAt },
      request: videoRequestText(idea),
      ...(resume ? { resume: { projectId: resume.project_id, versionId: resume.version_id, status: resume.status, stage: resume.stage } } : { materials: await videoMaterials(idea, creative, modules) }),
      brandStyle: { name: workspace.name, tone: identity?.toneOfVoice ?? identity?.tone, colors: Array.isArray(identity?.colors) ? identity.colors.slice(0, 6) : undefined },
      businessKind: creative.businessKind, musicAvailable: engine.musicLibraryAvailable,
      // Movimento por IA: só informado ao diretor quando liberado para a marca, com custo e saldo do mês.
      motion: await videoMotionStatus().catch(() => ({ enabled: false })),
      recentStrategies: strategies.map((row) => row.strategy).filter(Boolean),
      ...(memory ? { lessons: modules.memory.memoryGuidance(memory, "video") } : {}),
      calendar: ranking.slice(0, 3).map((entry) => ({ idea: entry.idea.externalId, score: Number(entry.score.toFixed(2)), reasons: entry.reasons })),
    };
  }

  if (mode === "video_idea") {
    // Consulta leve (refação): situação atual da pauta.
    const idea = await c.editorialIdeaRepository.get(workspaceId, String(request.ideaId));
    requireCondition(idea?.format === "video", "Pauta de vídeo não encontrada");
    return { id: idea.id, status: idea.status, updatedAt: idea.updatedAt };
  }

  if (mode === "video_motion_generate") {
    // Movimento por IA a partir da FOTO OFICIAL: custo estimado, limite do mês, registro, fidelidade automática.
    // Bloqueado (sem chamada paga) se desligado, sem chave ou sem saldo — o piloto usa a foto original.
    const { service, defaults } = await videoMotionModules();
    const key = String(request.objectKey ?? "");
    requireCondition(classifyObjectKeyOwner(key)?.workspaceId === workspaceId, "Foto fora do workspace");
    const bytes = await keyBytes(key);
    const jpeg = await sharp(bytes).rotate().resize({ width: 1440, height: 1920, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    const estimate = service.estimate(defaults.provider, defaults.model, Number(request.seconds) || 4);
    const outcome = await service.generate({ scope, provider: defaults.provider, model: defaults.model, source: { objectKey: key, bytes: jpeg, mimeType: "image/jpeg" }, prompt: String(request.prompt ?? "").slice(0, 1500),
      seconds: estimate.seconds, aspect: "9:16", ...(request.region ? { region: request.region } : {}), origin: { ideaId: request.ideaId ?? null, kind: "editorial_pilot" } });
    if (!outcome.ok) return { ok: false, id: outcome.generation.id, status: outcome.generation.status, reason: outcome.reason, estimatedUsd: outcome.generation.estimatedUsd };
    return { ok: true, id: outcome.generation.id, clipObjectKey: outcome.generation.clipObjectKey, seconds: outcome.generation.seconds, estimatedUsd: outcome.generation.estimatedUsd,
      fidelity: outcome.generation.fidelity, fidelitySheet: outcome.fidelitySheet.toString("base64"), original: (await sharp(bytes).rotate().resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()).toString("base64") };
  }

  if (mode === "video_motion_decide") {
    const { service } = await videoMotionModules();
    const decided = await service.decide(scope, String(request.id), { approved: request.approved === true, findings: Array.isArray(request.findings) ? request.findings.map(String).slice(0, 10) : [], reviewer: "codex" });
    return { id: decided.id, status: decided.status, clipObjectKey: decided.clipObjectKey ?? null };
  }

  if (mode === "video_upload") {
    // Imagem conceitual gerada pelo Codex (cenário "só a ideia"): vai para o storage do workspace.
    requireCondition(typeof request.data === "string" && typeof request.ideaId === "string", "Upload de imagem inválido");
    const png = await sharp(Buffer.from(request.data, "base64")).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(png).metadata();
    const key = `assets/${tenantId}/${workspaceId}/video-gen/${String(request.ideaId).slice(0, 60)}-${createHash("sha256").update(png).digest("hex").slice(0, 20)}.png`;
    await c.objectStorage.put({ key, body: png, contentType: "image/png" });
    return { objectKey: key, width: meta.width, height: meta.height };
  }

  const actor = await actorForPublish();

  if (mode === "video_queue") {
    const idea = await c.editorialIdeaRepository.get(workspaceId, request.ideaId);
    requireCondition(idea?.status === "available" && idea.format === "video" && idea.updatedAt === request.updatedAt, "A pauta mudou durante a preparação do vídeo");
    requireCondition(Array.isArray(request.materials) && request.materials.length >= 1 && request.materials.length <= VIDEO_MAX_MATERIALS, "Materiais do vídeo inválidos");
    for (const material of request.materials) requireCondition(typeof material.objectKey === "string" && classifyObjectKeyOwner(material.objectKey)?.workspaceId === workspaceId, "Material fora do workspace");
    const settings = request.settings ?? {};
    const { project, version } = await service.create({
      scope: scope, userId: actor.userId, title: `Pauta ${idea.externalId} — ${idea.title}`.slice(0, 120), aspect: "9:16", request: videoRequestText(idea),
      settings: { targetDurationSeconds: Math.max(8, Math.min(60, Number(settings.targetDurationSeconds) || 20)), editing: ["dinamico", "elegante", "direto"].includes(settings.editing) ? settings.editing : "dinamico",
        transitions: ["suaves", "moderadas", "marcantes"].includes(settings.transitions) ? settings.transitions : "moderadas", captions: settings.captions !== false, music: Boolean(settings.music) && engine.musicLibraryAvailable,
        origin: { kind: "editorial_pilot", ideaId: idea.id, externalId: idea.externalId } },
      materials: request.materials.map((material) => ({ url: c.objectStorage.resolvePublicUrl(material.objectKey), role: material.role, ...(material.label ? { label: String(material.label).slice(0, 80) } : {}) })),
      ...(request.draft ? { presetDraft: request.draft } : {}),
    });
    return { projectId: project.id, versionId: version.id };
  }

  if (mode === "video_status") {
    const { version, project } = await service.pilotVersion(scope, String(request.versionId));
    const done = ["ready_for_review", "needs_revision", "approved"].includes(version.status) && version.outputKey;
    let output;
    if (done && request.withMedia) {
      const bytes = await keyBytes(version.outputKey);
      let sheet;
      try { sheet = (await keyBytes(videoSheetKey(tenantId, workspaceId, version.id))).toString("base64"); } catch { /* prancha não gerada: revisão só pelo relatório */ }
      output = { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, ...(sheet ? { sheet } : {}) };
    }
    const needsSentences = version.stage === "awaiting_draft" || version.plan?.clips.some((clip) => clip.keepSourceAudio);
    const sourcePreviews = request.withMedia && (done || version.stage === "awaiting_draft") ? Object.fromEntries(
      (await Promise.all(project.materials.filter((material) => material.kind === "video").map(async (material) => {
        const key = videoSourcePreviewKey(tenantId, workspaceId, project.id, material.id);
        try { return [material.id, (await keyBytes(key)).toString("base64")]; } catch { return undefined; }
      }))).filter(Boolean)
    ) : undefined;
    return {
      versionId: version.id, projectId: project.id, number: version.number, status: version.status, stage: version.stage, progress: version.progress, message: version.message, error: version.error,
      warnings: version.warnings, gate: version.gate, draft: version.draft, renderMs: version.renderMs,
      plan: version.plan ? { strategy: version.plan.strategy, durationSeconds: version.plan.durationSeconds, clips: version.plan.clips.map((clip) => ({ id: clip.id, purpose: clip.purpose, assetId: clip.assetId, layout: clip.layout ?? "full", motion: clip.motion.type, region: clip.framing.region, transition: clip.transitionIn.type, recordStartSeconds: clip.recordStartSeconds, durationSeconds: clip.durationSeconds, texts: clip.overlays.map((overlay) => overlay.text) })) } : undefined,
      ...(needsSentences ? { sentences: buildSentences(Object.entries(project.transcripts).map(([materialId, transcript]) => ({ materialId, transcript }))).map((s) => ({ id: s.id, materialId: s.materialId, start: s.start, end: s.end, text: s.text })) } : {}),
      ...(sourcePreviews ? { sourcePreviews } : {}),
      ...(output ? { output } : {}),
    };
  }

  if (mode === "video_revise") {
    requireCondition(request.draft && typeof request.reason === "string", "Revisão de vídeo inválida");
    const { version } = await service.pilotVersion(scope, String(request.versionId));
    const next = await service.reviseWithDraft({ scope: scope, userId: actor.userId, projectId: version.projectId, fromVersionId: version.id, reason: request.reason, draft: request.draft });
    return { versionId: next.id, number: next.number };
  }

  if (mode === "video_report") {
    // Falha ou revisão manual de uma pauta de vídeo: um alerta por pauta (e-mail da plataforma).
    const detail = typeof request.detail === "string" ? redactSecrets(request.detail).replace(/[\u0000-\u001f]+/g, " ").slice(0, 600) : "";
    const body = `Marca: ${workspace.name}\nVídeo (Reels) da pauta ${String(request.idea ?? "").slice(0, 80)} não foi agendado e foi para revisão manual.${detail ? `\n${detail}` : ""}`;
    await db.query("select enqueue_platform_email_alert('publication_failed', $1, 'Vídeo do piloto em revisão', $2, $3)", [`editorial-video:${workspaceId}:${String(request.ideaId ?? date ?? "")}`.slice(0, 160), body, `/workspaces/${workspaceId}/ideias`]);
    return { reported: true };
  }

  requireCondition(mode === "video_schedule" || mode === "video_validate", "Operação de vídeo inválida");
  const idea = await c.editorialIdeaRepository.get(workspaceId, request.ideaId);
  requireCondition(idea?.status === "available" && idea.format === "video" && idea.updatedAt === request.updatedAt, "A pauta mudou durante a produção do vídeo");
  const { version, project } = await service.pilotVersion(scope, String(request.versionId));
  requireCondition(project.settings.origin?.ideaId === idea.id, "O vídeo não é desta pauta");
  requireCondition(version.status === "ready_for_review" && version.gate?.status === "ready_for_review" && version.outputKey && version.plan, "O vídeo não passou no controle de qualidade");
  // Trava: só segue o arquivo EXATO que foi revisado (hash conferido aqui, no backend).
  const bytes = await keyBytes(version.outputKey);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  requireCondition(typeof request.sha256 === "string" && request.sha256 === sha256, "O vídeo mudou depois da revisão — publicação bloqueada");
  requireCondition(version.plan.aspect === "9:16" && version.plan.durationSeconds >= 5 && version.plan.durationSeconds <= 90, "Vídeo fora do formato do Reels");
  const slot = request.slot;
  requireCondition(typeof slot === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(slot), "Horário do vídeo inválido");
  const options = await c.social.posts.composerOptions(scope);
  const selected = brandConfig.accounts.map((id) => options.find((account) => account.accountId === id));
  requireCondition(selected.every((account) => account?.publishable), "Conta social da marca indisponível");
  // Reels só nas redes cuja conta aceita o formato (ex.: Página do Facebook sem Reels habilitado fica de fora e é registrada).
  const reelAccounts = selected.filter((account) => account.formats.some((item) => item.format === "reel"));
  requireCondition(reelAccounts.some((account) => account.network === "instagram"), "O Instagram da marca não aceita Reels");
  const skippedNetworks = selected.filter((account) => !reelAccounts.includes(account)).map((account) => account.network);
  // Endereço pelo conteúdo (hash no nome): a mídia publicada nunca é trocada por outra versão.
  const key = `assets/${tenantId}/${workspaceId}/${idea.id}-video-${sha256.slice(0, 20)}.mp4`;
  const { url } = await c.objectStorage.put({ key, body: bytes, contentType: "video/mp4" });
  let coverUrl;
  if (version.posterKey) {
    const poster = await keyBytes(version.posterKey);
    coverUrl = (await c.objectStorage.put({ key: `assets/${tenantId}/${workspaceId}/${idea.id}-video-${sha256.slice(0, 20)}.jpg`, body: poster, contentType: "image/jpeg" })).url;
  }
  const media = [{ url, kind: "video", width: 1080, height: 1920, mimeType: "video/mp4", sizeBytes: bytes.length, durationSec: Math.round(version.plan.durationSeconds * 10) / 10, hasAudio: true, ...(coverUrl ? { coverUrl } : {}) }];
  const scopeRedo = typeof request.redoJobId === "string";
  const campaignCta = creative.presentation === "fashion_campaign" && idea.cta && !idea.caption.includes(idea.cta) ? idea.cta : undefined;
  const caption = campaignCta ? `${idea.caption}\n\n${campaignCta}` : idea.caption;
  const input = { ...scope, base: { caption, media }, destinations: reelAccounts.map((account) => ({ accountId: account.accountId, format: "reel" })) };
  const checks = await c.social.posts.validate(input);
  for (const check of checks) requireCondition(!check.issues.length && !check.warnings.length, `${check.network}: ${[...check.issues.map((issue) => issue.message), ...check.warnings].join(". ")}`);
  if (mode === "video_validate") return { validated: true, idea: idea.externalId, sha256, sizeBytes: bytes.length, durationSeconds: version.plan.durationSeconds, networks: checks.map((check) => check.network), skippedNetworks, format: "reel" };
  // Vídeo que o cliente já reprovou (mesmo arquivo, mesma legenda) nunca volta.
  const { rows: rejectedRows } = await db.query(`select p.id, p.source_artifacts->0->'payload'->>'videoSha256' as sha,
      (select d.caption from social_post_destinations d where d.publication_id=p.id order by d.created_at limit 1) as caption
    from publication_approval_requests q join publication_plans p on p.id=q.publication_id and p.tenant_id=q.tenant_id and p.workspace_id=q.workspace_id
    where q.tenant_id=$1 and q.workspace_id=$2 and q.decision='reject' and p.source_artifacts->0->'payload'->>'editorialIdeaId'=$3`, [tenantId, workspaceId, idea.id]);
  requireCondition(!rejectedRows.some((row) => row.sha === sha256), "Este é o mesmo vídeo que o cliente reprovou — publicação bloqueada.");
  let idempotencyKey = `${videoPrefix}:${slot}`;
  if (scopeRedo || request.onlyIdea) {
    const base = `${videoPrefix}:${slot}:refeita:${idea.id}`;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      idempotencyKey = attempt === 1 ? base : `${base}:${attempt}`;
      const found = await c.publicationRepository.getPlanByIdempotency({ ...scope, idempotencyKey: `social:${idempotencyKey}` });
      if (found?.state !== "cancelled") break;
    }
  }
  const existing = await c.publicationRepository.getPlanByIdempotency({ ...scope, idempotencyKey: `social:${idempotencyKey}` });
  if (existing && existing.state !== "cancelled") return { existing: videoPostSummary(await c.social.posts.get({ ...scope, postId: existing.id })) };
  const publishNow = request.publishNow === true;
  // Registro do motor (estratégia, composições, Quality Gate, revisão visual do Codex), limitado em tamanho.
  const recordText = redactSecrets(JSON.stringify({ strategy: version.plan.strategy, durationSeconds: version.plan.durationSeconds, layouts: version.plan.clips.map((clip) => clip.layout ?? "full"), gate: version.gate.status, review: request.review ?? null, trace: request.trace ?? null }));
  const videoRecord = { video: recordText.length < 60000 ? JSON.parse(recordText) : { strategy: version.plan.strategy, gate: version.gate.status } };
  const post = await c.social.posts.create({ ...input, actor, idempotencyKey, when: publishNow ? { mode: "now" } : { mode: "schedule", localDateTime: slot, timezone }, source: {
    artifacts: [{ artifactId: idea.id, artifactType: "video", schemaId: "social.post", schemaVersion: 1, checksum: sha256,
      payload: { editorialIdeaId: idea.id, externalId: idea.externalId, videoUrl: url, videoVersionId: version.id, videoProjectId: project.id, videoSha256: sha256,
        creative: videoRecord,
        ...(scopeRedo ? { redoJobId: request.redoJobId } : {}) } }],
  } });
  if (scopeRedo) {
    await db.query(`update publication_redo_requests set status='done', result_publication_id=$2, change_summary=$4, updated_at=now() where id=$1 and workspace_id=$3`,
      [request.redoJobId, post.id, workspaceId, typeof request.changeSummary === "string" ? request.changeSummary.slice(0, 300) : null]);
  }
  await db.query(`update editorial_ideas set status='approved',status_changed_at=now(),updated_at=now() where id=$1 and workspace_id=$2 and tenant_id=$3 and status='available'`, [idea.id, workspaceId, tenantId]);
  return { [publishNow ? "submitted" : "scheduled"]: videoPostSummary(post), idea: idea.externalId, slot, sha256, skippedNetworks };
}
// <<< RAMO DE VÍDEO (Reels) — fim do bloco autocontido

async function run() {
  const brandConfig = brands.get(workspaceId);
  requireCondition(brandConfig, "Workspace fora da automação editorial");
  const accounts = brandConfig.accounts;
  const workspace = await c.workspaceRepository.getById(workspaceId);
  requireCondition(workspace?.tenantId === tenantId && workspace.status === "active", "Workspace editorial indisponível");
  if (mode === "reconcile") {
    await reconcile();
    return { brand: workspace.name, reconciled: true };
  }
  if (mode === "claim_redo") return claimRedo();
  // Vídeo (Reels) a partir de pauta "video" do Bolsão: ramo próprio, sem tocar no fluxo de imagem/carrossel.
  if (typeof mode === "string" && mode.startsWith("video_")) return videoAction(workspace, brandConfig);
  // Consulta (só leitura): o que a marca já ensinou ao piloto.
  if (mode === "memory") return { brand: workspace.name, memory: memorySummary(await brandMemory()) };
  if (mode === "finish_redo") {
    requireCondition(typeof request.jobId === "string" && ["done", "failed"].includes(request.status), "Conclusão de refação inválida");
    await db.query(`update publication_redo_requests set status=$3, detail=$4, updated_at=now() where id=$1 and workspace_id=$2 and status='running'`,
      [request.jobId, workspaceId, request.status, typeof request.detail === "string" ? redactSecrets(request.detail).slice(0, 600) : null]);
    return { finished: true };
  }
  const slot = request.slot;
  requireCondition(/^\d{4}-\d{2}-\d{2}T(?:12|19):00$/.test(slot), "Horário editorial inválido");
  // Pauta refeita à mão (onlyIdea) tem chave própria: não ocupa nem bloqueia o horário regular.
  // Tentativa anterior cancelada (recusada no WhatsApp) não trava a próxima: usa a chave seguinte (:2, :3…).
  let idempotencyKey = `${prefix}:${slot}`;
  let existing = await c.publicationRepository.getPlanByIdempotency({ ...scope, idempotencyKey: `social:${idempotencyKey}` });
  if (request.onlyIdea) {
    const base = `${prefix}:${slot}:refeita:${String(request.onlyIdea).slice(0, 80)}`;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      idempotencyKey = attempt === 1 ? base : `${base}:${attempt}`;
      existing = await c.publicationRepository.getPlanByIdempotency({ ...scope, idempotencyKey: `social:${idempotencyKey}` });
      if (existing?.state !== "cancelled") break;
    }
  }
  if (existing) return { existing: summarizes(await c.social.posts.get({ ...scope, postId: existing.id })) };
  if (mode === "report_failure") {
    if (!request.code || !["codex_auth", "preparation", "quality_review"].includes(request.code)) throw new Error("Categoria de falha editorial inválida");
    const ideas = await c.editorialIdeaRepository.listByWorkspace(workspaceId);
    if (request.code !== "quality_review" && workspaceId !== cmkvWorkspaceId && !ideas.some(idea => idea.status === "available" && ["single_image", "carousel"].includes(idea.format)
      && (!idea.scheduledDate || idea.scheduledDate <= slot.slice(0, 10)))) return { reported: false };
    const detail = typeof request.detail === "string" ? redactSecrets(request.detail).replace(/[\u0000-\u001f]+/g, " ").slice(0, 600) : "";
    const cause = request.code === "codex_auth" ? "O Codex do servidor precisa ser autorizado novamente."
      : request.code === "quality_review" ? `Uma pauta foi encaminhada para revisão manual e não será publicada automaticamente.${detail ? `\n${detail}` : ""}`
      : "A automação não conseguiu preparar ou agendar a pauta para esse horário.";
    const localDate = slot.slice(0, 10).split("-").reverse().join("/");
    const body = `Marca: ${workspace.name}\nHorário: ${localDate} às ${slot.slice(11)} (Brasília)\n${cause}`;
    const dedupe = request.code === "quality_review" && request.ideaId ? `editorial-review:${workspaceId}:${String(request.ideaId).slice(0, 80)}` : `editorial:${workspaceId}:${slot}`;
    await db.query("select enqueue_platform_email_alert('publication_failed', $1, 'Falha na automação editorial', $2, $3)",
      [dedupe, body, `/workspaces/${workspaceId}/ideias`]);
    return { reported: true };
  }
  const actor = await actorForPublish();
  const options = await c.social.posts.composerOptions(scope);
  const selected = accounts.map(id => options.find(account => account.accountId === id));
  requireCondition(selected.every(account => account?.publishable), "Conta social da marca indisponível");

  if (mode === "select") {
    const allIdeas = await c.editorialIdeaRepository.listByWorkspace(workspaceId);
    const ideas = allIdeas.filter(idea => idea.status === "available" && (!idea.scheduledDate || idea.scheduledDate <= slot.slice(0,10)));
    const used = await db.query(`select source_artifacts->0->'payload'->>'editorialIdeaId' as id,
      source_artifacts->0->'payload'->'catalogProductCodes' as codes, source_artifacts->0->'payload'->'creative' as creative,
      source_artifacts->0->'payload'->'imageUrls'->>0 as image, state from publication_plans
      where tenant_id=$1 and workspace_id=$2 and idempotency_key like $3 order by created_at desc`, [tenantId,workspaceId,`social:${prefix}:%`]);
    // Publicação cancelada (recusada no WhatsApp ou sem resposta) devolve a pauta ao Bolsão — ela volta a ser
    // candidata. Antes (26/11/2026) qualquer plano contava como "usado" e a pauta devolvida nunca mais saía.
    const usedIds = new Set(used.rows.filter(row => row.state !== "cancelled").map(row => row.id));
    // Pautas na fila de revisão manual (reprovadas ou sem material) não voltam sozinhas para a automação.
    const reviewIds = new Set(Array.isArray(request.skipIdeaIds) ? request.skipIdeaIds.map(String) : []);
    // Pauta indicada pelo operador (id ou código externo): só ela é considerada.
    const only = request.onlyIdea ? String(request.onlyIdea) : undefined;
    // Pauta com refação aberta (reprovada no WhatsApp com motivo) só sai pela própria refação.
    const { rows: redoing } = await db.query(`select idea_id from publication_redo_requests where workspace_id=$1 and status in ('pending','running')`, [workspaceId]);
    const redoIds = new Set(redoing.map(row => row.idea_id));
    const eligible = ideas.filter(item => !usedIds.has(item.id) && !reviewIds.has(item.id) && ["single_image", "carousel"].includes(item.format)
      && (only ? item.id === only || item.externalId === only : !redoIds.has(item.id)));
    // Calendário inteligente: data marcada pelo cliente na frente; entre as demais, variedade em relação ao que
    // já foi ao ar ou está agendado perto do horário (categoria, abordagem, formato, assunto). Nada é descartado.
    const ranking = rankIdeasForSlot(eligible, { slot, recent: await nearbyPieces(allIdeas) });
    const candidates = ranking.map(entry => entry.idea).map(withTextOverride);
    // Refação: o escopo decide se a peça do catálogo muda (motivo falou do produto) ou fica a mesma.
    const redoScope = only && candidates[0] ? redoScopeFor(candidates[0]) : undefined;
    if (redoScope && Array.isArray(request.previousProducts)) {
      request.excludeProducts = redoScope.product ? request.previousProducts : [];
      request.keepProducts = redoScope.product ? [] : Array.isArray(request.previousVersionProducts) ? request.previousVersionProducts : [];
    }
    const calendar = ranking.slice(0, 3).map(entry => ({ idea: entry.idea.externalId, score: Number(entry.score.toFixed(2)), reasons: entry.reasons }));
    const creative = brandConfig.creative ?? { businessKind: "unknown" };
    const { rows: [brandRow] } = await db.query("select profile from brand_visual_profiles where workspace_id=$1", [workspaceId]);
    const photos = creative.businessKind === "physical_products" ? await catalogPhotos() : [];
    const context = {
      brandName: workspace.name, profile: brandRow?.profile, used: used.rows, photos, photosByUrl: new Map(photos.map(photo => [photo.url, photo])),
      requireRealScreen: creative.businessKind === "software" && Boolean(only) &&
        /\b(?:telas?|capturas?|prints?|interfaces?)\s+(?:(?:do|da|de)\s+\w+\s+)?(?:reais?|originais?|verdadeiras?)\b/i.test(String(request.redoReason ?? "").normalize("NFD").replace(/\p{M}/gu, "")),
      captures: creative.businessKind === "software" ? await libraryCaptures() : [], // Peça cancelada (reprovada no WhatsApp) nunca foi ao ar: não conta como repetição — senão a refação reprova
      // a tela que ficou igual à da versão reprovada (26/11/2026).
      history: await visualHistory(used.rows.filter(row => row.state !== "cancelled")),
      excludeProducts: Array.isArray(request.excludeProducts) ? request.excludeProducts.map(String) : [],
      // Refação que não criticou o produto: a mesma peça da versão anterior (o rodízio não troca o que estava certo).
      keepProducts: Array.isArray(request.keepProducts) ? request.keepProducts.map(String) : [],
      // Sem a memória (consulta falhou) o piloto segue como antes: ela só orienta, nunca é obrigatória.
      memory: await brandMemory().catch(() => undefined),
    };
    // Primeira pauta viável: as bloqueadas (falta referência obrigatória) ficam no Bolsão com a orientação.
    const blocked = [];
    const tryIdea = async (idea) => {
      let planned;
      try {
        planned = await planIdea(idea, creative, context);
      } catch (error) {
        // Referência que não carrega: esta pauta não segue (nunca gera sem o material); vai para revisão.
        blocked.push({ ideaId: idea.id, idea: idea.externalId, reason: "REFERENCE_LOAD_FAILED", guidance: [redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300)] });
        return undefined;
      }
      if (planned.blocked) { blocked.push({ ideaId: idea.id, idea: idea.externalId, mode: planned.plan.mode, reason: "REFERENCE_MISSING", guidance: planned.plan.blockers.filter(item => item.blocking).map(item => item.message) }); return undefined; }
      return { idea, brand: await brandFor(workspace, brandConfig, context.profile), plan: planned.plan, assets: planned.assets, trace: { references: planned.traced }, productCodes: planned.productCodes, history: context.history, archetypes: ARCHETYPES, blocked, calendar,
        ...(redoScope ? { redoScope: { text: redoScope.text, image: redoScope.image, caption: redoScope.caption, product: redoScope.product, logo: redoScope.logo, changed: redoScope.changed, kept: redoScope.kept } } : {}),
        ...(context.memory ? { memory: memorySummary(context.memory) } : {}) };
    };
    for (const idea of candidates.filter(item => !item.externalId.startsWith("CMKV-AUTO-"))) {
      const chosen = await tryIdea(idea);
      if (chosen) return chosen;
    }
    if (workspaceId === cmkvWorkspaceId && !only) {
      // CMKV sem pauta viável: cria (ou retoma) a pauta automática do horário, com fotos oficiais do catálogo.
      const { idea } = await selectCmkvIdea({ slot, ideas, candidates: candidates.filter(item => item.externalId.startsWith("CMKV-AUTO-")), used: used.rows, allowCreate: request.allowCreate });
      const chosen = idea && await tryIdea(idea);
      if (chosen) return chosen;
    }
    return { brand: workspace.name, empty: true, blocked, calendar, videoIdeas: ideas.filter(item => item.format === "video").length };
  }

  // Publicar na hora: recuperação da CMKV ou pauta refeita/indicada (passa pela aprovação da marca, quando ligada).
  const publishNow = mode === "publish" && (workspaceId === cmkvWorkspaceId || Boolean(request.onlyIdea));
  requireCondition(mode === "validate" || mode === "schedule" || publishNow, "Operação editorial inválida");
  const idea = await c.editorialIdeaRepository.get(workspaceId, request.ideaId);
  requireCondition(idea?.status === "available" && idea.updatedAt === request.updatedAt, "A pauta mudou durante a geração");
  // Produtos efetivamente usados na arte (rodízio do catálogo) e o registro do motor criativo
  // (modo, arquétipos, referências por hash, veredito do Quality Gate, impressões visuais).
  const catalogProductCodes = Array.isArray(request.productCodes) && request.productCodes.length ? request.productCodes.map(String).slice(0, 10) : undefined;
  // Registro limitado em tamanho sem quebrar o JSON: se passar do limite, mantém tudo menos a lista de operações.
  const creativeText = request.creative ? redactSecrets(JSON.stringify(request.creative)) : undefined;
  const creativeRecord = creativeText ? JSON.parse(creativeText.length <= 60000 ? creativeText
    : redactSecrets(JSON.stringify({ ...request.creative, trace: { ...request.creative.trace, operations: [], operationsOmitted: true } }))) : undefined;
  const format = idea.format === "carousel" ? "carousel" : "feed_image";
  const count = format === "carousel" ? idea.carouselScript?.length : 1;
  requireCondition(count && request.images.length === count, "Quantidade de artes diferente do roteiro da pauta");
  // Trava: só segue para o agendador/publicação a imagem exata que o Quality Gate aprovou, tela por tela.
  if (mode === "schedule" || mode === "publish") {
    const guard = verifyApprovedArt(request.images.map(image => Buffer.from(image, "base64")), request.creative?.approvals);
    requireCondition(guard.ok, guard.ok ? "" : guard.reason);
  }
  requireCondition(selected.every(account => account.formats.some(item => item.format === format && item.maxItems >= count)), "Formato da pauta incompatível com uma das redes da marca");
  const media = [];
  for (const png of request.images) {
    const body = Buffer.from(png, "base64");
    const { width, height, format: codec } = await sharp(body).metadata();
    requireCondition(width === 1080 && height === 1350 && codec === "jpeg", "A arte final deve ser JPEG 1080 x 1350 (4:5)");
    const checksum = createHash("sha256").update(body).digest("hex");
    // The regular assets path is signed for Conteúdos and for external provider downloads.
    const key = `assets/${tenantId}/${workspaceId}/${idea.id}-${checksum.slice(0,20)}.jpg`;
    const { url } = await c.objectStorage.put({ key, body, contentType: "image/jpeg" });
    media.push({ url, kind: "image", width, height, mimeType: "image/jpeg", sizeBytes: body.length });
  }
  // Refação: a legenda reescrita pelo Codex substitui a da pauta só quando o motivo falou da legenda.
  const scope = typeof request.redoJobId === "string" ? redoScopeFor(idea) : undefined;
  const captionAllowed = !scope || scope.caption;
  const baseCaption = captionAllowed && typeof request.captionOverride === "string" && request.captionOverride.trim() ? request.captionOverride.trim().slice(0, 2200) : idea.caption;
  const campaignCta = brandConfig.creative?.presentation === "fashion_campaign" && idea.cta && !baseCaption.includes(idea.cta) ? idea.cta : undefined;
  const caption = campaignCta ? `${baseCaption}\n\n${campaignCta}` : baseCaption;
  const input = { ...scope, base: { caption, media }, destinations: accounts.map(accountId => ({ accountId, format })) };
  const checks = await c.social.posts.validate(input);
  for (const check of checks) requireCondition(!check.issues.length && !check.warnings.length, `${check.network}: ${[...check.issues.map(issue => issue.message), ...check.warnings].join(". ")}`);
  if (mode === "validate") return { validated: true, idea: idea.externalId, screens: media.length, networks: checks.map(check => check.network) };
  // Nenhuma peça reprovada volta: a mesma sequência de imagens com a mesma legenda de uma versão que o cliente
  // reprovou é bloqueada aqui, no backend, para qualquer origem (piloto, refação, recuperação).
  const imageSha256 = request.images.map(image => createHash("sha256").update(Buffer.from(image, "base64")).digest("hex"));
  const { rows: rejectedRows } = await db.query(`select p.id, p.source_artifacts->0->'payload'->'creative'->'approvals' as approvals,
      (select d.caption from social_post_destinations d where d.publication_id=p.id order by d.created_at limit 1) as caption
    from publication_approval_requests q join publication_plans p on p.id=q.publication_id and p.tenant_id=q.tenant_id and p.workspace_id=q.workspace_id
    where q.tenant_id=$1 and q.workspace_id=$2 and q.decision='reject' and p.source_artifacts->0->'payload'->>'editorialIdeaId'=$3`, [tenantId, workspaceId, idea.id]);
  const rejectedPieces = rejectedRows.map(row => ({ id: row.id, caption: row.caption ?? "", imageSha256: Array.isArray(row.approvals) ? row.approvals.map(item => String(item?.imageSha256 ?? "")) : [] }));
  requireCondition(!matchesRejectedPiece({ imageSha256, caption }, rejectedPieces), "Esta é a mesma peça que o cliente reprovou (mesmas imagens e mesma legenda) — publicação bloqueada.");
  if (scope) {
    // Refação direcionada: toda tela que o motivo criticou precisa ter mudado em relação à versão reprovada.
    const { rows: [job] } = await db.query("select publication_id from publication_redo_requests where id=$1 and workspace_id=$2", [request.redoJobId, workspaceId]);
    const previous = rejectedPieces.find(piece => piece.id === job?.publication_id);
    const violations = previous ? redoScopeViolations(scope, previous.imageSha256, imageSha256) : [];
    requireCondition(!violations.length, violations.join(" "));
    if (!scope.text.length && !scope.image.length && !scope.logo && caption.trim() === (previous?.caption ?? "").trim()) {
      throw new Error("A refação não mudou nada do que foi criticado.");
    }
  }
  // Bases aprovadas (imagem antes do texto) das telas geradas pela IA: uma refação futura recompõe sobre elas
  // as telas que o cliente não criticar, sem gerar de novo.
  if (creativeRecord && Array.isArray(request.bases)) {
    const screens = [];
    for (const [index, entry] of request.bases.slice(0, count).entries()) {
      if (!entry || typeof entry.data !== "string") { screens.push(null); continue; }
      const jpeg = await sharp(Buffer.from(entry.data, "base64")).rotate().jpeg({ quality: 92 }).toBuffer();
      const key = `assets/${tenantId}/${workspaceId}/bases/${idea.id}-${index + 1}-${createHash("sha256").update(jpeg).digest("hex").slice(0, 20)}.jpg`;
      const { url } = await c.objectStorage.put({ key, body: jpeg, contentType: "image/jpeg" });
      const pick = (value, allowed) => (allowed.includes(value) ? value : undefined);
      screens.push({ baseUrl: url, layout: pick(entry.layout, ["top", "left", "bottom"]), logoPlacement: pick(entry.logoPlacement, ["top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"]),
        protectedAreas: Array.isArray(entry.protectedAreas) ? entry.protectedAreas.slice(0, 12) : [],
        ...(entry.aiReview?.verdict === "approve" ? { aiReview: { verdict: "approve" } } : {}), ...(entry.sceneReview?.verdict === "approve" ? { sceneReview: { verdict: "approve" } } : {}) });
    }
    creativeRecord.screens = screens;
  }
  const seen = await db.query(`select count(*)::int as total from social_post_destinations d join publication_targets t on t.id=d.target_id
    where d.tenant_id=$1 and d.workspace_id=$2 and t.status not in ('cancelled','failed') and d.caption=$3 and d.created_at >= $4`, [tenantId, workspaceId, caption, idea.createdAt]);
  requireCondition(seen.rows[0].total === 0, "Já existe uma publicação com a mesma legenda desta pauta");
  const when = publishNow ? { mode: "now" } : { mode: "schedule", localDateTime: slot, timezone };
  const post = await c.social.posts.create({ ...input, actor, idempotencyKey, when, source: {
    artifacts: [{ artifactId: idea.id, artifactType: "image", schemaId: "social.post", schemaVersion: 1,
      checksum: createHash("sha256").update(media.map(item => item.url).join("\n")).digest("hex"),
      payload: { editorialIdeaId: idea.id, externalId: idea.externalId, imageUrls: media.map(item => item.url),
        ...(catalogProductCodes ? { catalogProductCodes } : {}), ...(creativeRecord ? { creative: creativeRecord } : {}),
        ...(typeof request.redoJobId === "string" ? { redoJobId: request.redoJobId } : {}) } }],
  } });
  if (typeof request.redoJobId === "string") {
    // O que mudou e o que ficou: vai na mensagem de aprovação da nova versão.
    const summary = scope ? `Mudou: ${scope.changed}.${scope.kept ? ` Mantive: ${scope.kept}.` : ""}` : null;
    await db.query(`update publication_redo_requests set status='done', result_publication_id=$2, change_summary=$4, updated_at=now() where id=$1 and workspace_id=$3`, [request.redoJobId, post.id, workspaceId, summary]);
  }
  await db.query(`update editorial_ideas set status=$4,status_changed_at=now(),updated_at=now()
    where id=$1 and workspace_id=$2 and tenant_id=$3 and status='available'`,
  [idea.id, workspaceId, tenantId, publishedOnBoth(post) ? "published" : "approved"]);
  // Refação que deu certo: o texto reescrito pelo Codex fica gravado na pauta do Bolsão — se esta versão também
  // for cancelada, a pauta não volta com a frase reprovada (26/11/2026: "Peito ou costas?" voltaria às 19h).
  if (typeof request.redoJobId === "string" && request.textOverride) {
    const rewritten = withTextOverride(idea);
    const captionOverride = captionAllowed && typeof request.captionOverride === "string" && request.captionOverride.trim() ? request.captionOverride.trim().slice(0, 2200) : null;
    if (rewritten !== idea || captionOverride) {
      await db.query(`update editorial_ideas set key_message=$4, creative_prompt=coalesce($5, creative_prompt), carousel_script=coalesce($6::jsonb, carousel_script), caption=coalesce($7, caption), updated_at=now()
        where id=$1 and workspace_id=$2 and tenant_id=$3`,
      [idea.id, workspaceId, tenantId, rewritten.keyMessage, rewritten.creativePrompt ?? null, rewritten !== idea && rewritten.carouselScript ? JSON.stringify(rewritten.carouselScript) : null, captionOverride]);
    }
  }
  return { [publishNow ? "submitted" : "scheduled"]: summarizes(post), idea: idea.externalId, slot };
}

try {
  console.log(JSON.stringify(await run()));
} catch (error) {
  console.error(error.message.replace(/([?&]sig=)[^&\s]+/g, "$1[redacted]"));
  process.exitCode = 1;
} finally {
  await db?.end();
  await c.identity?.pool?.end().catch(() => undefined);
}
