import type { NavIconId } from "@/components/NavIcon";
import type { SolutionKey } from "@/lib/solutions";

/**
 * Navegação do workspace POR SOLUÇÃO. Cada solução do Vorix tem o próprio menu — nunca uma
 * sidebar única misturando atendimento com criação de conteúdo. Uma nova solução entra aqui com
 * a própria entrada em `SOLUTION_NAVIGATION`, sem tocar nas outras.
 */

export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: NavIconId;
};

export type WorkspaceNavSection = {
  label: string;
  items: readonly WorkspaceNavItem[];
};

export type SolutionNavigation = {
  home: WorkspaceNavItem;
  /** Ação principal em destaque no topo da sidebar (ex.: "Novo conteúdo"). */
  primaryAction?: WorkspaceNavItem & { cta: string };
  sections: readonly WorkspaceNavSection[];
  /** Área técnica, só para owner/admin (ver `canUseBackstage`). */
  backstage: readonly WorkspaceNavItem[];
  mobilePrimary: readonly WorkspaceNavItem[];
  mobileMenu: readonly WorkspaceNavSection[];
};

/** Configurações é do Core: aparece em toda solução, sempre no mesmo lugar. */
export const SETTINGS_NAV: readonly WorkspaceNavItem[] = [{ href: "/settings", label: "Configurações", icon: "settings" }] as const;

const CONVERSATIONS_HOME: WorkspaceNavItem = { href: "", label: "Início", icon: "home" };
const MARKETING_HOME: WorkspaceNavItem = { href: "/production", label: "Produção", icon: "production" };
const CREATE_NAV_ITEM: WorkspaceNavItem = { href: "/create", label: "Criar", icon: "create" };
const MEETINGS_HOME: WorkspaceNavItem = { href: "/meetings", label: "Início", icon: "home" };
const MEETINGS_CENTRAL: WorkspaceNavItem = { href: "/meetings/central", label: "Reuniões", icon: "meetings" };
const MEETINGS_RECORDINGS: WorkspaceNavItem = { href: "/meetings/recordings", label: "Gravações", icon: "recordings" };
const MEETINGS_AGENDA: WorkspaceNavItem = { href: "/meetings/agenda", label: "Agenda", icon: "calendar" };
const MEETINGS_INTEGRATIONS: WorkspaceNavItem = { href: "/meetings/integrations", label: "Integrações", icon: "connections" };
const MEETINGS_ASK: WorkspaceNavItem = { href: "/meetings/ask", label: "Pergunte às reuniões", icon: "messages" };
const MEETINGS_SETTINGS: WorkspaceNavItem = { href: "/meetings/settings", label: "Preferências", icon: "settings" };
const MEETINGS_RECORDER_ACCOUNTS: WorkspaceNavItem = { href: "/meetings/recorder-accounts", label: "Contas de gravação", icon: "recordings" };

// Redes sociais (publicação multi-rede): criar, acompanhar e conectar contas.
const SOCIAL_COMPOSE: WorkspaceNavItem = { href: "/social/compose", label: "Criar publicação", icon: "publish" };
const SOCIAL_CALENDAR: WorkspaceNavItem = { href: "/social/calendar", label: "Publicações", icon: "calendar" };
const SOCIAL_INTEGRATIONS: WorkspaceNavItem = { href: "/social/integrations", label: "Integrações", icon: "connections" };

const MARKETING_BACKSTAGE: readonly WorkspaceNavItem[] = [
  { href: "/planning", label: "Planejamento", icon: "planning" },
  { href: "/runtime", label: "Runtime", icon: "runtime" },
  { href: "/execution", label: "Execução", icon: "execution" },
  { href: "/publications", label: "Publicação técnica", icon: "publication-technical" },
  { href: "/providers", label: "Provedores", icon: "providers" },
  { href: "/governance", label: "Governança", icon: "governance" },
  { href: "/operations", label: "Operação", icon: "operations" },
] as const;

export const SOLUTION_NAVIGATION: Readonly<Record<SolutionKey, SolutionNavigation>> = {
  site:{home:{href:"/site",label:"Meu site",icon:"home"},sections:[{label:"SITE",items:[{href:"/site",label:"Editor do site",icon:"settings"},{href:"/site/products",label:"Produtos",icon:"products"},{href:"/site/pedidos",label:"Pedidos",icon:"orders"},{href:"/site/analytics",label:"Analytics",icon:"analytics"}]}],backstage:[],mobilePrimary:[{href:"/site",label:"Meu site",icon:"home"},{href:"/site/products",label:"Produtos",icon:"products"},{href:"/site/pedidos",label:"Pedidos",icon:"orders"},{href:"/site/analytics",label:"Analytics",icon:"analytics"}],mobileMenu:[]},
  conversations: {
    home: CONVERSATIONS_HOME,
    sections: [
      {
        label: "ATENDIMENTO",
        items: [
          { href: "/conversas", label: "Conversas", icon: "conversas" },
          { href: "/kanban", label: "Kanban", icon: "kanban" },
          { href: "/radar", label: "Radar", icon: "radar" },
        ],
      },
      {
        label: "COMERCIAL",
        items: [
          { href: "/deals", label: "Oportunidades", icon: "deals" },
          { href: "/contacts", label: "Contatos", icon: "contacts" },
          { href: "/products", label: "Produtos", icon: "products" },
          { href: "/tasks", label: "Tarefas", icon: "tasks" },
          { href: "/proposals", label: "Propostas", icon: "proposals" },
        ],
      },
      {
        label: "RESULTADOS",
        items: [
          { href: "/performance", label: "Desempenho", icon: "analytics" },
          { href: "/results", label: "Painel", icon: "results" },
          { href: "/reports", label: "Relatórios", icon: "reports" },
        ],
      },
    ],
    backstage: [],
    mobilePrimary: [
      CONVERSATIONS_HOME,
      { href: "/conversas", label: "Conversas", icon: "conversas" },
      { href: "/deals", label: "Oportunidades", icon: "deals" },
      { href: "/contacts", label: "Contatos", icon: "contacts" },
    ],
    mobileMenu: [
      {
        label: "Atendimento",
        items: [
          { href: "/kanban", label: "Kanban", icon: "kanban" },
          { href: "/radar", label: "Radar", icon: "radar" },
        ],
      },
      {
        label: "Comercial",
        items: [
          { href: "/products", label: "Produtos", icon: "products" },
          { href: "/tasks", label: "Tarefas", icon: "tasks" },
          { href: "/proposals", label: "Propostas", icon: "proposals" },
          { href: "/performance", label: "Desempenho", icon: "analytics" },
        ],
      },
      {
        label: "Resultados",
        items: [
          { href: "/results", label: "Painel", icon: "results" },
          { href: "/reports", label: "Relatórios", icon: "reports" },
        ],
      },
      {
        label: "Conta",
        items: [{ href: "/settings", label: "Configurações", icon: "settings" }],
      },
    ],
  },
  meetings: {
    home: MEETINGS_HOME,
    sections: [
      { label: "REUNIÕES", items: [MEETINGS_AGENDA, MEETINGS_CENTRAL, MEETINGS_RECORDINGS, MEETINGS_ASK] },
      { label: "CONFIGURAÇÕES", items: [MEETINGS_SETTINGS, MEETINGS_INTEGRATIONS, MEETINGS_RECORDER_ACCOUNTS] },
    ],
    backstage: [],
    mobilePrimary: [MEETINGS_HOME, MEETINGS_AGENDA, MEETINGS_CENTRAL, MEETINGS_RECORDINGS],
    mobileMenu: [{ label: "Meetings", items: [MEETINGS_ASK] }, { label: "Configurações do Meetings", items: [MEETINGS_SETTINGS, MEETINGS_INTEGRATIONS, MEETINGS_RECORDER_ACCOUNTS] }, { label: "Conta", items: [{ href: "/settings", label: "Configurações", icon: "settings" }] }],
  },
  marketing: {
    home: MARKETING_HOME,
    primaryAction: { ...CREATE_NAV_ITEM, cta: "Novo conteúdo" },
    sections: [
      {
        label: "CONTEÚDO",
        items: [
          { href: "/campaigns", label: "Conteúdos", icon: "content" },
          { href: "/calendar", label: "Calendário", icon: "calendar" },
          { href: "/publish", label: "Publicar", icon: "publish" },
          { href: "/meta-ads", label: "Anúncios", icon: "ads" },
        ],
      },
      {
        label: "REDES SOCIAIS",
        items: [SOCIAL_COMPOSE, SOCIAL_CALENDAR, SOCIAL_INTEGRATIONS],
      },
      {
        label: "MARCA",
        items: [{ href: "/knowledge", label: "Marca", icon: "brand" }],
      },
    ],
    backstage: MARKETING_BACKSTAGE,
    mobilePrimary: [MARKETING_HOME, CREATE_NAV_ITEM, { href: "/campaigns", label: "Conteúdos", icon: "content" }, { href: "/calendar", label: "Calendário", icon: "calendar" }],
    mobileMenu: [
      {
        label: "Redes sociais",
        items: [SOCIAL_COMPOSE, SOCIAL_CALENDAR, SOCIAL_INTEGRATIONS],
      },
      {
        label: "Conteúdo",
        items: [
          { href: "/publish", label: "Publicar", icon: "publish" },
          { href: "/meta-ads", label: "Anúncios", icon: "ads" },
        ],
      },
      {
        label: "Marca",
        items: [{ href: "/knowledge", label: "Marca", icon: "brand" }],
      },
      {
        label: "Conta",
        items: [{ href: "/settings", label: "Configurações", icon: "settings" }],
      },
    ],
  },
};

export function canUseBackstage(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** `true` quando a rota é do bastidor técnico de alguma solução. */
export function isBackstagePath(pathname: string, base: string): boolean {
  return Object.values(SOLUTION_NAVIGATION).some((navigation) => navigation.backstage.some((item) => pathname.startsWith(`${base}${item.href}`)));
}

/** Rótulos de breadcrumb SÓ das soluções a que a conta tem acesso — uma URL do Marketing aberta
 * por quem não tem a solução não ganha nem o nome da tela no breadcrumb. */
const SETTINGS_SUBPAGE_LABELS: Record<string, string> = {
  marketplaces: "Marketplaces",
  users: "Usuários",
  teams: "Equipes",
  plano: "Plano e cobrança",
  commercial: "Regras comerciais",
  goals: "Metas",
  automations: "Automações",
};

export function buildRouteLabels(base: string, available: readonly SolutionKey[]): Record<string, string> {
  const labels: Record<string, string> = {};
  const add = (item: WorkspaceNavItem) => {
    if (item.href) labels[`${base}${item.href}`] = item.label;
  };
  for (const key of available) {
    const navigation = SOLUTION_NAVIGATION[key];
    add(navigation.home);
    if (navigation.primaryAction) add(navigation.primaryAction);
    navigation.sections.forEach((section) => section.items.forEach(add));
    navigation.backstage.forEach(add);
  }
  SETTINGS_NAV.forEach(add);
  // Subpáginas de configurações não estão na sidebar — sem isto o breadcrumb mostraria o slug ("Users").
  for (const [slug, label] of Object.entries(SETTINGS_SUBPAGE_LABELS)) labels[`${base}/settings/${slug}`] ??= label;
  return labels;
}
