import Link from "next/link";
import { ArrowRight, Lightbulb } from "lucide-react";

/** Atalho em destaque para o Bolsão de ideias (Produção e Criar conteúdo). */
export function IdeasPoolBanner({ workspaceId, className }: { workspaceId: string; className?: string }) {
  return (
    <Link
      href={`/workspaces/${workspaceId}/ideias`}
      className={`group flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 transition-colors hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 ${className ?? ""}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-300">
        <Lightbulb className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">Sem ideia do que postar? Abra o Bolsão de ideias</span>
        <span className="block text-sm text-muted-foreground">Ideias de post prontas, com legenda e roteiro. Escolha uma e crie o post em um clique.</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-amber-600">
        Abrir bolsão <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </Link>
  );
}
