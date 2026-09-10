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

export const CREATE_NAV_ITEM: WorkspaceNavItem = { href: "/create", label: "Criar", icon: "create" };

export const MAIN_NAV_SECTIONS: readonly WorkspaceNavSection[] = [
  {
    label: "CONVERSAS",
    items: [
      { href: "/conversas", label: "Conversas", icon: "conversas" },
      { href: "/instagram-dm", label: "DM Instagram", icon: "messages" },
    ],
  },
  {
    label: "COMERCIAL",
    items: [
      { href: "/deals", label: "Negócios", icon: "deals" },
      { href: "/contacts", label: "Contatos", icon: "contacts" },
      { href: "/tasks", label: "Tarefas", icon: "tasks" },
      { href: "/proposals", label: "Propostas", icon: "proposals" },
    ],
  },
  {
    label: "MARKETING",
    items: [
      { href: "/production", label: "Produção", icon: "production" },
      { href: "/campaigns", label: "Conteúdos", icon: "content" },
      { href: "/calendar", label: "Calendário", icon: "calendar" },
      { href: "/publish", label: "Publicar", icon: "publish" },
      { href: "/meta-ads", label: "Anúncios", icon: "ads" },
    ],
  },
  {
    label: "RESULTADOS",
    items: [
      { href: "/results", label: "Resultados", icon: "results" },
    ],
  },
  {
    label: "SISTEMA",
    items: [
      { href: "/knowledge", label: "Marca", icon: "brand" },
      { href: "/connections", label: "Integrações", icon: "connections" },
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
  { href: "/publications", label: "Publicação técnica", icon: "publication-technical" },
  { href: "/providers", label: "Provedores", icon: "providers" },
  { href: "/governance", label: "Governança", icon: "governance" },
  { href: "/operations", label: "Operação", icon: "operations" },
] as const;

export const PRIMARY_MOBILE_NAV: readonly WorkspaceNavItem[] = [
  HOME_NAV_ITEM,
  { href: "/conversas", label: "Conversas", icon: "conversas" },
  CREATE_NAV_ITEM,
  { href: "/deals", label: "Negócios", icon: "deals" },
] as const;

export const MOBILE_MENU_SECTIONS: readonly WorkspaceNavSection[] = [
  {
    label: "Marketing",
    items: [
      { href: "/production", label: "Produção", icon: "production" },
      { href: "/campaigns", label: "Conteúdos", icon: "content" },
      { href: "/calendar", label: "Calendário", icon: "calendar" },
      { href: "/publish", label: "Publicar", icon: "publish" },
      { href: "/meta-ads", label: "Anúncios", icon: "ads" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/contacts", label: "Contatos", icon: "contacts" },
      { href: "/tasks", label: "Tarefas", icon: "tasks" },
      { href: "/proposals", label: "Propostas", icon: "proposals" },
    ],
  },
  {
    label: "Resultados",
    items: [
      { href: "/results", label: "Resultados", icon: "results" },
    ],
  },
  {
    label: "Configurações",
    items: [
      { href: "/knowledge", label: "Marca", icon: "brand" },
      { href: "/connections", label: "Integrações", icon: "connections" },
      { href: "/settings", label: "Configurações", icon: "settings" },
      { href: "/instagram-dm", label: "DM Instagram", icon: "messages" },
    ],
  },
] as const;

export function canUseBackstage(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function buildRouteLabels(base: string): Record<string, string> {
  const allItems: readonly WorkspaceNavItem[] = [
    HOME_NAV_ITEM,
    CREATE_NAV_ITEM,
    ...MAIN_NAV_SECTIONS.flatMap((section) => section.items),
    ...SETTINGS_NAV,
    ...BACKSTAGE_NAV,
  ];
  const labels: Record<string, string> = {};
  for (const item of allItems) {
    if (item.href) labels[`${base}${item.href}`] = item.label;
  }
  return labels;
}
