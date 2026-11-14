/**
 * Contrato do "Pacote de Modelo Vorix" (.zip) — modelo de site criado fora do Vorix e importado.
 *
 * O pacote traz só APARÊNCIA (HTML de seções sem scripts, CSS e imagens) e conteúdo de exemplo.
 * Na importação, cada campo marcado com `data-vorix-field` vira conteúdo editável de um bloco do
 * Vorix; o HTML vira uma árvore segura (nunca HTML cru) e o CSS fica restrito ao site. Cabeçalho,
 * rodapé, carrinho, catálogo, formulário e páginas de produto continuam sendo do Vorix.
 *
 * A documentação pública (web/app/modelos/importar) e o pacote de exemplo seguem estas regras;
 * `tests/site-template-package.test.mjs` confere que todos os códigos estão documentados.
 */

export const TEMPLATE_PACKAGE_FORMAT = "vorix-site-template";
export const TEMPLATE_PACKAGE_FORMAT_VERSION = 1;

export const TEMPLATE_PACKAGE_LIMITS = {
  zipBytes: 20 * 1024 * 1024,
  unpackedBytes: 60 * 1024 * 1024,
  files: 200,
  assetBytes: 5 * 1024 * 1024,
  cssBytes: 200 * 1024,
  sectionBytes: 100 * 1024,
  sections: 40,
  pages: 10,
  items: 30,
} as const;

/** Seções desenhadas pelo pacote (HTML próprio). Campos: os do bloco e, nas listas, os de cada item. */
export type TemplatedSectionSpec = { fields: readonly SectionField[]; required: readonly SectionField[]; items?: { fields: readonly ItemField[]; required: readonly ItemField[] } };
export type SectionField = "title" | "text" | "eyebrow" | "button" | "image";
export type ItemField = "title" | "text" | "value" | "image";

export const TEMPLATED_SECTIONS: Record<string, TemplatedSectionSpec> = {
  hero: { fields: ["eyebrow", "title", "text", "button", "image"], required: ["title"] },
  text: { fields: ["eyebrow", "title", "text"], required: ["text"] },
  image: { fields: ["title", "text", "image"], required: ["image"] },
  image_text: { fields: ["eyebrow", "title", "text", "button", "image"], required: ["title", "image"] },
  cta: { fields: ["eyebrow", "title", "text", "button"], required: ["title", "button"] },
  features: { fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["title", "text", "image"], required: ["title"] } },
  stats: { fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["value", "title"], required: ["value", "title"] } },
  testimonials: { fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["text", "title", "value", "image"], required: ["text", "title"] } },
  logos: { fields: ["title", "text"], required: [], items: { fields: ["image", "title"], required: ["image"] } },
  faq: { fields: ["eyebrow", "title", "text"], required: [], items: { fields: ["title", "text"], required: ["title", "text"] } },
  divider: { fields: [], required: [] },
};

/** Seções que o Vorix monta (produtos, formulário, vídeo, galeria): o pacote só define título/texto e estiliza pelo CSS. */
export const NATIVE_SECTIONS = ["catalog", "categories", "contact", "video", "gallery"] as const;

export const FIELD_ELEMENTS: Record<SectionField, readonly string[]> = {
  title: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "strong", "em", "div", "figcaption", "small", "cite", "blockquote", "dt", "dd", "li"],
  text: ["p", "span", "div", "small", "blockquote", "figcaption", "h2", "h3", "h4", "h5", "h6", "cite", "dt", "dd", "li"],
  eyebrow: ["span", "p", "small", "div", "strong"],
  button: ["a"],
  image: ["img"],
};

export const ALLOWED_TAGS = new Set(["section", "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img", "ul", "ol", "li", "strong", "em", "b", "i", "u", "small", "br", "hr", "figure", "figcaption", "blockquote", "cite", "header", "footer", "article", "aside", "nav", "dl", "dt", "dd"]);
export const VOID_TAGS = new Set(["img", "br", "hr"]);
export const ALLOWED_ATTRIBUTES = new Set(["class", "alt", "title", "role", "href", "src", "width", "height", "loading", "data-vorix-block", "data-vorix-field", "data-vorix-repeat"]);

export type TemplateIssueSeverity = "error" | "warning";
export type TemplateIssue = { code: TemplateIssueCode; severity: TemplateIssueSeverity; message: string; hint?: string; file?: string; line?: number };
export type TemplateReport = { ok: boolean; errors: TemplateIssue[]; warnings: TemplateIssue[]; summary: { files: number; sections: number; pages: number; assets: number } };

/** Árvore segura de uma seção: só elementos/atributos permitidos; campos e listas marcados. */
export type TemplateNode =
  | { t: "text"; v: string }
  | { t: "el"; tag: string; attrs: Record<string, string>; children: TemplateNode[]; field?: SectionField | ItemField; repeat?: true };

export type TemplateSection = { type: string; tree: TemplateNode };

/** Conteúdo de exemplo extraído do pacote, no formato dos blocos do Vorix (ids definidos na aplicação). */
export type TemplateSampleBlock = {
  type: string; title: string; text: string; eyebrow?: string; buttonLabel?: string; buttonUrl?: string; imageUrl?: string; imageAlt: string; videoUrl?: string;
  items: { title: string; text: string; value?: string; imageUrl?: string; imageAlt?: string }[];
  images?: { url: string; alt: string }[];
  /** Catálogo: quais produtos (todos, destaques, promoção ou uma categoria pelo endereço). */
  source?: "all" | "featured" | "sale" | "category"; category?: string; limit?: number;
  /** Índice em `sections` do desenho desta seção (ausente nas seções do Vorix). */
  section?: number;
};

export type ImportedTemplatePackage = {
  name: string; version: string; author?: string; description?: string;
  previewUrl?: string;
  theme: Record<string, unknown>;
  css: string;
  sections: TemplateSection[];
  home: TemplateSampleBlock[];
  pages: { slug: string; title: string; blocks: TemplateSampleBlock[] }[];
  navigation: { label: string; url: string }[];
  /** URLs de imagens gravadas, para assinar na entrega pública. */
  assetUrls: string[];
};

export type ImportedTemplateSummary = { id: string; name: string; version: string; author?: string; description?: string; previewUrl?: string; sections: number; pages: number; createdAt: string };

export type TemplateIssueCode =
  | "PACKAGE_INVALID_ZIP" | "PACKAGE_TOO_LARGE" | "PACKAGE_TOO_MANY_FILES" | "PACKAGE_UNSAFE_PATH"
  | "MANIFEST_MISSING" | "MANIFEST_INVALID_JSON" | "MANIFEST_INVALID" | "MANIFEST_FORMAT_UNSUPPORTED"
  | "THEME_INVALID_JSON" | "THEME_INVALID"
  | "HOME_EMPTY" | "TOO_MANY_SECTIONS" | "PAGE_INVALID"
  | "SECTION_TYPE_UNKNOWN" | "SECTION_FILE_MISSING" | "SECTION_FILE_REQUIRED" | "SECTION_NATIVE_WITH_FILE" | "SECTION_ROOT_INVALID" | "SECTION_TYPE_MISMATCH" | "SECTION_TOO_LARGE"
  | "HTML_FORBIDDEN_TAG" | "HTML_FORBIDDEN_ATTRIBUTE" | "HTML_EVENT_HANDLER" | "HTML_INLINE_STYLE" | "HTML_UNSAFE_LINK"
  | "FIELD_UNKNOWN" | "FIELD_REQUIRED" | "FIELD_DUPLICATED" | "FIELD_WRONG_ELEMENT" | "FIELD_NOT_TEXT"
  | "REPEAT_INVALID" | "REPEAT_REQUIRED"
  | "ASSET_MISSING" | "ASSET_EXTERNAL" | "ASSET_FORMAT" | "ASSET_TOO_LARGE" | "ASSET_INVALID_IMAGE"
  | "CSS_PARSE_ERROR" | "CSS_TOO_LARGE" | "CSS_FORBIDDEN_AT_RULE" | "CSS_EXTERNAL_URL" | "CSS_UNSAFE"
  | "CSS_FIXED_POSITION" | "CSS_NO_RESPONSIVE" | "ASSET_UNUSED" | "FILE_IGNORED" | "HTML_ATTRIBUTE_REMOVED" | "IMAGE_ALT_MISSING" | "PREVIEW_MISSING";

export const TEMPLATE_ISSUE_CODES: readonly TemplateIssueCode[] = [
  "PACKAGE_INVALID_ZIP", "PACKAGE_TOO_LARGE", "PACKAGE_TOO_MANY_FILES", "PACKAGE_UNSAFE_PATH",
  "MANIFEST_MISSING", "MANIFEST_INVALID_JSON", "MANIFEST_INVALID", "MANIFEST_FORMAT_UNSUPPORTED",
  "THEME_INVALID_JSON", "THEME_INVALID",
  "HOME_EMPTY", "TOO_MANY_SECTIONS", "PAGE_INVALID",
  "SECTION_TYPE_UNKNOWN", "SECTION_FILE_MISSING", "SECTION_FILE_REQUIRED", "SECTION_NATIVE_WITH_FILE", "SECTION_ROOT_INVALID", "SECTION_TYPE_MISMATCH", "SECTION_TOO_LARGE",
  "HTML_FORBIDDEN_TAG", "HTML_FORBIDDEN_ATTRIBUTE", "HTML_EVENT_HANDLER", "HTML_INLINE_STYLE", "HTML_UNSAFE_LINK",
  "FIELD_UNKNOWN", "FIELD_REQUIRED", "FIELD_DUPLICATED", "FIELD_WRONG_ELEMENT", "FIELD_NOT_TEXT",
  "REPEAT_INVALID", "REPEAT_REQUIRED",
  "ASSET_MISSING", "ASSET_EXTERNAL", "ASSET_FORMAT", "ASSET_TOO_LARGE", "ASSET_INVALID_IMAGE",
  "CSS_PARSE_ERROR", "CSS_TOO_LARGE", "CSS_FORBIDDEN_AT_RULE", "CSS_EXTERNAL_URL", "CSS_UNSAFE",
  "CSS_FIXED_POSITION", "CSS_NO_RESPONSIVE", "ASSET_UNUSED", "FILE_IGNORED", "HTML_ATTRIBUTE_REMOVED", "IMAGE_ALT_MISSING", "PREVIEW_MISSING",
];

/** Link aceito num `href` de seção: https, e-mail, telefone, âncora ou caminho do próprio site. */
export function safeTemplateHref(value: string): boolean {
  const href = value.trim();
  if (!href) return false;
  if (/^#[a-z0-9_-]+$/i.test(href) || /^\/(?!\/)[a-z0-9/_#-]*$/i.test(href)) return true;
  try { const url = new URL(href); return ["https:", "mailto:", "tel:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
