import type { EditorialIdea, EditorialIdeaStatus } from "@/features/editorial-ideas/api";
import type { SocialPostState, SocialPostView } from "@/features/social/types";

/**
 * Etapas do conteúdo no Marketing (Reorganização de UX — Fase 4), em português e sem termos
 * técnicos. Só TRADUZ os estados reais que já existem (ideia do Bolsão, publicação social) — nenhum
 * contrato interno muda. A mesma peça pode ter estado nos dois lados (a ideia "Produzida" e a
 * publicação "Agendada"); cada tela mostra o estado do objeto que ela exibe.
 */

export type ContentStage = "draft" | "in_production" | "awaiting_approval" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";

export const CONTENT_STAGE_LABEL: Record<ContentStage, string> = {
  draft: "Rascunho",
  in_production: "Em produção",
  awaiting_approval: "Aguardando aprovação",
  approved: "Aprovado",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

/** Tom visual de cada etapa (só para cor do selo). */
export const CONTENT_STAGE_TONE: Record<ContentStage, "neutral" | "progress" | "attention" | "success" | "danger"> = {
  draft: "neutral",
  in_production: "progress",
  awaiting_approval: "attention",
  approved: "success",
  scheduled: "progress",
  publishing: "progress",
  published: "success",
  failed: "danger",
  cancelled: "neutral",
};

/** Ideia do Bolsão → etapa. "Disponível" é a ideia ainda não usada (pendente). */
export function stageOfIdea(status: EditorialIdeaStatus): ContentStage | "idea" | "archived" {
  switch (status) {
    case "available": return "idea";
    case "in_production": return "in_production";
    case "produced": return "awaiting_approval";
    case "approved": return "approved";
    case "published": return "published";
    case "archived": return "archived";
  }
}

/** Publicação social → etapa. Sucesso parcial e reconexão pendente contam como falha a resolver. */
export function stageOfSocialPost(state: SocialPostState): ContentStage {
  switch (state) {
    case "DRAFT": return "draft";
    case "AWAITING_APPROVAL": return "awaiting_approval";
    case "SCHEDULED": return "scheduled";
    case "PUBLISHING": return "publishing";
    case "PUBLISHED": return "published";
    case "PARTIAL_SUCCESS":
    case "FAILED":
    case "RECONCILIATION_REQUIRED":
    case "WAITING_REAUTH": return "failed";
    case "CANCELLED": return "cancelled";
  }
}

export type PipelineStep = { key: "ideas" | "in_production" | "review" | "scheduled" | "published" | "failed"; label: string; count: number | undefined; href: string };

/**
 * Jornada do conteúdo no topo de "Criar conteúdo": quantos itens há em cada etapa e onde eles
 * moram. `undefined` = a fonte não carregou (a tela mostra "—", nunca 0 falso).
 */
export function contentPipeline(input: { ideas?: readonly Pick<EditorialIdea, "status">[]; posts?: readonly Pick<SocialPostView, "state">[] }): PipelineStep[] {
  const ideaCount = (status: EditorialIdeaStatus) => (input.ideas ? input.ideas.filter((idea) => idea.status === status).length : undefined);
  const postCount = (stage: ContentStage) => (input.posts ? input.posts.filter((post) => stageOfSocialPost(post.state) === stage).length : undefined);
  const sum = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  return [
    { key: "ideas", label: "Ideias pendentes", count: ideaCount("available"), href: "/ideias" },
    { key: "in_production", label: "Em produção", count: ideaCount("in_production"), href: "/production" },
    { key: "review", label: "Para revisar", count: sum(ideaCount("produced"), postCount("awaiting_approval")), href: "/review" },
    { key: "scheduled", label: "Agendados", count: postCount("scheduled"), href: "/social/calendar" },
    { key: "published", label: "Publicados", count: postCount("published"), href: "/campaigns?status=published" },
    { key: "failed", label: "Com falha", count: postCount("failed"), href: "/campaigns?status=failed" },
  ];
}
