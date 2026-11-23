import type { SolutionKey } from "@/lib/solutions";

/**
 * Configurações unificadas (Reorganização de UX — Fase 10). Antes, a tela mostrava só as opções da
 * ferramenta "ativa" (guardada na sessão): quem estava em Conversas não achava as de Reuniões. Agora
 * TODAS as ferramentas contratadas aparecem, em três níveis — Minha conta (pessoa), Espaço de
 * trabalho (empresa) e Conta e assinatura (comercial) — com as integrações agrupadas por finalidade.
 * Nenhuma tela nova de formulário: cada entrada leva à tela que já existia.
 */
export type SettingsCategory = "Minha conta" | "Espaço de trabalho" | "Atendimento e vendas" | "Site" | "Reuniões" | "Integrações" | "Conta e assinatura";
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = ["Minha conta", "Espaço de trabalho", "Atendimento e vendas", "Site", "Reuniões", "Integrações", "Conta e assinatura"];

export type SettingsSectionKey =
  | "profile" | "general" | "users" | "teams" | "brand"
  | "attendance" | "channels" | "service-rules" | "products" | "commercial" | "goals" | "automations"
  | "site-address" | "site-selling" | "site-products" | "marketplaces"
  | "meetings-preferences" | "meetings-recorder"
  | "integrations-hub" | "integrations" | "social" | "meetings-integrations"
  | "billing";

export type SettingsSection = {
  value: SettingsSectionKey;
  label: string;
  href: string;
  category: SettingsCategory;
  /** Aparece quando a conta tem QUALQUER uma destas ferramentas (sem a lista: sempre). */
  solutions?: readonly SolutionKey[];
  /** Some quando a conta tem estas ferramentas (ex.: Produtos do Site quando o CRM já tem o catálogo). */
  hiddenWith?: readonly SolutionKey[];
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { value: "profile", label: "Meu perfil", href: "/settings/perfil", category: "Minha conta" },
  { value: "general", label: "Geral", href: "/settings", category: "Espaço de trabalho" },
  { value: "users", label: "Usuários e permissões", href: "/settings/users", category: "Espaço de trabalho" },
  { value: "teams", label: "Equipes", href: "/settings/teams", category: "Espaço de trabalho" },
  { value: "brand", label: "Marca e identidade", href: "/settings/marca", category: "Espaço de trabalho", solutions: ["marketing"] },
  // Fase 6: "Atendimento e canais" — as três telas que já existiam, num grupo só.
  { value: "attendance", label: "Encerramento e avaliação", href: "/settings/attendance", category: "Atendimento e vendas", solutions: ["conversations"] },
  { value: "channels", label: "Canais de atendimento", href: "/conversas?aba=canais", category: "Atendimento e vendas", solutions: ["conversations"] },
  { value: "service-rules", label: "Regras de atendimento", href: "/conversas?aba=regras", category: "Atendimento e vendas", solutions: ["conversations"] },
  // Fase 7: um catálogo só — com Conversas, /products; numa conta só com Site, /site/products.
  { value: "products", label: "Produtos", href: "/products", category: "Atendimento e vendas", solutions: ["conversations"] },
  { value: "commercial", label: "Regras comerciais", href: "/settings/commercial", category: "Atendimento e vendas", solutions: ["conversations"] },
  { value: "goals", label: "Metas", href: "/settings/goals", category: "Atendimento e vendas", solutions: ["conversations"] },
  { value: "automations", label: "Automações", href: "/settings/automations", category: "Atendimento e vendas", solutions: ["conversations"] },
  { value: "site-address", label: "Endereço e domínio", href: "/site?section=dominio", category: "Site", solutions: ["site"] },
  { value: "site-selling", label: "Como vender pelo site", href: "/site?section=loja", category: "Site", solutions: ["site"] },
  { value: "site-products", label: "Produtos", href: "/site/products", category: "Site", solutions: ["site"], hiddenWith: ["conversations"] },
  { value: "marketplaces", label: "Marketplaces", href: "/settings/marketplaces", category: "Site", solutions: ["site", "conversations"] },
  // Fase 9: as preferências de Reuniões.
  { value: "meetings-preferences", label: "Preferências de reuniões", href: "/meetings/settings", category: "Reuniões", solutions: ["meetings"] },
  { value: "meetings-recorder", label: "Contas de gravação", href: "/meetings/recorder-accounts", category: "Reuniões", solutions: ["meetings"] },
  { value: "integrations-hub", label: "Todas as integrações", href: "/settings/integracoes", category: "Integrações" },
  { value: "integrations", label: "Instagram Direct", href: "/connections", category: "Integrações", solutions: ["conversations"] },
  { value: "social", label: "Redes sociais", href: "/social/integrations", category: "Integrações", solutions: ["marketing"] },
  { value: "meetings-integrations", label: "Agenda e reuniões", href: "/meetings/integrations", category: "Integrações", solutions: ["meetings"] },
  { value: "billing", label: "Plano e cobrança", href: "/settings/plano", category: "Conta e assinatura" },
];

/** Seções visíveis para as ferramentas CONTRATADAS (não para a "ativa"). Enquanto as ferramentas
 * carregam (`available` indefinido), só as seções comuns a todas aparecem. */
export function settingsSectionsFor(available: readonly SolutionKey[] | undefined): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => {
    if (!section.solutions) return true;
    if (!available) return false;
    if (section.hiddenWith?.some((key) => available.includes(key))) return false;
    return section.solutions.some((key) => available.includes(key));
  });
}

/** Seção de Configurações correspondente à rota atual (as telas com o mesmo shell). */
export function settingsSectionFromPath(pathname: string, base: string): SettingsSectionKey | undefined {
  const relative = pathname.slice(base.length).replace(/\/$/, "");
  const exact = SETTINGS_SECTIONS.find((section) => !section.href.includes("?") && section.href === relative);
  return exact?.value;
}

// --------------------------------------------------------------------------- Integrações

export type IntegrationState = "connected" | "attention" | "disconnected" | "unknown";

export const INTEGRATION_STATE_LABEL: Record<IntegrationState, string> = {
  connected: "Conectado",
  attention: "Requer atenção",
  disconnected: "Desconectado",
  unknown: "Situação não informada",
};

/** Situação de uma integração SÓ com o que o servidor informou — nada de "funcionando" presumido. */
export function integrationState(status: string | undefined): IntegrationState {
  if (status === "connected") return "connected";
  if (status === "pending" || status === "reconnect_required" || status === "needs_attention" || status === "requires_repair") return "attention";
  if (status === "disconnected" || status === "not_connected") return "disconnected";
  return "unknown";
}

const SOCIAL_CHANNELS = ["instagram", "facebook", "tiktok", "youtube", "meta", "linkedin"];
export function isSocialChannel(channel: string): boolean {
  const value = channel.toLowerCase();
  return SOCIAL_CHANNELS.some((key) => value.includes(key));
}
