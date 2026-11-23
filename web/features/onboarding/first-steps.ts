import type { SolutionKey } from "@/lib/solutions";

/**
 * Primeiros passos por ferramenta contratada (Fase 13) — mostrados ao fim do onboarding. Só LINKS
 * para as telas que já configuram cada coisa: nenhuma conexão externa é feita automaticamente.
 */
export type FirstStep = { label: string; href: string };
export type ToolFirstSteps = { tool: SolutionKey; title: string; description: string; steps: FirstStep[] };

const ORDER: readonly SolutionKey[] = ["conversations", "marketing", "site", "meetings"];

const STEPS: Record<SolutionKey, Omit<ToolFirstSteps, "tool">> = {
  conversations: {
    title: "Conversas",
    description: "Atenda pelo WhatsApp e acompanhe as vendas.",
    steps: [{ label: "Conectar canais de atendimento", href: "/conversas?aba=canais" }, { label: "Revisar o funil de vendas", href: "/deals" }],
  },
  marketing: {
    title: "Marketing",
    description: "A IA cria conteúdo a partir da sua marca.",
    steps: [{ label: "Cadastrar a marca e identidade", href: "/settings/marca" }, { label: "Conectar as redes sociais", href: "/social/integrations" }],
  },
  site: {
    title: "Meu site",
    description: "Escolha um modelo e publique quando quiser.",
    steps: [{ label: "Escolher o modelo do site", href: "/site?section=modelos" }, { label: "Definir como vender pelo site", href: "/site?section=loja" }],
  },
  meetings: {
    title: "Reuniões",
    description: "Agenda, gravação, transcrição e resumo.",
    steps: [{ label: "Conectar a Google Agenda", href: "/meetings/integrations" }, { label: "Conectar contas de gravação", href: "/meetings/recorder-accounts" }],
  },
};

export function firstStepsFor(available: readonly SolutionKey[]): ToolFirstSteps[] {
  return ORDER.filter((tool) => available.includes(tool)).map((tool) => ({ tool, ...STEPS[tool] }));
}
