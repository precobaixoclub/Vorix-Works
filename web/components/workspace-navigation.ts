export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: string;
};

export type WorkspaceNavSection = {
  label: string;
  items: readonly WorkspaceNavItem[];
};

export const MAIN_NAV_SECTIONS: readonly WorkspaceNavSection[] = [
  {
    label: "INÍCIO",
    items: [
      { href: "", label: "Início", icon: "◆" },
      { href: "/create", label: "Criar", icon: "+" },
    ],
  },
  {
    label: "CRIATIVO",
    items: [
      { href: "/production", label: "Produção", icon: "▤" },
      { href: "/campaigns", label: "Conteúdos", icon: "▥" },
      { href: "/calendar", label: "Calendário", icon: "□" },
    ],
  },
  {
    label: "DISTRIBUIÇÃO",
    items: [
      { href: "/publish", label: "Publicar", icon: "▲" },
      { href: "/connections", label: "Conexões", icon: "⌁" },
    ],
  },
  {
    label: "MARCA",
    items: [{ href: "/knowledge", label: "Marca", icon: "◇" }],
  },
  {
    label: "RESULTADOS",
    items: [{ href: "/analytics", label: "Analytics", icon: "●" }],
  },
] as const;

export const SETTINGS_NAV: readonly WorkspaceNavItem[] = [
  { href: "/settings", label: "Configurações", icon: "⚙" },
] as const;

export const BACKSTAGE_NAV: readonly WorkspaceNavItem[] = [
  { href: "/planning", label: "Planejamento", icon: "⌑" },
  { href: "/runtime", label: "Runtime", icon: "⚙" },
  { href: "/execution", label: "Execução", icon: "▶" },
  { href: "/publications", label: "Publicação Técnica", icon: "▣" },
  { href: "/providers", label: "Provedores", icon: "◇" },
  { href: "/governance", label: "Governança", icon: "▧" },
  { href: "/operations", label: "Operação", icon: "▦" },
] as const;

export const PRIMARY_MOBILE_NAV: readonly WorkspaceNavItem[] = [
  { href: "", label: "Início", icon: "◆" },
  { href: "/production", label: "Produção", icon: "▤" },
  { href: "/create", label: "Criar", icon: "+" },
  { href: "/campaigns", label: "Conteúdos", icon: "▥" },
] as const;

export const MOBILE_MENU_NAV: readonly WorkspaceNavItem[] = [
  { href: "/publish", label: "Publicar", icon: "▲" },
  { href: "/calendar", label: "Calendário", icon: "□" },
  { href: "/connections", label: "Conexões", icon: "⌁" },
  { href: "/knowledge", label: "Marca", icon: "◇" },
  { href: "/analytics", label: "Analytics", icon: "●" },
  { href: "/settings", label: "Configurações", icon: "⚙" },
] as const;

export function canUseBackstage(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}
