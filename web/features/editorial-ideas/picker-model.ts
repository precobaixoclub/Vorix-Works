import type { EditorialIdea } from "@/features/editorial-ideas/api";

/** "dd/mm" da data editorial (planejamento da ideia — não é a data em que o post vai ao ar). */
export function editorialDateLabel(idea: Pick<EditorialIdea, "scheduledDate" | "suggestedDate">): string | undefined {
  const value = idea.scheduledDate ?? idea.suggestedDate;
  if (!value) return undefined;
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}` : undefined;
}

/** Ideias pendentes, das planejadas para mais cedo às sem data; busca por título, categoria ou mensagem. */
export function pickableIdeas(ideas: readonly EditorialIdea[], query: string): EditorialIdea[] {
  const needle = query.trim().toLocaleLowerCase("pt-BR");
  return ideas
    .filter((idea) => idea.status === "available")
    .filter((idea) => !needle || [idea.title, idea.category, idea.keyMessage].some((text) => text?.toLocaleLowerCase("pt-BR").includes(needle)))
    .sort((a, b) => (a.scheduledDate ?? a.suggestedDate ?? "9999").localeCompare(b.scheduledDate ?? b.suggestedDate ?? "9999") || (a.priority === "high" ? -1 : 0) - (b.priority === "high" ? -1 : 0));
}
