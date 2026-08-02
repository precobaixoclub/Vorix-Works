"use client";

import useSWR from "swr";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { getKnowledgeSnapshot } from "@/features/knowledge/data";

export default function KnowledgePage() {
  const workspace = useCurrentWorkspace();
  const { data: knowledge, isLoading } = useSWR(["knowledge", workspace.id], () => getKnowledgeSnapshot(workspace.name));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <PageHeader title="Central de Conhecimento" description="O que o Vorix sabe sobre esta marca — base para futuras campanhas e conversas." />

      {isLoading || !knowledge ? (
        <div className="flex items-center gap-2 py-14 text-sm text-ink-muted">
          <Spinner className="h-4 w-4" /> Carregando…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-ink">Empresa</span>
            </CardHeader>
            <CardBody className="flex flex-col gap-2 text-sm">
              <p className="text-ink">
                <span className="text-ink-muted">Nicho: </span>
                {knowledge.company.niche}
              </p>
              <p className="text-ink-muted">{knowledge.company.positioning}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-ink">DNA Criativo</span>
            </CardHeader>
            <CardBody className="flex flex-col gap-3 text-sm">
              <p className="text-ink-muted">{knowledge.creativeDna.toneOfVoice}</p>
              <div className="flex gap-1.5">
                {knowledge.creativeDna.colors.map((color) => (
                  <span key={color} className="h-6 w-6 rounded-full border border-border" style={{ backgroundColor: color }} title={color} />
                ))}
              </div>
              <p className="text-xs text-ink-faint">{knowledge.creativeDna.fonts.join(" · ")}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-ink">Produtos</span>
            </CardHeader>
            <CardBody>
              <ul className="list-inside list-disc space-y-1 text-sm text-ink">
                {knowledge.products.map((product) => (
                  <li key={product}>{product}</li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-ink">Diferenciais</span>
            </CardHeader>
            <CardBody>
              <ul className="list-inside list-disc space-y-1 text-sm text-ink">
                {knowledge.differentiators.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-ink">Público</span>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-ink-muted">{knowledge.audience}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-ink">Objetivos</span>
            </CardHeader>
            <CardBody>
              <ul className="list-inside list-disc space-y-1 text-sm text-ink">
                {knowledge.objectives.map((objective) => (
                  <li key={objective}>{objective}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
    </main>
  );
}
