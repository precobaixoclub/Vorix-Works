import { delay } from "@/lib/mock";
import type { KnowledgeSnapshot } from "./types";

/**
 * Dados simulados — Sprint 04 (Fase 6). Espelha o vocabulário dos módulos reais de Clara
 * (`BrandContext`, `AudienceContext`, `ProductContext` etc. — ver `src/application/knowledge/`
 * no backend), sem nenhuma ligação de verdade com Clara ainda: é só a vitrine de como esses dados
 * vão aparecer quando o Knowledge Center tiver um endpoint real por trás.
 */
export async function getKnowledgeSnapshot(workspaceName: string): Promise<KnowledgeSnapshot> {
  await delay();
  return {
    company: {
      name: workspaceName,
      niche: "Marketing digital",
      positioning: `Ajudar ${workspaceName} a se comunicar com clareza e consistência em todos os canais.`,
    },
    creativeDna: {
      toneOfVoice: "Direto, confiante, próximo — sem jargão desnecessário.",
      colors: ["#4338CA", "#111111", "#FFFFFF"],
      fonts: ["Inter", "Playfair Display"],
    },
    products: ["Produto principal", "Linha de serviços recorrentes"],
    differentiators: ["Atendimento consultivo", "Entrega rápida", "Consistência visual entre campanhas"],
    audience: "Pessoas que já conhecem a marca e buscam decidir com mais confiança.",
    objectives: ["Aumentar reconhecimento de marca", "Gerar leads qualificados", "Fortalecer a comunidade"],
  };
}
