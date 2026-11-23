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
  /** Bloco do submenu (ex.: "Produção", "Publicação" no Marketing) — título discreto acima do grupo. */
  section?: string;
  /** Fase 7: permissões de leitura (basta UMA) para o item aparecer no menu global. */
  permission?: readonly string[];
};

export type WorkspaceNavSection = {
  label: string;
  items: readonly WorkspaceNavItem[];
};

export type SolutionNavigation = {
  home: WorkspaceNavItem;
  /** Ação principal em destaque no topo da sidebar (ex.: "Novo conteúdo"). */
  primaryAction?: WorkspaceNavItem & { cta: string };
  /** Atalho em destaque logo abaixo da ação principal (ex.: Bolsão de ideias). `alsoActiveOn` marca o
   * destaque como ativo em outras rotas do mesmo lugar (ex.: a aba "Em produção" do bolsão). */
  featured?: WorkspaceNavItem & { hint: string; alsoActiveOn?: readonly string[] };
  sections: readonly WorkspaceNavSection[];
  /** Área técnica, só para owner/admin (ver `canUseBackstage`). */
  backstage: readonly WorkspaceNavItem[];
};

/** Configurações é do Core: aparece em toda solução, sempre no mesmo lugar. */
export const SETTINGS_NAV: readonly WorkspaceNavItem[] = [{ href: "/settings", label: "Configurações", icon: "settings" }] as const;

const CONVERSATIONS_HOME: WorkspaceNavItem = { href: "", label: "Início", icon: "home" };
const CREATE_NAV_ITEM: WorkspaceNavItem = { href: "/create", label: "Criar conteúdo", icon: "create" };
/** Bolsão de ideias do workspace: as ideias de post e, na aba "Em produção", a fila da IA. É também
 * o início do Marketing — Bolsão e Produção são um lugar só. */
const IDEAS_NAV_ITEM: WorkspaceNavItem = { href: "/ideias", label: "Bolsão de ideias", icon: "ideas" };
const MARKETING_HOME: WorkspaceNavItem = IDEAS_NAV_ITEM;
// Fase 9: mesmos nomes do menu global (o breadcrumb usa estes rótulos).
const MEETINGS_HOME: WorkspaceNavItem = { href: "/meetings", label: "Reuniões", icon: "home" };
const MEETINGS_CENTRAL: WorkspaceNavItem = { href: "/meetings/central", label: "Gravações", icon: "recordings" };
const MEETINGS_AGENDA: WorkspaceNavItem = { href: "/meetings/agenda", label: "Agenda", icon: "calendar" };
const MEETINGS_INTEGRATIONS: WorkspaceNavItem = { href: "/meetings/integrations", label: "Agenda e integrações", icon: "connections" };
const MEETINGS_ASK: WorkspaceNavItem = { href: "/meetings/ask", label: "Análises", icon: "messages" };
const MEETINGS_SETTINGS: WorkspaceNavItem = { href: "/meetings/settings", label: "Preferências", icon: "settings" };
const MEETINGS_RECORDER_ACCOUNTS: WorkspaceNavItem = { href: "/meetings/recorder-accounts", label: "Contas de gravação", icon: "recordings" };

// Redes sociais (publicação multi-rede): criar, acompanhar e conectar contas.
const SOCIAL_COMPOSE: WorkspaceNavItem = { href: "/social/compose", label: "Criar publicação", icon: "publish" };
const SOCIAL_CALENDAR: WorkspaceNavItem = { href: "/social/calendar", label: "Publicações", icon: "calendar" };
const SOCIAL_INTEGRATIONS: WorkspaceNavItem = { href: "/social/integrations", label: "Integrações", icon: "connections" };

/** Bastidor técnico do Marketing (owner/admin) — exportado para o menu global. */
export const MARKETING_BACKSTAGE_NAV: readonly WorkspaceNavItem[] = [
  { href: "/planning", label: "Planejamento", icon: "planning" },
  { href: "/runtime", label: "Runtime", icon: "runtime" },
  { href: "/execution", label: "Execução", icon: "execution" },
  { href: "/publications", label: "Publicação técnica", icon: "publication-technical" },
  { href: "/providers", label: "Provedores", icon: "providers" },
  { href: "/governance", label: "Governança", icon: "governance" },
  { href: "/operations", label: "Operação", icon: "operations" },
] as const;

/**
 * Fase 11 — ferramentas INTERNAS da plataforma dentro do bastidor: "Operação" mostra saúde do
 * cofre de segredos, trava de produção e plano de backup, que são da Vorix inteira, não do cliente.
 * Só o admin da plataforma vê (menu e rota). As demais telas do bastidor usam dados do próprio
 * workspace e seguem para owner/admin.
 */
export const PLATFORM_ONLY_BACKSTAGE: readonly string[] = ["/operations"];

/** Itens do bastidor que esta pessoa pode ver. */
export function backstageItemsFor(isPlatformAdmin: boolean): readonly WorkspaceNavItem[] {
  return isPlatformAdmin ? MARKETING_BACKSTAGE_NAV : MARKETING_BACKSTAGE_NAV.filter((item) => !PLATFORM_ONLY_BACKSTAGE.includes(item.href));
}

/** `true` quando a rota é uma ferramenta interna da plataforma (só admin da Vorix). */
export function isPlatformOnlyPath(pathname: string, base: string): boolean {
  return PLATFORM_ONLY_BACKSTAGE.some((href) => pathname === `${base}${href}` || pathname.startsWith(`${base}${href}/`));
}

export const SOLUTION_NAVIGATION: Readonly<Record<SolutionKey, SolutionNavigation>> = {
  site:{home:{href:"/site",label:"Meu site",icon:"home"},sections:[{label:"SITE",items:[{href:"/site",label:"Editor do site",icon:"settings"},{href:"/site/products",label:"Produtos",icon:"products"},{href:"/site/pedidos",label:"Pedidos",icon:"orders"},{href:"/site/analytics",label:"Analytics",icon:"analytics"}]},{label:"VENDAS",items:[{href:"/site/oportunidades",label:"Oportunidades",icon:"deals"},{href:"/site/propostas",label:"Propostas",icon:"proposals"}]}],backstage:[]},
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
  },
  meetings: {
    home: MEETINGS_HOME,
    sections: [
      { label: "REUNIÕES", items: [MEETINGS_AGENDA, MEETINGS_CENTRAL, MEETINGS_ASK] },
      { label: "CONFIGURAÇÕES", items: [MEETINGS_SETTINGS, MEETINGS_INTEGRATIONS, MEETINGS_RECORDER_ACCOUNTS] },
    ],
    backstage: [],
  },
  marketing: {
    home: MARKETING_HOME,
    primaryAction: { ...CREATE_NAV_ITEM, cta: "Novo conteúdo" },
    featured: { ...IDEAS_NAV_ITEM, hint: "Ideias e posts em produção", alsoActiveOn: ["/production"] },
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
    backstage: MARKETING_BACKSTAGE_NAV,
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
  users: "Usuários e permissões",
  perfil: "Meu perfil",
  integracoes: "Integrações",
  teams: "Equipes",
  plano: "Plano e cobrança",
  marca: "Marca e identidade",
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
    if (navigation.featured) add(navigation.featured);
    navigation.sections.forEach((section) => section.items.forEach(add));
    navigation.backstage.forEach(add);
    // Telas fora da sidebar que fazem parte de um item dela (ex.: a aba "Em produção" do Bolsão).
    if (key === "marketing") {
      labels[`${base}/production`] ??= "Em produção";
      labels[`${base}/review`] ??= "Revisão";
    }
  }
  SETTINGS_NAV.forEach(add);
  // Fase 12: Resultados é de todas as ferramentas (não só do Conversas).
  if (available.length) labels[`${base}/results`] ??= "Resultados";
  // Subpáginas de configurações não estão na sidebar — sem isto o breadcrumb mostraria o slug ("Users").
  for (const [slug, label] of Object.entries(SETTINGS_SUBPAGE_LABELS)) labels[`${base}/settings/${slug}`] ??= label;
  return labels;
}
