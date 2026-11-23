import Link from "next/link";
import { FileImage, Lightbulb, Send } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ideia × Conteúdo × Publicação (Fase 5): os três conceitos do Marketing, sempre com o mesmo texto,
 * nas telas onde a confusão costuma acontecer (Bolsão e Conteúdos). Cada um aponta para onde mora.
 */
const CONCEPTS = [
  { key: "idea", icon: Lightbulb, title: "Ideia", text: "Planejamento do que postar. Pode ainda não ter sido produzida.", href: "/ideias", where: "Bolsão de ideias" },
  { key: "content", icon: FileImage, title: "Conteúdo", text: "A peça criada: arte ou vídeo com legenda, revisada antes de sair.", href: "/campaigns", where: "Revisão e Conteúdos" },
  { key: "publication", icon: Send, title: "Publicação", text: "O conteúdo enviado ou agendado para uma rede social.", href: "/calendar", where: "Calendário" },
] as const;

export function ConceptsExplainer({ base, current }: { base: string; current: (typeof CONCEPTS)[number]["key"] }) {
  return (
    <section aria-label="Ideia, conteúdo e publicação" className="mb-5 grid gap-2 sm:grid-cols-3" data-testid="concepts-explainer">
      {CONCEPTS.map((concept) => {
        const Icon = concept.icon;
        const active = concept.key === current;
        return (
          <div key={concept.key} data-concept={concept.key} className={cn("flex min-w-0 gap-2.5 rounded-xl border px-3 py-2.5", active ? "border-solution/50 bg-solution/5" : "border-border/70 bg-card")}>
            <Icon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-solution" : "text-muted-foreground")} />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">{concept.title}{active ? <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">· você está aqui</span> : null}</p>
              <p className="text-xs leading-snug text-muted-foreground">{concept.text}</p>
              {active ? null : <Link href={`${base}${concept.href}`} className="text-[11px] font-semibold text-primary hover:underline dark:text-primary-glow">Ver em {concept.where}</Link>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
