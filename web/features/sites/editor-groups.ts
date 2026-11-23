import type { SiteSnapshot, TenantSite } from "@/features/sites/types";

/**
 * Organização do editor de sites (Reorganização de UX — Fase 8): as MESMAS seções de sempre
 * (`?section=` preservado), agrupadas pelo que a pessoa quer fazer — Modelo, Aparência, Conteúdo,
 * Vendas e Publicação e domínio. Nada de seção nova: só ordem, grupo e nome claros.
 */
export const SITE_EDITOR_GROUPS = ["MODELO", "APARÊNCIA", "CONTEÚDO", "VENDAS", "PUBLICAÇÃO E DOMÍNIO"] as const;
export type SiteEditorGroup = (typeof SITE_EDITOR_GROUPS)[number];
/** Nome do grupo na tela. */
export const SITE_EDITOR_GROUP_LABELS: Record<SiteEditorGroup, string> = {
  MODELO: "Modelo",
  "APARÊNCIA": "Aparência",
  "CONTEÚDO": "Conteúdo",
  VENDAS: "Vendas",
  "PUBLICAÇÃO E DOMÍNIO": "Publicação e domínio",
};

/** Seção → grupo e nome na tela (valores iguais aos de antes: links antigos continuam abrindo a seção certa). */
export const SITE_EDITOR_SECTIONS: readonly { value: string; label: string; group: SiteEditorGroup }[] = [
  { value: "modelos", label: "Modelos", group: "MODELO" },
  { value: "geral", label: "Sua marca e logo", group: "APARÊNCIA" },
  { value: "aparencia", label: "Cores, fontes e composição", group: "APARÊNCIA" },
  { value: "banners", label: "Banners e destaques", group: "CONTEÚDO" },
  { value: "secoes", label: "Seções da página inicial", group: "CONTEÚDO" },
  { value: "paginas", label: "Páginas", group: "CONTEÚDO" },
  { value: "menu", label: "Cabeçalho e menu", group: "CONTEÚDO" },
  { value: "rodape", label: "Rodapé", group: "CONTEÚDO" },
  { value: "contato", label: "Contato e redes sociais", group: "CONTEÚDO" },
  { value: "textos", label: "Textos do site", group: "CONTEÚDO" },
  { value: "catalogo", label: "Vitrine de produtos", group: "VENDAS" },
  { value: "loja", label: "Como vender pelo site", group: "VENDAS" },
  { value: "regras", label: "Regras comerciais", group: "VENDAS" },
  { value: "seo", label: "Aparecer no Google (SEO)", group: "PUBLICAÇÃO E DOMÍNIO" },
  { value: "dominio", label: "Endereço e domínio", group: "PUBLICAÇÃO E DOMÍNIO" },
];

export function groupOfSection(section: string): SiteEditorGroup | undefined {
  return SITE_EDITOR_SECTIONS.find((item) => item.value === section)?.group;
}

// --------------------------------------------------------------------------- Publicação

export type PublicationItem = { key: "published" | "changes" | "address" | "seo"; label: string; ok: boolean; detail: string; section?: string };

/**
 * Situação da publicação, só com o que o site já informa: se está no ar, se há alterações do
 * rascunho ainda não publicadas, endereço público (e troca de endereço pendente) e SEO preenchido.
 * Prévia ≠ publicação: nada aqui publica nada.
 */
export function publicationSummary(site: Pick<TenantSite, "slug" | "publishedAt" | "draft" | "published">, draft: SiteSnapshot, publicAddress: string): PublicationItem[] {
  // Mesma comparação da barra de estado do editor: rascunho SALVO × versão publicada.
  const pendingChanges = !site.published || JSON.stringify(site.draft) !== JSON.stringify(site.published);
  const slugChange = draft.siteSlug && draft.siteSlug !== site.slug ? draft.siteSlug : undefined;
  const seoTitle = draft.content.seo?.title?.trim();
  const seoDescription = draft.content.seo?.description?.trim();
  return [
    { key: "published", label: "Site no ar", ok: Boolean(site.publishedAt), detail: site.publishedAt ? `Publicado em ${new Date(site.publishedAt).toLocaleDateString("pt-BR")}` : "Ainda não publicado: só você vê a prévia." },
    { key: "changes", label: "Alterações publicadas", ok: Boolean(site.publishedAt) && !pendingChanges, detail: !site.publishedAt ? "Publique para os visitantes verem o site." : pendingChanges ? "Há alterações salvas no rascunho que os visitantes ainda não veem." : "Os visitantes veem a versão atual." },
    { key: "address", label: "Endereço", ok: !slugChange, detail: slugChange ? `Troca para "${slugChange}" vale depois de publicar.` : publicAddress, section: "dominio" },
    { key: "seo", label: "Busca no Google", ok: Boolean(seoTitle && seoDescription), detail: seoTitle && seoDescription ? "Título e descrição preenchidos." : "Preencha título e descrição para aparecer melhor nas buscas.", section: "seo" },
  ];
}
