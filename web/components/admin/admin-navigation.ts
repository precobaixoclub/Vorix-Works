import { Bot, Cpu, CreditCard, Globe, Mic, Share2, Video } from "lucide-react";
import type { HubItem } from "@/components/HubPage";

/**
 * Navegação do admin da plataforma: três destinos só. "Visão geral" (números da plataforma e
 * aquisição), "Clientes" (tudo de UM cliente) e "Configurações" (o que vale para todos).
 */
export const ADMIN_SETTINGS_ITEMS: HubItem[] = [
  { id: "ai-providers", title: "Provedores de IA", tagline: "Inteligência artificial", description: "Chaves e modelos da OpenAI e do Gemini usados pela IA da plataforma.", icon: Bot, route: "/admin/ai-providers", accent: "violet" },
  { id: "ai-gateway", title: "Gateway e extração de IA", tagline: "Inteligência artificial", description: "Chave da Anthropic e opções globais do gateway de IA.", icon: Cpu, route: "/admin/settings", accent: "violet" },
  { id: "billing", title: "Cobrança", tagline: "Pagamentos", description: "Credenciais do Mercado Pago usadas nas assinaturas e compras.", icon: CreditCard, route: "/admin/billing-provider", accent: "emerald" },
  { id: "meetings-bots", title: "Contas de gravação", tagline: "Vorix Meetings", description: "Contas Google que gravam as reuniões dos clientes: dono, saúde e uso.", icon: Video, route: "/admin/meetings-bots", accent: "sky" },
  { id: "meetings-transcription", title: "Transcrição de reuniões", tagline: "Vorix Meetings", description: "Motor que transcreve as gravações depois que a reunião termina.", icon: Mic, route: "/admin/meetings-transcription", accent: "sky" },
  { id: "social", title: "Integrações sociais", tagline: "Vorix Marketing", description: "Provedores de publicação por rede social, por empresa ou para todos.", icon: Share2, route: "/admin/social-providers", accent: "amber" },
  { id: "site", title: "Sites e modelos", tagline: "Vorix Site", description: "Preço do site e catálogo e em quais planos ele entra.", icon: Globe, route: "/admin/site", accent: "rose" },
];

export const ADMIN_SETTINGS_HREF = "/admin/configuracoes";

export const ADMIN_NAVIGATION: { href: string; label: string; matches: (pathname: string) => boolean }[] = [
  { href: "/admin", label: "Visão geral", matches: (pathname) => pathname === "/admin" || pathname.startsWith("/admin/growth") },
  { href: "/admin/tenants", label: "Clientes", matches: (pathname) => pathname.startsWith("/admin/tenants") },
  { href: ADMIN_SETTINGS_HREF, label: "Configurações", matches: (pathname) => isAdminSettingsPage(pathname) || pathname.startsWith(ADMIN_SETTINGS_HREF) },
];

/** Uma das telas de configuração (abre com o atalho "← Configurações"). */
export function isAdminSettingsPage(pathname: string): boolean {
  return ADMIN_SETTINGS_ITEMS.some((item) => pathname === item.route || pathname.startsWith(`${item.route}/`)) || pathname.startsWith("/admin/site-commerce");
}
