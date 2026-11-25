import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildApiContainer } from "./dist/interfaces/api/di/container.js";
import { loadApiConfig } from "./dist/interfaces/api/config/api-config.js";
import { resolveEffectiveEntitlements } from "./dist/application/billing/entitlement-use-cases.js";
import { parseManualEditorialIdea } from "./dist/domain/editorial/editorial-idea.model.js";
import { hasPermission } from "./dist/domain/identity/identity.model.js";
import { classifyObjectKeyOwner, parseOwnedObjectUrl, signForExternalPublication } from "./dist/shared/utils/object-url-signing.js";

// Loaded on stdin from the host, in the Vorix API container. The renderer has no DB access.
const tenantId = "tenant-vorix";
const cmkvWorkspaceId = "workspace-cee-prelaunch-mv47cmfh";
// Estampas selecionadas do catálogo da CMKV para pautas criadas automaticamente.
const cmkvEditorialProducts = ["000033", "000035", "000037", "000039", "000043", "000044", "000047", "000048"];
// Por workspace: contas IG+FB e, opcionalmente, como aplicar a logo nesta marca.
// logo.placement: top_left|top_center|top_right|bottom_left|bottom_center|bottom_right (fixa a posição);
// logo.treatment: auto|none|shadow|halo|plate (auto = sem caixa, sombra suave só se faltar contraste);
// logo.scale: 0.6–1.6. Sem configuração, vale o que as notas do Perfil da Marca dizem, senão o automático.
const brands = new Map([
  ["workspace-mwmumsxd-fmvh3h", { accounts: ["soc-mwmvbruu-sz6rkd12", "soc-mwmvbryk-dthxstki"], logo: {} }],
  ["workspace-mscc9pi2-jkvwbo", { accounts: ["soc-mwk1mgoy-xhcr2duq", "soc-mwk1my6f-lbham9eo"], logo: {} }],
  ["workspace-mwmu8kgf-uhe66l", { accounts: ["soc-mwmu9f8k-kj2covm2", "soc-mwmugp3j-hwva5nax"], logo: {} }],
  [cmkvWorkspaceId, { accounts: ["soc-mwkwg3lc-zj3g4xyk", "soc-mwmuj7ud-3py2gdyo"], logo: {} }],
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

async function brandFor(workspace, config) {
  const { rows } = await db.query("select profile from brand_visual_profiles where workspace_id=$1", [workspaceId]);
  const profile = rows[0]?.profile;
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

function compareIdeas(a, b) {
  return (a.scheduledDate ?? "9999").localeCompare(b.scheduledDate ?? "9999")
    || Number(b.priority === "high") - Number(a.priority === "high")
    || (a.suggestedDate ?? "9999").localeCompare(b.suggestedDate ?? "9999")
    || a.createdAt.localeCompare(b.createdAt) || a.externalId.localeCompare(b.externalId);
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
  const lastSlot = code => previous.findIndex(item => item.codes?.includes(code));
  const product = [...products].sort(([a], [b]) => {
    return lastSlot(b) - lastSlot(a) || a.localeCompare(b);
  }).find(([, photos]) => photos.length >= 2);
  requireCondition(product, "Catálogo da CMKV sem duas fotos de cores distintas dos modelos editoriais");
  const [code, photos] = product;
  const uses = previous.filter(item => item.codes?.includes(code)).length;
  const pair = [photos[uses % photos.length], photos[(uses + 1) % photos.length]];
  const colors = pair.map(photo => photo.color.toLocaleLowerCase("pt-BR"));
  const themes = [
    ["Uma estampa, duas escolhas", "Qual cor você usaria com jeans?"],
    ["Dois jeitos de usar a mesma estampa", "Qual cor combina mais com seu dia a dia?"],
    ["O look começa pela cor", "Qual versão você colocaria no próximo look?"],
  ];
  const [title, question] = themes[uses % themes.length];
  return parseManualEditorialIdea({
    title, format: "single_image", category: "Vitrine CMKV", approach: "Comparação de cores",
    keyMessage: `${title}\n\n${colors.join(" ou ")}?`,
    caption: `${question} Veja o modelo ${code} da CMKV em ${colors.join(" e ")} e confira as opções no catálogo.\n\n#CMKVWears #CamisetaEstampada #ModaCasual`,
    cta: "Confira no catálogo", suggestedDate: slot.slice(0, 10),
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
  const products = new Map(cmkvEditorialProducts.map(code => [code, []]));
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
  const slot = request.slot;
  requireCondition(/^\d{4}-\d{2}-\d{2}T(?:12|19):00$/.test(slot), "Horário editorial inválido");
  const idempotencyKey = `${prefix}:${slot}`;
  const existing = await c.publicationRepository.getPlanByIdempotency({ ...scope, idempotencyKey: `social:${idempotencyKey}` });
  if (existing) return { existing: summarizes(await c.social.posts.get({ ...scope, postId: existing.id })) };
  if (mode === "report_failure") {
    if (!request.code || !["codex_auth", "preparation"].includes(request.code)) throw new Error("Categoria de falha editorial inválida");
    const ideas = await c.editorialIdeaRepository.listByWorkspace(workspaceId);
    if (workspaceId !== cmkvWorkspaceId && !ideas.some(idea => idea.status === "available" && ["single_image", "carousel"].includes(idea.format)
      && (!idea.scheduledDate || idea.scheduledDate <= slot.slice(0, 10)))) return { reported: false };
    const cause = request.code === "codex_auth" ? "O Codex do servidor precisa ser autorizado novamente."
      : "A automação não conseguiu preparar ou agendar a pauta para esse horário.";
    const localDate = slot.slice(0, 10).split("-").reverse().join("/");
    const body = `Marca: ${workspace.name}\nHorário: ${localDate} às ${slot.slice(11)} (Brasília)\n${cause}`;
    await db.query("select enqueue_platform_email_alert('publication_failed', $1, 'Falha na automação editorial', $2, $3)",
      [`editorial:${workspaceId}:${slot}`, body, `/workspaces/${workspaceId}/ideias`]);
    return { reported: true };
  }
  const actor = await actorForPublish();
  const options = await c.social.posts.composerOptions(scope);
  const selected = accounts.map(id => options.find(account => account.accountId === id));
  requireCondition(selected.every(account => account?.publishable), "Conta social da marca indisponível");

  if (mode === "select") {
    const ideas = (await c.editorialIdeaRepository.listByWorkspace(workspaceId)).filter(idea => idea.status === "available" && (!idea.scheduledDate || idea.scheduledDate <= slot.slice(0,10)));
    const used = await db.query(`select source_artifacts->0->'payload'->>'editorialIdeaId' as id,
      source_artifacts->0->'payload'->'catalogProductCodes' as codes from publication_plans
      where tenant_id=$1 and workspace_id=$2 and idempotency_key like $3 order by created_at desc`, [tenantId,workspaceId,`social:${prefix}:%`]);
    const usedIds = new Set(used.rows.map(row => row.id));
    const candidates = ideas.filter(item => !usedIds.has(item.id) && ["single_image", "carousel"].includes(item.format)).sort(compareIdeas);
    if (workspaceId === cmkvWorkspaceId) {
      const { idea, catalogPhotos } = await selectCmkvIdea({ slot, ideas, candidates, used: used.rows, allowCreate: request.allowCreate });
      if (!idea) return { brand: workspace.name, empty: true };
      const photos = await Promise.all(catalogPhotos.map(async photo => ({
        color: photo.color, data: (await ownedImage(photo.url)).toString("base64"),
      })));
      return { idea, brand: await brandFor(workspace, brandConfig), catalogPhotos: photos };
    }
    const idea = candidates[0];
    if (!idea) return { brand: workspace.name, empty: true, videoIdeas: ideas.filter(item => item.format === "video").length };
    const references = await Promise.all((idea.referenceImages ?? []).map(async url => (await ownedImage(url)).toString("base64")));
    return { idea, brand: await brandFor(workspace, brandConfig), references };
  }

  const publishNow = mode === "publish" && workspaceId === cmkvWorkspaceId;
  requireCondition(mode === "validate" || mode === "schedule" || publishNow, "Operação editorial inválida");
  const idea = await c.editorialIdeaRepository.get(workspaceId, request.ideaId);
  requireCondition(idea?.status === "available" && idea.updatedAt === request.updatedAt, "A pauta mudou durante a geração");
  let catalogProductCodes;
  if (workspaceId === cmkvWorkspaceId) {
    const photos = await cmkvCatalogPhotos();
    const sources = cmkvIdeaPhotos(idea, new Map(photos.map(photo => [photo.url, photo])));
    requireCondition(sources, "As fotos oficiais da pauta da CMKV mudaram durante a preparação");
    catalogProductCodes = [...new Set(sources.map(photo => photo.code))];
  }
  const format = idea.format === "carousel" ? "carousel" : "feed_image";
  const count = format === "carousel" ? idea.carouselScript?.length : 1;
  requireCondition(count && request.images.length === count, "Quantidade de artes diferente do roteiro da pauta");
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
  const input = { ...scope, base: { caption: idea.caption, media }, destinations: accounts.map(accountId => ({ accountId, format })) };
  const checks = await c.social.posts.validate(input);
  for (const check of checks) requireCondition(!check.issues.length && !check.warnings.length, `${check.network}: ${[...check.issues.map(issue => issue.message), ...check.warnings].join(". ")}`);
  if (mode === "validate") return { validated: true, idea: idea.externalId, screens: media.length, networks: checks.map(check => check.network) };
  const seen = await db.query(`select count(*)::int as total from social_post_destinations d join publication_targets t on t.id=d.target_id
    where d.tenant_id=$1 and d.workspace_id=$2 and t.status not in ('cancelled','failed') and d.caption=$3 and d.created_at >= $4`, [tenantId, workspaceId, idea.caption, idea.createdAt]);
  requireCondition(seen.rows[0].total === 0, "Já existe uma publicação com a mesma legenda desta pauta");
  const when = publishNow ? { mode: "now" } : { mode: "schedule", localDateTime: slot, timezone };
  const post = await c.social.posts.create({ ...input, actor, idempotencyKey, when, source: {
    artifacts: [{ artifactId: idea.id, artifactType: "image", schemaId: "social.post", schemaVersion: 1,
      checksum: createHash("sha256").update(media.map(item => item.url).join("\n")).digest("hex"),
      payload: { editorialIdeaId: idea.id, externalId: idea.externalId, imageUrls: media.map(item => item.url),
        ...(catalogProductCodes ? { catalogProductCodes } : {}) } }],
  } });
  await db.query(`update editorial_ideas set status=$4,status_changed_at=now(),updated_at=now()
    where id=$1 and workspace_id=$2 and tenant_id=$3 and status='available'`,
  [idea.id, workspaceId, tenantId, publishedOnBoth(post) ? "published" : "approved"]);
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
