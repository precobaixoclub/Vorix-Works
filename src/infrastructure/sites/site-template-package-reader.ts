import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import postcss, { CssSyntaxError, type Root } from "postcss";
import sharp from "sharp";
import { z } from "zod";
import {
  ALLOWED_ATTRIBUTES, ALLOWED_TAGS, FIELD_ELEMENTS, NATIVE_SECTIONS, TEMPLATED_SECTIONS, TEMPLATE_PACKAGE_FORMAT, TEMPLATE_PACKAGE_FORMAT_VERSION, TEMPLATE_PACKAGE_LIMITS, VOID_TAGS, safeTemplateHref,
  type ImportedTemplatePackage, type ItemField, type SectionField, type TemplateIssue, type TemplateIssueCode, type TemplateNode, type TemplateReport, type TemplateSampleBlock, type TemplateSection,
} from "../../domain/sites/site-template-package.js";

/**
 * Lê e valida um Pacote de Modelo Vorix (.zip). Nada é gravado durante a validação: as imagens
 * ficam como `vorix-asset:<caminho>` e só são enviadas ao armazenamento (`store`) se o pacote
 * inteiro estiver correto. Qualquer erro bloqueia a importação; avisos não.
 */
export type TemplateAssetStore = (asset: { path: string; body: Buffer; contentType: string }) => Promise<string>;

const PLACEHOLDER = "vorix-asset:";
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i;
const SCOPE = ".tenant-site-imported";
const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\.gitkeep$)/;
const DOCUMENT_FILES = /^(readme|license|licen[cç]a|changelog)(\.[a-z]+)?$/i;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "use uma cor no formato #RRGGBB");
const font = z.enum(["modern", "classic", "rounded", "editorial"]);
const themeSchema = z.object({
  primary: hex.optional(), secondary: hex.optional(), background: hex.optional(), foreground: hex.optional(), surface: hex.optional(),
  headerBackground: hex.optional(), footerBackground: hex.optional(), footerForeground: hex.optional(),
  bodyFont: font.optional(), headingFont: font.optional(), fontSize: z.enum(["normal", "large"]).optional(),
  headerLayout: z.enum(["split", "center", "compact"]).optional(), buttonStyle: z.enum(["rounded", "pill", "square"]).optional(),
  rounded: z.boolean().optional(), contentWidth: z.enum(["standard", "wide"]).optional(), sectionSpacing: z.enum(["compact", "comfortable", "spacious"]).optional(),
}).strict();
const sectionEntry = z.object({
  type: z.string().min(1).max(40), file: z.string().max(200).optional(),
  title: z.string().max(200).optional(), text: z.string().max(2000).optional(),
  videoUrl: z.string().max(500).optional(),
  /** Só no catálogo: quais produtos a seção mostra (ver documentação). */
  source: z.enum(["all", "featured", "sale", "category"]).optional(), category: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use o endereço da categoria (ex.: camisetas)").max(120).optional(), limit: z.number().int().min(1).max(48).optional(),
  images: z.array(z.object({ file: z.string().max(200), alt: z.string().max(200).default("") }).strict()).max(24).optional(),
}).strict();
const manifestSchema = z.object({
  format: z.string(), formatVersion: z.number(),
  name: z.string().trim().min(1, "informe o nome do modelo").max(80), version: z.string().trim().min(1, "informe a versão (ex.: 1.0.0)").max(20),
  author: z.string().max(80).optional(), description: z.string().max(300).optional(),
  preview: z.string().max(200).optional(), theme: z.string().max(200).optional(), styles: z.string().max(200).optional(),
  navigation: z.array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().max(500) }).strict()).max(8).optional(),
  home: z.array(sectionEntry),
  pages: z.array(z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use letras minúsculas, números e hífen"), title: z.string().trim().min(1).max(160), sections: z.array(sectionEntry) }).strict()).optional(),
}).strict();
type SectionEntry = z.infer<typeof sectionEntry>;

type Dom = { type: string; name?: string; data?: string; attribs?: Record<string, string>; children?: Dom[]; sourceCodeLocation?: { startLine?: number } | null };

class Collector {
  readonly errors: TemplateIssue[] = [];
  readonly warnings: TemplateIssue[] = [];
  error(code: TemplateIssueCode, message: string, hint?: string, file?: string, line?: number) { this.errors.push({ code, severity: "error", message, hint, file, line }); }
  warn(code: TemplateIssueCode, message: string, hint?: string, file?: string, line?: number) { this.warnings.push({ code, severity: "warning", message, hint, file, line }); }
}

export async function readSiteTemplatePackage(zip: Buffer, store?: TemplateAssetStore): Promise<{ report: TemplateReport; package?: ImportedTemplatePackage }> {
  const issues = new Collector();
  const finish = (summary: TemplateReport["summary"], pkg?: ImportedTemplatePackage) => ({ report: { ok: issues.errors.length === 0, errors: issues.errors, warnings: issues.warnings, summary }, package: issues.errors.length ? undefined : pkg });
  const empty = { files: 0, sections: 0, pages: 0, assets: 0 };

  if (zip.length > TEMPLATE_PACKAGE_LIMITS.zipBytes) { issues.error("PACKAGE_TOO_LARGE", `O pacote tem ${mb(zip.length)}; o limite é ${mb(TEMPLATE_PACKAGE_LIMITS.zipBytes)}.`, "Reduza as imagens (até 2400 px e em WEBP ou JPG costuma bastar) e remova arquivos que o modelo não usa."); return finish(empty); }
  let entries: AdmZip.IZipEntry[];
  try { entries = new AdmZip(zip).getEntries(); } catch { issues.error("PACKAGE_INVALID_ZIP", "Não foi possível abrir o arquivo como .zip.", "Compacte a pasta do modelo em formato ZIP (sem senha) e envie de novo."); return finish(empty); }

  // Arquivos: caminho normalizado → conteúdo (lido sob demanda). Uma pasta raiz única é ignorada.
  const raw = entries.filter((entry) => !entry.isDirectory && !IGNORED.test(entry.entryName));
  if (raw.length > TEMPLATE_PACKAGE_LIMITS.files) { issues.error("PACKAGE_TOO_MANY_FILES", `O pacote tem ${raw.length} arquivos; o limite é ${TEMPLATE_PACKAGE_LIMITS.files}.`, "Envie só os arquivos usados pelo modelo."); return finish(empty); }
  const unpacked = raw.reduce((sum, entry) => sum + entry.header.size, 0);
  if (unpacked > TEMPLATE_PACKAGE_LIMITS.unpackedBytes) { issues.error("PACKAGE_TOO_LARGE", `Descompactado, o pacote tem ${mb(unpacked)}; o limite é ${mb(TEMPLATE_PACKAGE_LIMITS.unpackedBytes)}.`, "Reduza as imagens e remova arquivos não usados."); return finish(empty); }
  for (const entry of raw) {
    const name = entry.entryName.replace(/\\/g, "/");
    if (name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..")) issues.error("PACKAGE_UNSAFE_PATH", `Caminho não permitido: ${entry.entryName}.`, "Use apenas caminhos relativos dentro do pacote, sem “..”.", entry.entryName);
  }
  if (issues.errors.length) return finish(empty);
  let names = raw.map((entry) => entry.entryName.replace(/\\/g, "/"));
  const roots = new Set(names.map((name) => name.split("/")[0]));
  const prefix = !names.includes("manifest.json") && roots.size === 1 && names.every((name) => name.includes("/")) ? `${[...roots][0]}/` : "";
  const files = new Map<string, AdmZip.IZipEntry>();
  raw.forEach((entry, index) => files.set(names[index].slice(prefix.length), entry));
  names = [...files.keys()];
  const used = new Set<string>();
  const readText = (path: string) => { used.add(path); return files.get(path)!.getData().toString("utf8").replace(/^﻿/, ""); };

  // manifest.json
  if (!files.has("manifest.json")) { issues.error("MANIFEST_MISSING", "O pacote não tem o arquivo manifest.json na raiz.", "Crie o manifest.json conforme a documentação (há um exemplo no pacote modelo para baixar)."); return finish({ ...empty, files: names.length }); }
  let manifestJson: unknown;
  try { manifestJson = JSON.parse(readText("manifest.json")); } catch (error) { issues.error("MANIFEST_INVALID_JSON", `O manifest.json não é um JSON válido: ${(error as Error).message}.`, "Confira vírgulas, aspas e chaves. Um validador de JSON online ajuda a achar o ponto exato.", "manifest.json"); return finish({ ...empty, files: names.length }); }
  const parsed = manifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    for (const problem of parsed.error.issues) issues.error("MANIFEST_INVALID", `manifest.json → ${problem.path.join(".") || "(raiz)"}: ${problem.message}.`, "Compare com o manifest.json do pacote de exemplo.", "manifest.json");
    return finish({ ...empty, files: names.length });
  }
  const manifest = parsed.data;
  if (manifest.format !== TEMPLATE_PACKAGE_FORMAT || manifest.formatVersion !== TEMPLATE_PACKAGE_FORMAT_VERSION) issues.error("MANIFEST_FORMAT_UNSUPPORTED", `Formato “${manifest.format}” versão ${manifest.formatVersion} não é suportado.`, `Use "format": "${TEMPLATE_PACKAGE_FORMAT}" e "formatVersion": ${TEMPLATE_PACKAGE_FORMAT_VERSION}.`, "manifest.json");
  if (!manifest.home.length) issues.error("HOME_EMPTY", "A página inicial (home) não tem nenhuma seção.", "Liste em “home” as seções da página inicial, na ordem em que aparecem.", "manifest.json");
  const pages = manifest.pages ?? [];
  if (pages.length > TEMPLATE_PACKAGE_LIMITS.pages) issues.error("PAGE_INVALID", `O modelo tem ${pages.length} páginas; o limite é ${TEMPLATE_PACKAGE_LIMITS.pages}.`, undefined, "manifest.json");
  if (new Set(pages.map((page) => page.slug)).size !== pages.length) issues.error("PAGE_INVALID", "Duas páginas usam o mesmo slug.", "Cada página precisa de um endereço (slug) diferente.", "manifest.json");
  const sectionCount = manifest.home.length + pages.reduce((sum, page) => sum + page.sections.length, 0);
  if (manifest.home.length > TEMPLATE_PACKAGE_LIMITS.sections || pages.some((page) => page.sections.length > 30)) issues.error("TOO_MANY_SECTIONS", `Há seções demais (limite: ${TEMPLATE_PACKAGE_LIMITS.sections} na página inicial e 30 por página).`, undefined, "manifest.json");
  for (const item of manifest.navigation ?? []) if (!safeTemplateHref(item.url)) issues.error("HTML_UNSAFE_LINK", `Link do menu “${item.label}” não é permitido: ${item.url}.`, "Use https://, mailto:, tel:, uma âncora (#contato) ou um caminho do site (/sobre).", "manifest.json");

  // Imagens: processadas (validadas e convertidas para WEBP) uma única vez por caminho.
  const assets = new Map<string, Buffer>();
  const assetProblems = new Set<string>();
  async function asset(path: string, file: string, line?: number): Promise<string | undefined> {
    const clean = path.trim().replace(/^\.\//, "");
    if (/^(?:[a-z]+:)?\/\//i.test(clean) || /^data:/i.test(clean)) { issues.error("ASSET_EXTERNAL", `Imagem externa não permitida: ${clean.slice(0, 120)}.`, "Coloque a imagem dentro da pasta assets/ do pacote e use o caminho relativo (ex.: assets/banner.jpg).", file, line); return undefined; }
    if (!files.has(clean)) { issues.error("ASSET_MISSING", `A imagem ${clean} não existe no pacote.`, "Confira o nome e a pasta (letras maiúsculas e minúsculas fazem diferença).", file, line); return undefined; }
    used.add(clean);
    if (assets.has(clean)) return PLACEHOLDER + clean;
    if (assetProblems.has(clean)) return undefined;
    if (!IMAGE_EXTENSIONS.test(clean)) {
      assetProblems.add(clean);
      const extension = clean.split(".").pop()?.toLowerCase();
      issues.error("ASSET_FORMAT", `Formato não aceito: ${clean}.`, extension === "svg" ? "SVG pode conter scripts e não é aceito: exporte como PNG ou WEBP." : extension === "gif" ? "Use PNG, JPG ou WEBP (animações não são aceitas)." : "Use imagens JPG, PNG ou WEBP.", file, line);
      return undefined;
    }
    const entry = files.get(clean)!;
    if (entry.header.size > TEMPLATE_PACKAGE_LIMITS.assetBytes) { assetProblems.add(clean); issues.error("ASSET_TOO_LARGE", `${clean} tem ${mb(entry.header.size)}; o limite por imagem é ${mb(TEMPLATE_PACKAGE_LIMITS.assetBytes)}.`, "Reduza para até 2400 px no lado maior e comprima (WEBP ou JPG com qualidade 80).", clean); return undefined; }
    try {
      assets.set(clean, await sharp(entry.getData(), { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer());
      return PLACEHOLDER + clean;
    } catch {
      assetProblems.add(clean);
      issues.error("ASSET_INVALID_IMAGE", `${clean} não é uma imagem válida ou está corrompida.`, "Abra a imagem num editor e exporte de novo como JPG, PNG ou WEBP.", clean);
      return undefined;
    }
  }

  // theme.json
  let theme: Record<string, unknown> = {};
  const themePath = manifest.theme ?? (files.has("theme.json") ? "theme.json" : undefined);
  if (themePath) {
    if (!files.has(themePath)) issues.error("SECTION_FILE_MISSING", `O arquivo de tema ${themePath} indicado no manifest não existe.`, undefined, "manifest.json");
    else {
      try {
        const result = themeSchema.safeParse(JSON.parse(readText(themePath)));
        if (result.success) theme = result.data;
        else for (const problem of result.error.issues) issues.error("THEME_INVALID", `${themePath} → ${problem.path.join(".") || "(raiz)"}: ${problem.code === "unrecognized_keys" ? `campo não suportado (${(problem as { keys?: string[] }).keys?.join(", ")})` : problem.message}.`, "Campos aceitos: cores em #RRGGBB (primary, secondary, background, foreground, surface, headerBackground, footerBackground, footerForeground), bodyFont/headingFont (modern, classic, rounded, editorial), buttonStyle, rounded, contentWidth, sectionSpacing, fontSize, headerLayout.", themePath);
      } catch (error) { issues.error("THEME_INVALID_JSON", `${themePath} não é um JSON válido: ${(error as Error).message}.`, undefined, themePath); }
    }
  }

  // Seções: cada arquivo é lido uma vez; várias entradas podem reaproveitar o mesmo desenho.
  const sections: TemplateSection[] = [];
  const parsedFiles = new Map<string, { index?: number; sample?: Omit<TemplateSampleBlock, "type" | "section"> }>();
  async function block(entry: SectionEntry, where: string): Promise<TemplateSampleBlock | undefined> {
    const templated = TEMPLATED_SECTIONS[entry.type];
    const native = (NATIVE_SECTIONS as readonly string[]).includes(entry.type);
    if (!templated && !native) { issues.error("SECTION_TYPE_UNKNOWN", `${where}: tipo de seção “${entry.type}” não existe.`, `Tipos com HTML próprio: ${Object.keys(TEMPLATED_SECTIONS).join(", ")}. Montados pelo Vorix: ${NATIVE_SECTIONS.join(", ")}.`, "manifest.json"); return undefined; }
    const base: TemplateSampleBlock = { type: entry.type, title: entry.title ?? "", text: entry.text ?? "", imageAlt: "", items: [] };
    if (native) {
      if (entry.file) issues.error("SECTION_NATIVE_WITH_FILE", `${where}: a seção “${entry.type}” é montada pelo Vorix e não aceita HTML próprio (${entry.file}).`, `Remova "file" desta seção. Para mudar a aparência, use o styles.css com as classes do Vorix descritas na documentação.`, "manifest.json");
      if (entry.type === "video") {
        if (entry.videoUrl && !/^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(entry.videoUrl)) issues.error("MANIFEST_INVALID", `${where}: o vídeo precisa ser um link público https do YouTube ou Vimeo.`, undefined, "manifest.json");
        else base.videoUrl = entry.videoUrl;
      }
      if (entry.source || entry.category || entry.limit) {
        if (entry.type !== "catalog") issues.error("MANIFEST_INVALID", `${where}: “source”, “category” e “limit” só valem para a seção catalog.`, undefined, "manifest.json");
        else if (entry.source === "category" && !entry.category) issues.error("MANIFEST_INVALID", `${where}: com "source": "category", informe "category" com o endereço da categoria (ex.: "camisetas").`, undefined, "manifest.json");
        else if (entry.category && entry.source !== "category") issues.error("MANIFEST_INVALID", `${where}: "category" só vale com "source": "category".`, undefined, "manifest.json");
        else { if (entry.source) base.source = entry.source; if (entry.category) base.category = entry.category; if (entry.limit) base.limit = entry.limit; }
      }
      if (entry.type === "gallery" && entry.images) {
        base.images = [];
        for (const image of entry.images) { const url = await asset(image.file, "manifest.json"); if (url) base.images.push({ url, alt: image.alt }); }
      }
      return base;
    }
    if (entry.images || entry.videoUrl) issues.error("MANIFEST_INVALID", `${where}: “images” e “videoUrl” só valem para as seções gallery e video.`, undefined, "manifest.json");
    if (!entry.file) { issues.error("SECTION_FILE_REQUIRED", `${where}: a seção “${entry.type}” precisa de um arquivo HTML em "file".`, "Ex.: { \"type\": \"hero\", \"file\": \"sections/hero.html\" }.", "manifest.json"); return undefined; }
    const file = entry.file.replace(/^\.\//, "");
    if (!files.has(file)) { issues.error("SECTION_FILE_MISSING", `${where}: o arquivo ${file} não existe no pacote.`, "Confira o nome e a pasta (letras maiúsculas e minúsculas fazem diferença).", "manifest.json"); return undefined; }
    const key = `${entry.type}:${file}`;
    if (!parsedFiles.has(key)) parsedFiles.set(key, await parseSection(entry.type, file));
    const done = parsedFiles.get(key)!;
    if (done.index === undefined) return undefined;
    return { ...base, ...done.sample, title: entry.title ?? done.sample!.title, text: entry.text ?? done.sample!.text, type: entry.type, section: done.index };
  }

  async function parseSection(type: string, file: string): Promise<{ index?: number; sample?: Omit<TemplateSampleBlock, "type" | "section"> }> {
    const spec = TEMPLATED_SECTIONS[type];
    const entryFile = files.get(file)!;
    if (entryFile.header.size > TEMPLATE_PACKAGE_LIMITS.sectionBytes) { issues.error("SECTION_TOO_LARGE", `${file} tem ${kb(entryFile.header.size)}; o limite por seção é ${kb(TEMPLATE_PACKAGE_LIMITS.sectionBytes)}.`, "Separe em mais seções ou simplifique o HTML.", file); return {}; }
    const before = issues.errors.length;
    const $ = cheerio.load(readText(file), { sourceCodeLocationInfo: true } as Parameters<typeof cheerio.load>[1], false);
    const top = ($.root()[0] as unknown as Dom).children ?? [];
    const elements = top.filter((node) => node.type !== "comment" && !(node.type === "text" && !node.data?.trim()));
    const root = elements[0];
    if (elements.length !== 1 || root.type !== "tag" || root.name !== "section") {
      issues.error("SECTION_ROOT_INVALID", `${file}: o arquivo precisa ter exatamente um elemento <section data-vorix-block="${type}"> envolvendo todo o conteúdo.`, "Remova <html>, <head>, <body> e qualquer conteúdo fora da <section>.", file, root?.sourceCodeLocation?.startLine ?? undefined);
      return {};
    }
    if (root.attribs?.["data-vorix-block"] !== type) issues.error("SECTION_TYPE_MISMATCH", `${file}: a <section> declara data-vorix-block="${root.attribs?.["data-vorix-block"] ?? ""}", mas o manifest usa o tipo “${type}”.`, `Use data-vorix-block="${type}" ou corrija o tipo no manifest.`, file, line(root));
    const sample: Omit<TemplateSampleBlock, "type" | "section"> = { title: "", text: "", imageAlt: "", items: [] };
    const found = new Set<string>();
    let repeats = 0;
    const tree = await walk(root, { file, type, scope: "section", found, sample, onRepeat: () => { repeats++; } });
    for (const field of spec.required) if (!found.has(field)) issues.error("FIELD_REQUIRED", `${file}: a seção “${type}” precisa de um campo editável “${field}”.`, `Marque o elemento com data-vorix-field="${field}". Campos obrigatórios desta seção: ${spec.required.join(", ")}.`, file);
    if (spec.items && repeats === 0) issues.error("REPEAT_REQUIRED", `${file}: a seção “${type}” precisa de uma lista de itens.`, `Envolva os itens num elemento com data-vorix-repeat="items" (ex.: <ul data-vorix-repeat="items"><li>…</li></ul>).`, file);
    if (repeats > 1) issues.error("REPEAT_INVALID", `${file}: só pode haver uma lista data-vorix-repeat="items" por seção.`, undefined, file);
    if (issues.errors.length > before || !tree || tree.t !== "el") return {};
    sections.push({ type, tree });
    return { index: sections.length - 1, sample };
  }

  type WalkContext = { file: string; type: string; scope: "section" | "item"; found: Set<string>; sample: { title: string; text: string; eyebrow?: string; buttonLabel?: string; buttonUrl?: string; imageUrl?: string; imageAlt: string; value?: string; items?: TemplateSampleBlock["items"] }; onRepeat: () => void };

  async function walk(node: Dom, context: WalkContext): Promise<TemplateNode | undefined> {
    if (node.type === "text") { const value = (node.data ?? "").replace(/\s+/g, " "); return value ? { t: "text", v: value.slice(0, 4000) } : undefined; }
    if (node.type === "comment" || node.type === "directive") return undefined;
    const tag = (node.name ?? "").toLowerCase();
    if (node.type === "script" || node.type === "style" || !ALLOWED_TAGS.has(tag)) {
      issues.error("HTML_FORBIDDEN_TAG", `${context.file}: a tag <${tag}> não é permitida.`, tag === "script" ? "Scripts não são aceitos. Interações (carrinho, formulário, WhatsApp) são feitas pelos recursos do Vorix." : tag === "style" || tag === "link" ? "Coloque os estilos no styles.css do pacote." : tag === "iframe" || tag === "video" ? "Para vídeo, use a seção “video” do Vorix com um link do YouTube ou Vimeo." : tag === "form" || tag === "input" || tag === "button" ? "Formulários são do Vorix: use a seção “contact”. Para botões, use <a data-vorix-field=\"button\">." : tag === "svg" ? "Exporte o desenho como PNG ou WEBP e use <img>." : `Tags aceitas: ${[...ALLOWED_TAGS].join(", ")}.`, context.file, line(node));
      return undefined;
    }
    const attrs: Record<string, string> = {};
    for (const [rawName, value] of Object.entries(node.attribs ?? {})) {
      const name = rawName.toLowerCase();
      if (name.startsWith("on")) { issues.error("HTML_EVENT_HANDLER", `${context.file}: o atributo ${name} (código JavaScript) não é permitido em <${tag}>.`, "Remova o atributo; o modelo não pode executar scripts.", context.file, line(node)); continue; }
      if (name === "style") { issues.error("HTML_INLINE_STYLE", `${context.file}: estilo direto no elemento (style="…") não é permitido em <${tag}>.`, "Crie uma classe no styles.css e use class=\"…\".", context.file, line(node)); continue; }
      if (name === "id" || (name.startsWith("data-") && !name.startsWith("data-vorix-"))) { issues.warn("HTML_ATTRIBUTE_REMOVED", `${context.file}: o atributo ${name} em <${tag}> foi removido.`, name === "id" ? "Os identificadores das seções são do Vorix; use classes para estilizar." : "Atributos data-* de bibliotecas JavaScript não têm efeito sem scripts.", context.file, line(node)); continue; }
      if (name.startsWith("aria-")) { attrs[name] = value.slice(0, 300); continue; }
      if (!ALLOWED_ATTRIBUTES.has(name)) { issues.error("HTML_FORBIDDEN_ATTRIBUTE", `${context.file}: o atributo ${name} não é permitido em <${tag}>.`, `Atributos aceitos: ${[...ALLOWED_ATTRIBUTES].filter((item) => !item.startsWith("data-vorix")).join(", ")}, aria-* e os data-vorix-*.`, context.file, line(node)); continue; }
      if (name === "href") { if (tag !== "a") { issues.error("HTML_FORBIDDEN_ATTRIBUTE", `${context.file}: href só pode ser usado em <a>.`, undefined, context.file, line(node)); continue; } if (!safeTemplateHref(value)) { issues.error("HTML_UNSAFE_LINK", `${context.file}: link não permitido: ${value.slice(0, 120)}.`, "Use https://, mailto:, tel:, uma âncora (#contato) ou um caminho do site (/produtos).", context.file, line(node)); continue; } }
      if (name === "src") { if (tag !== "img") { issues.error("HTML_FORBIDDEN_ATTRIBUTE", `${context.file}: src só pode ser usado em <img>.`, undefined, context.file, line(node)); continue; } const url = await asset(value, context.file, line(node)); if (!url) continue; attrs.src = url; continue; }
      if ((name === "width" || name === "height") && !/^\d{1,4}$/.test(value)) continue;
      if (name === "loading" && !["lazy", "eager"].includes(value)) continue;
      if (name === "class") { const cleaned = value.replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim(); if (cleaned) attrs.class = cleaned.slice(0, 300); continue; }
      if (name.startsWith("data-vorix-")) continue;
      attrs[name] = value.slice(0, 300);
    }
    if (tag === "img" && !attrs.src && !node.attribs?.["data-vorix-field"]) issues.error("ASSET_MISSING", `${context.file}: <img> sem imagem (src).`, "Aponte para um arquivo da pasta assets/ ou marque com data-vorix-field=\"image\".", context.file, line(node));
    if (tag === "img" && !(node.attribs?.alt ?? "").trim()) issues.warn("IMAGE_ALT_MISSING", `${context.file}: imagem sem texto alternativo (alt).`, "Descreva a imagem em alt=\"…\": ajuda quem usa leitor de tela e o Google.", context.file, line(node));

    const spec = TEMPLATED_SECTIONS[context.type];
    const fieldName = node.attribs?.["data-vorix-field"];
    const repeat = node.attribs?.["data-vorix-repeat"];
    const result: Extract<TemplateNode, { t: "el" }> = { t: "el", tag, attrs, children: [] };

    if (repeat !== undefined) {
      if (repeat !== "items" || !spec.items || context.scope === "item") { issues.error("REPEAT_INVALID", `${context.file}: data-vorix-repeat="${repeat}" não é válido aqui.`, spec.items ? "Use data-vorix-repeat=\"items\" uma única vez, sem listas dentro de listas." : `A seção “${context.type}” não tem lista de itens.`, context.file, line(node)); return undefined; }
      context.onRepeat();
      const children = (node.children ?? []).filter((child) => child.type === "tag" || child.type === "script" || child.type === "style");
      if (!children.length) { issues.error("REPEAT_INVALID", `${context.file}: a lista data-vorix-repeat="items" está vazia.`, "Coloque ao menos um item de exemplo dentro dela: ele vira o desenho de cada item.", context.file, line(node)); return undefined; }
      if (children.length > TEMPLATE_PACKAGE_LIMITS.items) issues.error("REPEAT_INVALID", `${context.file}: a lista tem ${children.length} itens; o limite é ${TEMPLATE_PACKAGE_LIMITS.items}.`, undefined, context.file, line(node));
      const items: TemplateSampleBlock["items"] = [];
      for (const [index, child] of children.entries()) {
        const found = new Set<string>();
        const item = { title: "", text: "", imageAlt: "" } as WalkContext["sample"];
        const tree = await walk(child, { ...context, scope: "item", found, sample: item });
        for (const field of spec.items.required) if (!found.has(field)) issues.error("FIELD_REQUIRED", `${context.file}: o item ${index + 1} da lista precisa de um campo “${field}”.`, `Campos obrigatórios em cada item de “${context.type}”: ${spec.items.required.join(", ")}.`, context.file, line(child));
        if (index === 0 && tree) result.children.push(tree);
        items.push({ title: item.title, text: item.text, value: item.value, imageUrl: item.imageUrl, imageAlt: item.imageAlt || undefined });
      }
      result.repeat = true;
      context.sample.items = items;
      return result;
    }

    if (fieldName !== undefined) {
      const allowed: readonly string[] = context.scope === "item" ? spec.items?.fields ?? [] : spec.fields;
      if (!allowed.includes(fieldName)) { issues.error("FIELD_UNKNOWN", `${context.file}: o campo “${fieldName}” não existe ${context.scope === "item" ? "nos itens" : "na seção"} “${context.type}”.`, `Campos aceitos: ${allowed.join(", ") || "nenhum"}.`, context.file, line(node)); return undefined; }
      if (context.found.has(fieldName)) { issues.error("FIELD_DUPLICATED", `${context.file}: o campo “${fieldName}” aparece mais de uma vez${context.scope === "item" ? " no mesmo item" : ""}.`, "Cada campo editável pode ser usado uma única vez.", context.file, line(node)); return undefined; }
      context.found.add(fieldName);
      const elements = fieldName === "value" ? FIELD_ELEMENTS.title : FIELD_ELEMENTS[fieldName as SectionField];
      if (!elements.includes(tag)) { issues.error("FIELD_WRONG_ELEMENT", `${context.file}: o campo “${fieldName}” não pode ficar em <${tag}>.`, `Use ${elements.map((item) => `<${item}>`).join(", ")}.`, context.file, line(node)); return undefined; }
      result.field = fieldName as SectionField | ItemField;
      if (fieldName === "image") { context.sample.imageUrl = attrs.src; context.sample.imageAlt = (node.attribs?.alt ?? "").trim().slice(0, 200); return result; }
      const kids = node.children ?? [];
      if (kids.some((child) => child.type !== "text" && child.type !== "comment")) { issues.error("FIELD_NOT_TEXT", `${context.file}: o campo “${fieldName}” deve conter só texto, sem outras tags dentro.`, "Mova ícones e enfeites para fora do elemento ou para o CSS (::before/::after).", context.file, line(node)); return undefined; }
      const value = kids.map((child) => child.data ?? "").join("").replace(/\s+/g, " ").trim();
      if (fieldName === "button") { context.sample.buttonLabel = value.slice(0, 100); context.sample.buttonUrl = attrs.href; delete attrs.href; }
      else if (fieldName === "value") context.sample.value = value.slice(0, 80);
      else (context.sample as unknown as Record<string, string>)[fieldName] = value.slice(0, fieldName === "eyebrow" ? 100 : fieldName === "title" ? 200 : 4000);
      return result;
    }

    if (!VOID_TAGS.has(tag)) for (const child of node.children ?? []) { const next = await walk(child, context); if (next) result.children.push(next); }
    return result;
  }

  const home: TemplateSampleBlock[] = [];
  for (const [index, entry] of manifest.home.entries()) { const result = await block(entry, `home, seção ${index + 1} (${entry.type})`); if (result) home.push(result); }
  const builtPages: ImportedTemplatePackage["pages"] = [];
  for (const page of pages) {
    const blocks: TemplateSampleBlock[] = [];
    for (const [index, entry] of page.sections.entries()) { const result = await block(entry, `página “${page.slug}”, seção ${index + 1} (${entry.type})`); if (result) blocks.push(result); }
    builtPages.push({ slug: page.slug, title: page.title, blocks });
  }

  // styles.css
  let css = "";
  const stylesPath = manifest.styles ?? (files.has("styles.css") ? "styles.css" : undefined);
  if (stylesPath) {
    if (!files.has(stylesPath)) issues.error("SECTION_FILE_MISSING", `O arquivo de estilos ${stylesPath} indicado no manifest não existe.`, undefined, "manifest.json");
    else css = await processCss(readText(stylesPath), stylesPath);
  }

  async function processCss(source: string, file: string): Promise<string> {
    if (Buffer.byteLength(source) > TEMPLATE_PACKAGE_LIMITS.cssBytes) { issues.error("CSS_TOO_LARGE", `${file} tem ${kb(Buffer.byteLength(source))}; o limite é ${kb(TEMPLATE_PACKAGE_LIMITS.cssBytes)}.`, "Remova estilos não usados e não inclua frameworks inteiros (Bootstrap, Tailwind compilado).", file); return ""; }
    const angle = source.indexOf("<");
    if (angle >= 0) { issues.error("CSS_UNSAFE", `${file}: o caractere “<” não é permitido no CSS.`, "Remova HTML ou comentários <!-- --> de dentro do CSS.", file, lineAt(source, angle)); return ""; }
    let root: Root;
    try { root = postcss.parse(source, { from: file }); } catch (error) {
      if (error instanceof CssSyntaxError) issues.error("CSS_PARSE_ERROR", `${file}: erro de sintaxe — ${error.reason}.`, "Confira chaves { } e ponto e vírgula próximos da linha indicada.", file, error.line);
      else issues.error("CSS_PARSE_ERROR", `${file}: não foi possível ler o CSS.`, undefined, file);
      return "";
    }
    let responsive = false;
    const urls: { decl: import("postcss").Declaration; raw: string; path: string }[] = [];
    root.walkAtRules((rule) => {
      const name = rule.name.toLowerCase();
      if (name === "media") { responsive = true; return; }
      if (name === "charset") { rule.remove(); return; }
      if (["supports", "keyframes", "-webkit-keyframes", "container"].includes(name)) return;
      issues.error("CSS_FORBIDDEN_AT_RULE", `${file}: @${rule.name} não é permitido.`, name === "import" ? "Junte todo o CSS no styles.css; arquivos e fontes externos não são carregados." : name === "font-face" ? "Fontes externas não são aceitas: escolha bodyFont e headingFont no theme.json (modern, classic, rounded ou editorial)." : "Use apenas @media, @supports, @container e @keyframes.", file, rule.source?.start?.line);
    });
    root.walkDecls((decl) => {
      const value = decl.value, prop = decl.prop.toLowerCase();
      if (/expression\s*\(|javascript:|vbscript:/i.test(value) || prop === "behavior" || prop === "-moz-binding") issues.error("CSS_UNSAFE", `${file}: a declaração “${decl.prop}: ${value.slice(0, 80)}” não é permitida.`, "Remova código executável do CSS.", file, decl.source?.start?.line);
      if (prop === "position" && /\bfixed\b/i.test(value)) issues.warn("CSS_FIXED_POSITION", `${file}: position: fixed pode cobrir o cabeçalho, o carrinho ou o conteúdo.`, "Prefira position: sticky ou absolute dentro da própria seção.", file, decl.source?.start?.line);
      for (const match of value.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) urls.push({ decl, raw: match[0], path: match[2] });
    });
    for (const item of urls) {
      if (/^(?:[a-z]+:)?\/\//i.test(item.path) || /^data:/i.test(item.path)) { issues.error("CSS_EXTERNAL_URL", `${file}: recurso externo não permitido: ${item.path.slice(0, 120)}.`, "Coloque a imagem na pasta assets/ e use url(assets/arquivo.jpg).", file, item.decl.source?.start?.line); continue; }
      const url = await asset(item.path, file, item.decl.source?.start?.line);
      if (url) item.decl.value = item.decl.value.replace(item.raw, `url("${url}")`);
    }
    root.walkRules((rule) => {
      const parent = rule.parent;
      if (parent?.type === "atrule" && /keyframes$/i.test((parent as import("postcss").AtRule).name)) return;
      rule.selectors = rule.selectors.map((selector) => { const value = selector.trim(); return /^(html|body|:root)\b/i.test(value) ? value.replace(/^(html|body|:root)/i, SCOPE) : `${SCOPE} ${value}`; });
    });
    if (!responsive && root.nodes.length) issues.warn("CSS_NO_RESPONSIVE", `${file}: não há nenhuma regra @media para telas pequenas.`, "Teste o modelo em 390 px de largura e ajuste com @media (max-width: 700px) { … }.", file);
    return root.toString();
  }

  // preview
  let previewUrl: string | undefined;
  const previewPath = manifest.preview ?? ["preview.png", "preview.jpg", "preview.webp"].find((name) => files.has(name));
  if (previewPath) previewUrl = await asset(previewPath, "manifest.json");
  else issues.warn("PREVIEW_MISSING", "O pacote não tem imagem de pré-visualização.", "Inclua um preview.png (1200 × 800) para identificar o modelo na lista.");

  for (const name of names) {
    if (used.has(name) || DOCUMENT_FILES.test(name.split("/").pop() ?? "")) continue;
    if (name.startsWith("assets/")) issues.warn("ASSET_UNUSED", `${name} não é usado pelo modelo e será ignorado.`, "Remova do pacote para deixá-lo menor.", name);
    else issues.warn("FILE_IGNORED", `${name} não faz parte do formato e será ignorado.`, "O pacote usa só manifest.json, theme.json, styles.css, sections/*.html, assets/ e preview.", name);
  }

  const summary = { files: names.length, sections: sectionCount, pages: builtPages.length, assets: assets.size };
  if (issues.errors.length) return finish(summary);
  let pkg: ImportedTemplatePackage = {
    name: manifest.name, version: manifest.version, author: manifest.author, description: manifest.description, previewUrl, theme, css, sections, home, pages: builtPages,
    navigation: (manifest.navigation ?? []).map(({ label, url }) => ({ label, url })), assetUrls: [],
  };
  if (store) {
    // Só agora, com o pacote todo aprovado, as imagens são gravadas.
    const urls = new Map<string, string>();
    for (const [path, body] of assets) urls.set(path, await store({ path, body, contentType: "image/webp" }));
    let json = JSON.stringify(pkg);
    for (const [path, url] of urls) json = json.split(PLACEHOLDER + path).join(url);
    pkg = { ...JSON.parse(json) as ImportedTemplatePackage, assetUrls: [...urls.values()] };
  }
  return finish(summary, pkg);
}

const line = (node: Dom) => node.sourceCodeLocation?.startLine ?? undefined;
const lineAt = (source: string, index: number) => source.slice(0, index).split("\n").length;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
const kb = (bytes: number) => `${Math.ceil(bytes / 1024)} KB`;
