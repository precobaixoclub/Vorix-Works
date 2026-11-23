import { Bot, Cpu, CreditCard, Globe, Mail, Mic, Share2, Video } from "lucide-react";
import type { HubItem } from "@/components/HubPage";

/**
 * Navegação da Administração da Vorix (Fase 11): ambiente SEPARADO do cliente, só para admin da
 * plataforma (`isPlatformAdmin`; o backend barra com `requirePlatformAdmin`). As telas são as que já
 * existiam, agora em categorias com acesso direto — sem páginas vazias para completar categorias.
 */
export const ADMIN_SETTINGS_ITEMS: HubItem[] = [
  { id: "ai-providers", title: "Provedores de IA", tagline: "Inteligência artificial", description: "Chaves e modelos da OpenAI e do Gemini usados pela IA da plataforma.", icon: Bot, route: "/admin/ai-providers", accent: "violet" },
  { id: "ai-gateway", title: "Gateway e extração de IA", tagline: "Inteligência artificial", description: "Chave da Anthropic e opções globais do gateway de IA.", icon: Cpu, route: "/admin/settings", accent: "violet" },
  { id: "billing", title: "Cobrança", tagline: "Pagamentos", description: "Credenciais do Mercado Pago usadas nas assinaturas e compras.", icon: CreditCard, route: "/admin/billing-provider", accent: "emerald" },
  { id: "email-notifications", title: "Notificações por e-mail", tagline: "Alertas da plataforma", description: "Configure quem recebe alertas de cadastros, assinaturas e publicações.", icon: Mail, route: "/admin/email-notifications", accent: "amber" },
  { id: "meetings-bots", title: "Contas de gravação", tagline: "Vorix Meetings", description: "Contas Google que gravam as reuniões dos clientes: dono, saúde e uso.", icon: Video, route: "/admin/meetings-bots", accent: "sky" },
  { id: "meetings-transcription", title: "Transcrição de reuniões", tagline: "Vorix Meetings", description: "Motor que transcreve as gravações depois que a reunião termina.", icon: Mic, route: "/admin/meetings-transcription", accent: "sky" },
  { id: "social", title: "Integrações sociais", tagline: "Vorix Marketing", description: "Provedores de publicação por rede social, por empresa ou para todos.", icon: Share2, route: "/admin/social-providers", accent: "amber" },
  { id: "site", title: "Sites e modelos", tagline: "Vorix Site", description: "Preço do site e catálogo e em quais planos ele entra.", icon: Globe, route: "/admin/site", accent: "rose" },
];

export const ADMIN_SETTINGS_HREF = "/admin/configuracoes";

export type AdminNavItem = { href: string; label: string; matches: (pathname: string) => boolean };
export type AdminNavGroup = { label: string; items: AdminNavItem[] };

const exact = (href: string): AdminNavItem["matches"] => (pathname) => pathname === href || pathname.startsWith(`${href}/`);
const setting = (id: string, label: string): AdminNavItem => {
  const route = ADMIN_SETTINGS_ITEMS.find((item) => item.id === id)!.route;
  return { href: route, label, matches: exact(route) };
};

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "Plataforma",
    items: [
      { href: "/admin", label: "Visão geral", matches: (pathname) => pathname === "/admin" },
      { href: "/admin/growth", label: "Aquisição e receita", matches: exact("/admin/growth") },
    ],
  },
  { label: "Clientes", items: [{ href: "/admin/tenants", label: "Empresas e planos", matches: exact("/admin/tenants") }] },
  { label: "Inteligência artificial", items: [setting("ai-providers", "Provedores de IA"), setting("ai-gateway", "Gateway de IA")] },
  { label: "Cobrança e avisos", items: [setting("billing", "Cobrança (Mercado Pago)"), setting("email-notifications", "Notificações por e-mail")] },
  {
    label: "Ferramentas",
    items: [
      setting("meetings-bots", "Reuniões: contas de gravação"),
      setting("meetings-transcription", "Reuniões: transcrição"),
      setting("social", "Marketing: integrações sociais"),
      { ...setting("site", "Site: preços e modelos"), matches: (pathname) => exact("/admin/site")(pathname) || pathname.startsWith("/admin/site-commerce") },
    ],
  },
  { label: "Configurações", items: [{ href: ADMIN_SETTINGS_HREF, label: "Todas as configurações", matches: exact(ADMIN_SETTINGS_HREF) }] },
];

/** Uma das telas de configuração (abre com o atalho "← Configurações"). */
export function isAdminSettingsPage(pathname: string): boolean {
  return ADMIN_SETTINGS_ITEMS.some((item) => pathname === item.route || pathname.startsWith(`${item.route}/`)) || pathname.startsWith("/admin/site-commerce");
}

/** Item ativo do menu: o de rota mais específica que casa. */
export function activeAdminItem(pathname: string): string | undefined {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.matches(pathname)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
