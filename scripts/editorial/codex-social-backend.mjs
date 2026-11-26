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
  ["workspace-mscc9pi2-jkvwbo", { accounts: ["soc-mwk1mgoy-xhcr2duq", "soc-mwk1my6f-lbham9eo"], logo: {}, creative: { businessKind: "software", features: VORIX_FEATURES } }],
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
    for (const capture of context.captures) { libraryCandidates.push(capture.candidate); urls.set(capture.candidate.id, capture.url); captureMeta.set(capture.candidate.id, capture.meta); }
  }
  // Produtos liberados para pauta automática, em rodízio: só o primeiro com foto utilizável é medido.
  const editorialProducts = [];
  if (creative.businessKind === "physical_products" && creative.products?.length) {
    // Rodízio, reordenado pelo assunto da pauta. Nenhuma peça atende a ocasião pedida: mede a primeira do
    // rodízio mesmo assim — o planejador recusa e registra o motivo (a pauta vai para revisão).
    // Refação pedida por causa do produto: as peças das versões reprovadas saem do rodízio (se sobrar alguma).
    const allowed = creative.products.filter(code => !context.excludeProducts?.includes(code));
    // Memória da marca: peça reprovada por produto em pautas diferentes vai para o fim do rodízio (não é bloqueada).
    const rotated = applyProductMemory(rotationOrder(allowed.length ? allowed : creative.products, context.used), context.memory).map(code => ({ code, themes: creative.productThemes?.[code] ?? [] }));
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
    workspaceId, brandName: context.brandName, brandIdentity: context.profile?.identity, presentation: creative.presentation, businessKind: creative.businessKind, softwareFeatures: creative.features, idea,
    ideaReferences, libraryCaptures: libraryCandidates, editorialProducts, history: context.history, allowAi: true, avoidArchetypes: creative.avoidArchetypes,
    ...(context.memory ? { memory: { archetypeBias: context.memory.archetypeBias, guidance: memoryGuidance(context.memory, "image") } } : {}),
  });
  const assets = {};
  const traced = [];
  for (const reference of plan.resolved.transmitted) {
    const url = urls.get(reference.id);
    if (!url) continue;
    const bytes = reference.role === "software_capture" ? await ownedBytes(url) : await sharp(await ownedBytes(url)).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(bytes).metadata();
    assets[reference.id] = { data: bytes.toString("base64"), ...(captureMeta.get(reference.id) ?? {}) };
    traced.push({ id: reference.id, source: reference.source, role: reference.role, sha256: sha256Prefix(bytes), bytes: bytes.length, width: meta.width, height: meta.height, ...(reference.productCode ? { productCode: reference.productCode, variantLabel: reference.variantLabel } : {}) });
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

/** Texto reescrito na refação (título/subtítulo/telas): aplicado só na pauta refeita, sem alterar o Bolsão. */
function withTextOverride(idea) {
  const override = request.textOverride;
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
  return { job: {
    id: job.id, reason: job.reason, attempt: job.attempt, slot: job.slot, previousImage, memory: memoryGuidance(memory, "redo"),
    previousArchetypes: Array.isArray(plan?.payload?.creative?.archetypes) ? plan.payload.creative.archetypes.map(String) : [],
    reasons: history.map(row => row.reason), previousProducts: [...new Set(history.flatMap(row => Array.isArray(row.codes) ? row.codes.map(String) : []))],
    idea: { id: idea.id, externalId: idea.externalId, title: idea.title, format: idea.format, category: idea.category, keyMessage: idea.keyMessage, caption: idea.caption,
      cta: idea.cta, visualDirection: idea.visualDirection, screens: screensForIdea(idea), carouselScript: idea.carouselScript ?? [] },
  } };
}

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
    const calendar = ranking.slice(0, 3).map(entry => ({ idea: entry.idea.externalId, score: Number(entry.score.toFixed(2)), reasons: entry.reasons }));
    const creative = brandConfig.creative ?? { businessKind: "unknown" };
    const { rows: [brandRow] } = await db.query("select profile from brand_visual_profiles where workspace_id=$1", [workspaceId]);
    const photos = creative.businessKind === "physical_products" ? await catalogPhotos() : [];
    const context = {
      brandName: workspace.name, profile: brandRow?.profile, used: used.rows, photos, photosByUrl: new Map(photos.map(photo => [photo.url, photo])),
      captures: creative.businessKind === "software" ? await libraryCaptures() : [], // Peça cancelada (reprovada no WhatsApp) nunca foi ao ar: não conta como repetição — senão a refação reprova
      // a tela que ficou igual à da versão reprovada (26/11/2026).
      history: await visualHistory(used.rows.filter(row => row.state !== "cancelled")),
      excludeProducts: Array.isArray(request.excludeProducts) ? request.excludeProducts.map(String) : [],
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
  // Refação: a legenda reescrita pelo Codex (quando o motivo falava dela) substitui a da pauta.
  const baseCaption = typeof request.captionOverride === "string" && request.captionOverride.trim() ? request.captionOverride.trim().slice(0, 2200) : idea.caption;
  const campaignCta = brandConfig.creative?.presentation === "fashion_campaign" && idea.cta && !baseCaption.includes(idea.cta) ? idea.cta : undefined;
  const caption = campaignCta ? `${baseCaption}\n\n${campaignCta}` : baseCaption;
  const input = { ...scope, base: { caption, media }, destinations: accounts.map(accountId => ({ accountId, format })) };
  const checks = await c.social.posts.validate(input);
  for (const check of checks) requireCondition(!check.issues.length && !check.warnings.length, `${check.network}: ${[...check.issues.map(issue => issue.message), ...check.warnings].join(". ")}`);
  if (mode === "validate") return { validated: true, idea: idea.externalId, screens: media.length, networks: checks.map(check => check.network) };
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
    await db.query(`update publication_redo_requests set status='done', result_publication_id=$2, updated_at=now() where id=$1 and workspace_id=$3`, [request.redoJobId, post.id, workspaceId]);
  }
  await db.query(`update editorial_ideas set status=$4,status_changed_at=now(),updated_at=now()
    where id=$1 and workspace_id=$2 and tenant_id=$3 and status='available'`,
  [idea.id, workspaceId, tenantId, publishedOnBoth(post) ? "published" : "approved"]);
  // Refação que deu certo: o texto reescrito pelo Codex fica gravado na pauta do Bolsão — se esta versão também
  // for cancelada, a pauta não volta com a frase reprovada (26/11/2026: "Peito ou costas?" voltaria às 19h).
  if (typeof request.redoJobId === "string" && request.textOverride) {
    const rewritten = withTextOverride(idea);
    const captionOverride = typeof request.captionOverride === "string" && request.captionOverride.trim() ? request.captionOverride.trim().slice(0, 2200) : null;
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
