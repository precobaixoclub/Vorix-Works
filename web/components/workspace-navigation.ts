import type { NavIconId } from "@/components/NavIcon";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: NavIconId;
};

export type WorkspaceNavSection = {
  label: string;
  items: readonly WorkspaceNavItem[];
};

export const HOME_NAV_ITEM: WorkspaceNavItem = { href: "", label: "Início", icon: "home" };

export const CREATE_NAV_ITEM: WorkspaceNavItem = { href: "/create", label: "Criar conteúdo", icon: "create" };

export const MAIN_NAV_SECTIONS: readonly WorkspaceNavSection[] = [
  {
    label: "CRIATIVO",
    items: [
      { href: "/production", label: "Produção", icon: "production" },
      { href: "/campaigns", label: "Conteúdos", icon: "content" },
      { href: "/calendar", label: "Calendário", icon: "calendar" },
    ],
  },
  {
    label: "DISTRIBUIÇÃO",
    items: [
      { href: "/publish", label: "Publicar", icon: "publish" },
      { href: "/connections", label: "Conexões", icon: "connections" },
    ],
  },
  {
    label: "MARCA E RESULTADOS",
    items: [
      { href: "/knowledge", label: "Marca", icon: "brand" },
      { href: "/analytics", label: "Analytics", icon: "analytics" },
    ],
  },
] as const;

export const SETTINGS_NAV: readonly WorkspaceNavItem[] = [
  { href: "/settings", label: "Configurações", icon: "settings" },
] as const;

export const BACKSTAGE_NAV: readonly WorkspaceNavItem[] = [
  { href: "/planning", label: "Planejamento", icon: "planning" },
  { href: "/runtime", label: "Runtime", icon: "runtime" },
  { href: "/execution", label: "Execução", icon: "execution" },
  { href: "/publications", label: "Publicação Técnica", icon: "publication-technical" },
  { href: "/providers", label: "Provedores", icon: "providers" },
  { href: "/governance", label: "Governança", icon: "governance" },
  { href: "/operations", label: "Operação", icon: "operations" },
] as const;

export const PRIMARY_MOBILE_NAV: readonly WorkspaceNavItem[] = [
  HOME_NAV_ITEM,
  { href: "/production", label: "Produção", icon: "production" },
  { href: "/create", label: "Criar", icon: "create" },
  { href: "/campaigns", label: "Conteúdos", icon: "content" },
] as const;

export const MOBILE_MENU_NAV: readonly WorkspaceNavItem[] = [
  { href: "/publish", label: "Publicar", icon: "publish" },
  { href: "/calendar", label: "Calendário", icon: "calendar" },
  { href: "/connections", label: "Conexões", icon: "connections" },
  { href: "/knowledge", label: "Marca", icon: "brand" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/settings", label: "Configurações", icon: "settings" },
] as const;

export function canUseBackstage(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}
