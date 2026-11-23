import type { NavIconId } from "@/components/NavIcon";
import { MARKETING_BACKSTAGE_NAV, type WorkspaceNavItem } from "@/components/workspace-navigation";
import type { SolutionKey } from "@/lib/solutions";

/**
 * Menu GLOBAL do workspace (Reorganização de UX — Fase 1). Substitui visualmente os menus separados
 * por solução: as áreas ficam sempre visíveis e trocar de ferramenta é UM clique, sem "seletor de
 * solução". Só reorganiza a NAVEGAÇÃO — todas as URLs são as mesmas de antes, e o bloqueio de
 * verdade continua no servidor (403) e no guarda do layout (`isRouteBlocked`).
 *
 * Uma área só aparece quando a conta tem a solução que ela exige (nada indisponível é mostrado
 * como se estivesse liberado). "Vendas" vale para Conversas e, numa conta só com Site, aponta para
 * as oportunidades/propostas do Site.
 */

export type GlobalAreaKey = "home" | "conversations" | "sales" | "marketing" | "site" | "meetings" | "results" | "settings";

export type GlobalArea = {
  key: GlobalAreaKey;
  label: string;
  icon: NavIconId;
  /** Para onde o clique na área leva (relativo ao workspace). */
  href: string;
  /** Telas da área (subitens). Vazio = a área é uma tela só. */
  items: readonly WorkspaceNavItem[];
  /** Prefixos de rota (relativos) que tornam a área ativa. `""` = só a raiz do workspace. */
  match: readonly string[];
};

const CONVERSATIONS_ITEMS: readonly WorkspaceNavItem[] = [
  // Fase 6: a operação de atendimento num lugar só. Contatos saiu de Vendas (o atendente usa o tempo
  // todo); a gestão comercial continua em Vendas e será reorganizada na Fase 7.
  { href: "/conversas", label: "Caixa de entrada", icon: "conversas", section: "Atendimento" },
  { href: "/kanban", label: "Atendimentos", icon: "kanban", section: "Atendimento" },
  { href: "/contacts", label: "Contatos", icon: "contacts", section: "Atendimento" },
  { href: "/radar", label: "Radar", icon: "radar", section: "Acompanhamento" },
];

/**
 * Vendas (Fase 7). Oportunidades, propostas e produtos do Site são as MESMAS entidades do CRM (as
 * rotas `/site/...` reexportam as mesmas telas) — por isso o menu mostra UM item de cada, nunca
 * "Oportunidades" e "Oportunidades do site" lado a lado. Com Conversas usa as rotas do CRM; numa
 * conta só com Site, as rotas `/site/...` (as do CRM são do Conversas e ficam bloqueadas lá).
 * Cada item só aparece com a permissão de leitura correspondente.
 */
const SALES_DEALS = { label: "Oportunidades", icon: "deals", section: "Gestão comercial", permission: ["deal:read"] } as const;
const SALES_PROPOSALS = { label: "Propostas", icon: "proposals", section: "Gestão comercial", permission: ["proposal:read"] } as const;
const SALES_TASKS = { href: "/tasks", label: "Atividades", icon: "tasks", section: "Gestão comercial", permission: ["task:read"] } as const;
const SALES_PRODUCTS = { label: "Produtos", icon: "products", section: "Produtos e pedidos", permission: ["product:read"] } as const;
const SALES_ORDERS = { href: "/site/pedidos", label: "Pedidos", icon: "orders", section: "Produtos e pedidos", permission: ["order:read", "commerce:read"] } as const;

function salesItems(has: (key: SolutionKey) => boolean): WorkspaceNavItem[] {
  const crm = has("conversations");
  return [
    { ...SALES_DEALS, href: crm ? "/deals" : "/site/oportunidades" },
    { ...SALES_PROPOSALS, href: crm ? "/proposals" : "/site/propostas" },
    ...(crm ? [SALES_TASKS] : []),
    { ...SALES_PRODUCTS, href: crm ? "/products" : "/site/products" },
    ...(has("site") ? [SALES_ORDERS] : []),
  ];
}

const MARKETING_ITEMS: readonly WorkspaceNavItem[] = [
  // Fase 5 — menu definitivo do Marketing, em dois blocos. O compositor (/social/compose) e o estúdio
  // avançado (/publish) abrem por dentro de "Criar conteúdo"; "Publicações" virou o Calendário único;
  // Marca e Redes sociais moram em Configurações.
  { href: "/ideias", label: "Bolsão de ideias", icon: "ideas", section: "Produção" },
  { href: "/create", label: "Criar conteúdo", icon: "create", section: "Produção" },
  { href: "/review", label: "Revisão", icon: "production", section: "Produção" },
  { href: "/campaigns", label: "Conteúdos", icon: "content", section: "Produção" },
  { href: "/calendar", label: "Calendário", icon: "calendar", section: "Publicação" },
  { href: "/meta-ads", label: "Anúncios", icon: "ads", section: "Publicação" },
];

/** Configurações com destinos das ferramentas: Atendimento e canais (Conversas, Fase 6), Marca e
 * identidade e Redes sociais (Marketing, Fase 5). Só "Geral" sozinho não vira submenu. */
const SETTINGS_GENERAL: WorkspaceNavItem = { href: "/settings", label: "Geral", icon: "settings" };
const SETTINGS_CONVERSATIONS_ITEMS: readonly WorkspaceNavItem[] = [{ href: "/settings/attendance", label: "Atendimento e canais", icon: "conversas" }];
// Fase 9: as preferências de Reuniões também a partir de Configurações (centralização da Fase 10).
const SETTINGS_MEETINGS_ITEMS: readonly WorkspaceNavItem[] = [{ href: "/meetings/settings", label: "Reuniões", icon: "meetings" }];
const SETTINGS_MARKETING_ITEMS: readonly WorkspaceNavItem[] = [
  { href: "/settings/marca", label: "Marca e identidade", icon: "brand" },
  { href: "/social/integrations", label: "Redes sociais", icon: "connections" },
];

function settingsItems(has: (key: SolutionKey) => boolean): WorkspaceNavItem[] {
  const extra = [...(has("conversations") ? SETTINGS_CONVERSATIONS_ITEMS : []), ...(has("marketing") ? SETTINGS_MARKETING_ITEMS : []), ...(has("meetings") ? SETTINGS_MEETINGS_ITEMS : [])];
  return extra.length ? [SETTINGS_GENERAL, ...extra] : [];
}

const SITE_ITEMS: readonly WorkspaceNavItem[] = [
  // Fase 7: Produtos e Pedidos ficam em Vendas; o Site cuida da loja e da experiência pública.
  { href: "/site", label: "Editor do site", icon: "settings" },
  { href: "/site/analytics", label: "Analytics", icon: "analytics" },
];

/**
 * Reuniões (Fase 9): o trabalho em quatro itens — Visão geral, Agenda, Gravações (a biblioteca única;
 * a antiga "Gravações" separada virou uma visão dela) e Análises (resultados da IA e perguntas). As
 * telas de configuração ficam num bloco próprio e também em Configurações › Reuniões.
 */
const MEETINGS_ITEMS: readonly WorkspaceNavItem[] = [
  { href: "/meetings", label: "Visão geral", icon: "home", section: "Reuniões" },
  { href: "/meetings/agenda", label: "Agenda", icon: "calendar", section: "Reuniões" },
  { href: "/meetings/central", label: "Gravações", icon: "recordings", section: "Reuniões" },
  { href: "/meetings/ask", label: "Análises", icon: "messages", section: "Reuniões" },
  { href: "/meetings/settings", label: "Preferências", icon: "settings", section: "Configurações" },
  { href: "/meetings/integrations", label: "Agenda e integrações", icon: "connections", section: "Configurações" },
  { href: "/meetings/recorder-accounts", label: "Contas de gravação", icon: "recordings", section: "Configurações" },
];

const RESULTS_ITEMS: readonly WorkspaceNavItem[] = [
  { href: "/results", label: "Painel", icon: "results" },
  { href: "/performance", label: "Desempenho", icon: "analytics" },
  { href: "/reports", label: "Relatórios", icon: "reports" },
];

const MARKETING_MATCH = [
  "/ideias", "/production", "/create", "/campaigns", "/calendar", "/publish", "/meta-ads", "/social/compose", "/social/calendar",
  "/assets", "/review", "/chat", "/analytics", "/instagram", "/facebook", "/tiktok",
  ...MARKETING_BACKSTAGE_NAV.map((item) => item.href),
] as const;

/** Áreas visíveis para a conta, na ordem do menu. */
export function buildGlobalNavigation(available: readonly SolutionKey[], can?: (permission: string) => boolean): GlobalArea[] {
  const has = (key: SolutionKey) => available.includes(key);
  // Fase 7: itens com permissão só aparecem para quem pode ler aquele dado. Sem `can` (permissões
  // ainda carregando), vale só a ferramenta contratada — o servidor barra de qualquer forma.
  const permitted = (items: readonly WorkspaceNavItem[]) => (can ? items.filter((item) => !item.permission || item.permission.some((permission) => can(permission))) : [...items]);
  const areas: GlobalArea[] = [];
  // Fase 3: todo workspace tem o Início unificado (central de todas as ferramentas contratadas).
  areas.push({ key: "home", label: "Início", icon: "home", href: "", items: [], match: [""] });
  if (has("conversations")) {
    areas.push({ key: "conversations", label: "Conversas", icon: "conversas", href: "/conversas", items: CONVERSATIONS_ITEMS, match: ["/conversas", "/kanban", "/radar", "/contacts"] });
  }
  if (has("conversations") || has("site")) {
    const items = permitted(salesItems(has));
    if (items.length) areas.push({ key: "sales", label: "Vendas", icon: "deals", href: items[0]!.href, items, match: ["/deals", "/products", "/tasks", "/proposals", "/site/oportunidades", "/site/propostas", "/site/products", "/site/pedidos"] });
  }
  if (has("marketing")) areas.push({ key: "marketing", label: "Marketing", icon: "marketing", href: "/ideias", items: MARKETING_ITEMS, match: MARKETING_MATCH });
  if (has("site")) areas.push({ key: "site", label: "Meu site", icon: "site", href: "/site", items: SITE_ITEMS, match: ["/site", "/commerce"] });
  if (has("meetings")) areas.push({ key: "meetings", label: "Reuniões", icon: "meetings", href: "/meetings", items: MEETINGS_ITEMS, match: ["/meetings"] });
  if (has("conversations")) areas.push({ key: "results", label: "Resultados", icon: "results", href: "/results", items: RESULTS_ITEMS, match: ["/results", "/performance", "/reports"] });
  areas.push({ key: "settings", label: "Configurações", icon: "settings", href: "/settings", items: settingsItems(has), match: ["/settings", "/connections", "/social/integrations", "/social/connect", "/knowledge"] });
  return areas;
}

function matchesPrefix(relative: string, prefix: string): boolean {
  if (prefix === "") return relative === "";
  return relative === prefix || relative.startsWith(`${prefix}/`);
}

/** Área ativa para a rota atual. "Vendas" é testada antes de "Meu site" (as vendas do Site moram em
 * `/site/oportunidades`). `undefined` = rota fora do menu (ex.: onboarding). */
export function activeGlobalArea(pathname: string, base: string, areas: readonly GlobalArea[]): GlobalAreaKey | undefined {
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  const relative = pathname.slice(base.length).replace(/\/$/, "");
  const order: GlobalAreaKey[] = ["home", "sales", "conversations", "marketing", "site", "meetings", "results", "settings"];
  for (const key of order) {
    const area = areas.find((candidate) => candidate.key === key);
    if (area?.match.some((prefix) => matchesPrefix(relative, prefix))) return key;
  }
  return undefined;
}

/** Telas que pertencem a um item do menu sem estar nele: a aba "Em produção" do Bolsão e, desde a
 * Fase 4, o compositor e o estúdio avançado (abertos por dentro de "Criar conteúdo"). */
const ITEM_ALIASES: Readonly<Record<string, string>> = { "/production": "/ideias", "/social/compose": "/create", "/publish": "/create", "/social/calendar": "/calendar", "/knowledge": "/settings/marca", "/social/connect": "/social/integrations", "/meetings/recordings": "/meetings/central" };

/** Subitem ativo: o de prefixo mais longo que casa com a rota (ex.: `/meetings/agenda` vence `/meetings`). */
export function activeGlobalItem(pathname: string, base: string, area: GlobalArea | undefined): string | undefined {
  if (!area) return undefined;
  const relative = pathname.slice(base.length).replace(/\/$/, "");
  return [...area.items]
    .filter((item) => matchesPrefix(relative, item.href) || Object.entries(ITEM_ALIASES).some(([alias, target]) => item.href === target && matchesPrefix(relative, alias)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

// ---------------------------------------------------------------------------------------------
// Fase 2 — navegação mobile e troca de workspace. Mesmas áreas (e mesmas regras de ferramenta
// contratada) do menu lateral: o celular só escolhe QUAIS áreas ficam na barra de baixo.

/** Áreas com acesso direto na barra inferior, na ordem. */
const MOBILE_BAR_PRIMARY: readonly GlobalAreaKey[] = ["home", "conversations", "marketing", "site", "meetings"];
/** Quando a conta não tem alguma das principais, estas ocupam a vaga (sem botão vazio). */
const MOBILE_BAR_FILL: readonly GlobalAreaKey[] = ["sales", "results"];
export const MOBILE_BAR_SLOTS = 5;

/** Áreas da barra inferior do celular (além do botão "Menu"). Nunca inclui Configurações. */
export function mobileBarAreas(areas: readonly GlobalArea[]): GlobalArea[] {
  const pick = (keys: readonly GlobalAreaKey[]) => keys.map((key) => areas.find((area) => area.key === key)).filter((area): area is GlobalArea => Boolean(area));
  return [...pick(MOBILE_BAR_PRIMARY), ...pick(MOBILE_BAR_FILL)].slice(0, MOBILE_BAR_SLOTS);
}

/**
 * Destino ao trocar de workspace: a MESMA área/tela de lista no outro workspace (sem perder o
 * contexto de onde a pessoa estava), mas nunca um registro, filtro ou busca do workspace anterior —
 * só o caminho da tela de lista, sem `?query` nem `#hash` nem id de registro. Sem área reconhecida
 * (ou área que a conta não tem), vai para a primeira área disponível — sem passar pela raiz, que
 * redirecionaria de novo numa conta sem Conversas.
 */
export function workspaceSwitchHref(pathname: string, currentBase: string, targetWorkspaceId: string, areas: readonly GlobalArea[]): string {
  const target = `/workspaces/${targetWorkspaceId}`;
  const key = activeGlobalArea(pathname.split(/[?#]/)[0]!, currentBase, areas);
  const area = areas.find((candidate) => candidate.key === key);
  if (area) return `${target}${activeGlobalItem(pathname, currentBase, area) ?? area.href}`;
  const first = areas.find((candidate) => candidate.key !== "settings");
  return `${target}${first?.href ?? ""}`;
}

/** Texto comparável: sem acento e sem diferença de maiúsculas. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
}

/** A partir de quantos espaços o seletor mostra a busca. */
export const WORKSPACE_SEARCH_MIN = 6;

/** Lista do seletor: o workspace atual primeiro, os outros em ordem alfabética; a busca ignora acento/caixa. */
export function organizeWorkspaces<T extends { id: string; name: string }>(workspaces: readonly T[], currentId: string, query = ""): T[] {
  const needle = normalize(query);
  const matches = needle ? workspaces.filter((workspace) => normalize(workspace.name).includes(needle)) : [...workspaces];
  return matches.sort((a, b) => (a.id === currentId ? -1 : b.id === currentId ? 1 : a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })));
}

/** Iniciais para o selo do workspace (ex.: "Rumo ao Altar" → "RA"). */
export function workspaceInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 0 && !/^(de|da|do|das|dos|e|a|o|ao|em)$/i.test(word));
  const letters = (words.length > 1 ? [words[0]!, words[1]!] : [words[0] ?? "?"]).map((word) => word[0]!.toLocaleUpperCase("pt-BR"));
  return words.length === 1 ? (words[0]!.slice(0, 2).toLocaleUpperCase("pt-BR")) : letters.join("");
}
