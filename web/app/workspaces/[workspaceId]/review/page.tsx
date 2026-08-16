"use client";

import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { useCurrentWorkspace } from "@/contexts/workspace-context";

/**
 * Fica vazia até a geração automática (Produção → peça pronta) ser construída no backend — hoje
 * só existe o tanque de ideias, então não há nenhuma imagem/carrossel/vídeo gerado para aprovar.
 */
export default function ReviewPage() {
  const workspace = useCurrentWorkspace();

  return (
    <main className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Revisão e aprovação"
        description="Peças já geradas a partir de uma rotina ou de um conteúdo avulso aparecem aqui para você aprovar, pedir ajuste ou publicar."
      />

      <ScreenGuide
        title="Como esta tela vai funcionar"
        description="Ela nunca lista ideias do tanque — só imagem, carrossel ou vídeo já gerados."
        items={[
          "Visualizar a peça gerada antes de decidir.",
          "Aprovar para publicar ou agendar, conforme o modo da rotina.",
          "Pedir ajuste e devolver para gerar de novo.",
          "Acompanhar o que ainda está aguardando decisão.",
        ]}
        aside={<p>Para abastecer o que vai gerar, use <Link href={`/workspaces/${workspace.id}/production`} className="font-medium text-accent hover:underline">Produção</Link>.</p>}
      />

      <EmptyState
        icon={
          <svg viewBox="0 0 28 28" fill="none" className="h-8 w-8" aria-hidden="true">
            <path d="M4 16l3-9h14l3 9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M4 16h6.2c.4 1.6 1.8 2.7 3.8 2.7s3.4-1.1 3.8-2.7H24v6a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 22v-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        }
        title="Nada para revisar ainda"
        description="Nenhuma imagem, carrossel ou vídeo foi gerado ainda. Quando uma rotina ou um conteúdo avulso gerar uma peça final, ela aparece aqui para aprovação."
      />
    </main>
  );
}
