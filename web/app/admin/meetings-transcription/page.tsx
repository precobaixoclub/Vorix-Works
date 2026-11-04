"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Engine = "LOCAL_FASTER_WHISPER" | "LOCAL_WHISPER_CPP" | "OPENAI_OPTIONAL";
type Settings = { engine: Engine; updatedAt?: string; openAiKeyConfigured: boolean };

const BASE = "/v1/admin/meetings/transcription-settings";
const message = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : "Tente novamente.");

const ENGINES: { id: Engine; title: string; badge?: string; description: string; cost: string }[] = [
  {
    id: "LOCAL_FASTER_WHISPER",
    title: "Local otimizado",
    badge: "Recomendado",
    description: "faster-whisper (CTranslate2, INT8) no próprio servidor. Melhor precisão em português entre os motores locais.",
    cost: "Gratuito. Usa recursos do servidor: 1 CPU e cerca de 600 MB de RAM enquanto transcreve, uma reunião por vez, só quando há folga.",
  },
  {
    id: "LOCAL_WHISPER_CPP",
    title: "Local econômico",
    description: "whisper.cpp com modelo quantizado. Para servidores pequenos: menor uso de memória, precisão um pouco menor.",
    cost: "Gratuito. Usa recursos do servidor: 1 CPU e cerca de 350 MB de RAM (modelo base).",
  },
  {
    id: "OPENAI_OPTIONAL",
    title: "OpenAI",
    description: "Transcrição feita na OpenAI. Não usa CPU do servidor para o modelo.",
    cost: "Pode gerar custo externo por minuto de áudio, cobrado na conta da OpenAI. Exige chave cadastrada em Provedores de IA.",
  },
];

/** Painel → Transcrição de reuniões: o motor vale para todas as próximas transcrições. */
export default function AdminMeetingsTranscriptionPage() {
  const { data, error, mutate } = useSWR("admin-meetings-transcription", () => apiClient.get<Settings>(BASE));
  const [choice, setChoice] = useState<Engine | null>(null);
  const [acceptCost, setAcceptCost] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data && !choice) setChoice(data.engine); }, [data, choice]);

  async function save() {
    if (!choice) return;
    setSaving(true);
    try {
      await mutate(await apiClient.put<Settings>(BASE, { engine: choice, ...(choice === "OPENAI_OPTIONAL" ? { acceptExternalCost: acceptCost } : {}) }), { revalidate: false });
      toast.success("Motor de transcrição atualizado", { description: "Vale para as próximas transcrições." });
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: message(cause) });
    } finally {
      setSaving(false);
    }
  }

  const changed = Boolean(data && choice && choice !== data.engine);
  const blocked = choice === "OPENAI_OPTIONAL" && (!acceptCost || !data?.openAiKeyConfigured);
  return (
    <main className="space-y-6 p-4 sm:p-8">
      <PageHeader title="Transcrição de reuniões" description="Motor usado para transcrever as gravações do Vorix Meetings. A transcrição acontece depois que a reunião termina, numa fila com uma transcrição por vez." />
      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Motor de transcrição">
            {ENGINES.map((engine) => {
              const selected = choice === engine.id;
              return (
                <button key={engine.id} type="button" role="radio" aria-checked={selected} onClick={() => setChoice(engine.id)}
                  className={cn("flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors", selected ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border hover:bg-muted/40")}>
                  <span className="flex items-center gap-2 font-medium">{engine.title}{engine.badge ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{engine.badge}</span> : null}{data.engine === engine.id ? <span className="text-xs font-normal text-muted-foreground">· em uso</span> : null}</span>
                  <span className="text-sm text-muted-foreground">{engine.description}</span>
                  <span className={cn("text-xs", engine.id === "OPENAI_OPTIONAL" ? "text-warning" : "text-muted-foreground")}>{engine.cost}</span>
                </button>
              );
            })}
          </div>
          {choice === "OPENAI_OPTIONAL" ? (
            <Card className="space-y-3 border-warning/40 bg-warning/5 p-4 text-sm">
              {!data.openAiKeyConfigured ? <p className="font-medium text-foreground">Nenhuma chave da OpenAI cadastrada. Cadastre a chave em Provedores de IA antes de escolher este motor.</p> : null}
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={acceptCost} onChange={(event) => setAcceptCost(event.target.checked)} />
                <span>Entendo que cada minuto transcrito pela OpenAI gera custo externo na conta da OpenAI.</span>
              </label>
            </Card>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{data.updatedAt ? `Última alteração: ${formatDateTime(data.updatedAt)}` : "Usando o padrão (Local otimizado)."}</p>
            <Button onClick={() => void save()} loading={saving} disabled={!changed || blocked || saving}>Salvar</Button>
          </div>
        </>
      ) : null}
    </main>
  );
}
