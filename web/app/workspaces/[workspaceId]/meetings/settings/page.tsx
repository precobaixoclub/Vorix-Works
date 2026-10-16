"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Gauge, MessageSquareWarning, Pencil, Tags, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { formatBytes, formatTimestamp } from "@/features/meetings/presentation";
import {
  deleteKeywordTracker, keywordReport, saveKeywordTracker, updateMeetingPreferences, useKeywordTrackers, useMeetingPreferences, useMeetingsUsage,
  type AutoRecordMode, type KeywordTracker, type SummaryTemplateKey,
} from "@/features/meetings/intelligence";
import { ApiError } from "@/lib/api-client";

const TEMPLATE_OPTIONS: [SummaryTemplateKey, string][] = [["general", "Geral"], ["sales", "Vendas (BANT)"], ["internal", "Reunião interna"], ["one_on_one", "1:1 (líder e liderado)"], ["interview", "Entrevista de emprego"], ["support", "Atendimento / suporte"]];
const AUTO_RECORD_OPTIONS: [AutoRecordMode, string, string][] = [
  ["off", "Não gravar automaticamente", "Você escolhe evento por evento na Agenda."],
  ["external_only", "Gravar reuniões com pessoas de fora", "Toda reunião com link do Meet e participante de outra empresa."],
  ["all", "Gravar todas as reuniões com Meet", "Toda reunião nova da sua agenda Google com link do Meet."],
];
const errorText = (cause: unknown) => (cause instanceof ApiError || cause instanceof Error ? cause.message : undefined);

/** Preferências do Vorix Meetings: gravação automática, modelo de resumo, aviso de gravação,
 * palavras monitoradas e uso do plano. */
export default function MeetingsSettingsPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");
  const preferences = useMeetingPreferences();
  const usage = useMeetingsUsage();
  const [consentMessage, setConsentMessage] = useState("");
  useEffect(() => { if (preferences.data) setConsentMessage(preferences.data.tenant.consentMessage); }, [preferences.data]);

  async function save(input: Parameters<typeof updateMeetingPreferences>[0], label = "Preferência salva") {
    try {
      await preferences.mutate(await updateMeetingPreferences(input), { revalidate: false });
      toast.success(label);
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: errorText(cause) });
    }
  }

  return (
    <main className="mx-auto max-w-[960px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Preferências do Meetings" description="Como o Vorix grava, resume e acompanha as suas reuniões." />

      {usage.data ? (
        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground"><Gauge className="h-4 w-4" /> Uso do plano neste mês</h2>
          <UsageBar label="Minutos de gravação" used={usage.data.minutesUsed} limit={usage.data.minutesLimit} format={(value) => `${value} min`} />
          <UsageBar label="Armazenamento de gravações" used={usage.data.storageBytesUsed} limit={usage.data.storageBytesLimit} format={formatBytes} />
          <p className="text-xs text-muted-foreground">{usage.data.aiAnalyses} {usage.data.aiAnalyses === 1 ? "resumo gerado" : "resumos gerados"} por IA neste mês.</p>
        </Card>
      ) : usage.error ? <ErrorState error={usage.error} onRetry={() => usage.mutate()} /> : <Skeleton className="h-28 rounded-xl" />}

      {preferences.error ? <ErrorState error={preferences.error} onRetry={() => preferences.mutate()} /> : null}
      {!preferences.data && !preferences.error ? <Skeleton className="h-64 rounded-xl" /> : null}
      {preferences.data ? (
        <>
          <Card className="space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-base font-medium text-foreground"><Video className="h-4 w-4" /> Gravação automática da sua agenda</h2>
            <p className="text-sm text-muted-foreground">Vale para eventos novos que chegarem da sua agenda Google. A gravação continua respeitando o limite de gravações simultâneas e as contas de gravação conectadas.</p>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Gravação automática">
              {AUTO_RECORD_OPTIONS.map(([mode, label, help]) => (
                <button key={mode} type="button" role="radio" aria-checked={preferences.data!.autoRecordMode === mode} onClick={() => void save({ autoRecordMode: mode })}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${preferences.data!.autoRecordMode === mode ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                  <span className="block font-medium text-foreground">{label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{help}</span>
                </button>
              ))}
            </div>
            <label className="block max-w-sm space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Modelo de resumo padrão das suas reuniões</span>
              <select value={preferences.data.defaultTemplate} onChange={(event) => void save({ defaultTemplate: event.target.value as SummaryTemplateKey })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                {TEMPLATE_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-base font-medium text-foreground"><MessageSquareWarning className="h-4 w-4" /> Aviso de gravação (LGPD)</h2>
            <p className="text-sm text-muted-foreground">Ao entrar na reunião, o gravador envia este aviso no chat do Meet. Vale para toda a conta.{isAdmin ? "" : " Só administradores alteram."}</p>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">Enviar aviso no chat ao começar a gravar <Switch checked={preferences.data.tenant.consentNoticeEnabled} disabled={!isAdmin} onCheckedChange={(value) => void save({ consentNoticeEnabled: value })} /></label>
            <Textarea rows={3} value={consentMessage} disabled={!isAdmin || !preferences.data.tenant.consentNoticeEnabled} maxLength={500} onChange={(event) => setConsentMessage(event.target.value)} aria-label="Texto do aviso" />
            {isAdmin ? <Button size="sm" variant="secondary" disabled={consentMessage.trim() === preferences.data.tenant.consentMessage || !consentMessage.trim()} onClick={() => void save({ consentMessage: consentMessage.trim() }, "Aviso salvo")}>Salvar aviso</Button> : null}
          </Card>
        </>
      ) : null}

      <KeywordTrackersCard workspaceId={workspace.id} canEdit={isAdmin} />
    </main>
  );
}

function UsageBar({ label, used, limit, format }: { label: string; used: number; limit: number; format: (value: number) => string }) {
  const share = limit ? Math.min(1, used / limit) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-sm"><span className="text-foreground">{label}</span><span className="tabular-nums text-muted-foreground">{format(used)} de {limit ? format(limit) : "ilimitado"}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${share >= 0.9 ? "bg-destructive" : share >= 0.7 ? "bg-amber-500" : "bg-primary dark:bg-primary-glow"}`} style={{ width: `${Math.max(1, share * 100)}%` }} /></div>
    </div>
  );
}

function KeywordTrackersCard({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const trackers = useKeywordTrackers(workspaceId);
  const report = useSWR(["meeting-keyword-report", workspaceId], () => keywordReport(workspaceId, new Date(Date.now() - 30 * 86_400_000).toISOString()));
  const [editing, setEditing] = useState<KeywordTracker | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [terms, setTerms] = useState("");
  const [deleting, setDeleting] = useState<KeywordTracker | null>(null);
  const start = (tracker: KeywordTracker | "new") => { setEditing(tracker); setLabel(tracker === "new" ? "" : tracker.label); setTerms(tracker === "new" ? "" : tracker.terms.join(", ")); };
  async function submit() {
    try {
      await saveKeywordTracker(workspaceId, { ...(editing && editing !== "new" ? { trackerId: editing.id } : {}), label: label.trim(), terms: terms.split(/[,\n]/).map((term) => term.trim()).filter(Boolean) });
      setEditing(null);
      await Promise.all([trackers.mutate(), report.mutate()]);
      toast.success("Palavras salvas");
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: errorText(cause) });
    }
  }
  const byTracker = new Map((report.data ?? []).map((row) => [row.trackerId, row]));
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground"><Tags className="h-4 w-4" /> Palavras monitoradas</h2>
          <p className="text-sm text-muted-foreground">Acompanhe quando concorrentes, preço, desconto ou cancelamento aparecem nas reuniões. Contagem dos últimos 30 dias.</p>
        </div>
        {canEdit ? <Button size="sm" onClick={() => start("new")}>Novo grupo</Button> : null}
      </div>
      {editing ? (
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="space-y-1"><Label htmlFor="tracker-label">Nome do grupo</Label><Input id="tracker-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Concorrentes" maxLength={60} /></div>
          <div className="space-y-1"><Label htmlFor="tracker-terms">Palavras ou expressões (separe por vírgula)</Label><Textarea id="tracker-terms" rows={2} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Acme, Globex, outra ferramenta" /></div>
          <div className="flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancelar</Button><Button size="sm" onClick={() => void submit()} disabled={!label.trim() || !terms.trim()}>Salvar</Button></div>
        </div>
      ) : null}
      {trackers.error ? <ErrorState error={trackers.error} onRetry={() => trackers.mutate()} /> : null}
      <ul className="space-y-2">
        {trackers.data?.length === 0 ? <li className="text-sm text-muted-foreground">Nenhum grupo de palavras ainda.</li> : null}
        {(trackers.data ?? []).map((tracker) => {
          const row = byTracker.get(tracker.id);
          return (
            <li key={tracker.id} className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{tracker.label} <span className="text-xs font-normal text-muted-foreground">· {row ? `${row.mentions} ${row.mentions === 1 ? "menção" : "menções"} em ${row.meetings} ${row.meetings === 1 ? "reunião" : "reuniões"}` : "sem menções"}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{tracker.terms.join(", ")}</p>
                </div>
                {canEdit ? (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Editar ${tracker.label}`} onClick={() => start(tracker)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Excluir ${tracker.label}`} onClick={() => setDeleting(tracker)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : null}
              </div>
              {row?.latest.length ? (
                <ul className="mt-2 space-y-0.5">
                  {row.latest.map((item) => <li key={`${item.meetingId}-${item.startMs}`} className="truncate text-xs text-muted-foreground"><a className="hover:text-foreground" href={`/workspaces/${workspaceId}/meetings/central/${item.meetingId}`}><span className="text-foreground">{item.title}</span> · {formatTimestamp(item.startMs)} · {item.excerpt}</a></li>)}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `Excluir "${deleting.label}"?` : ""}
        description="As reuniões não são alteradas; só deixa de contar estas palavras."
        confirmLabel="Excluir"
        variant="danger"
        onConfirm={async () => {
          if (!deleting) return;
          try { await deleteKeywordTracker(workspaceId, deleting.id); await Promise.all([trackers.mutate(), report.mutate()]); } catch (cause) { toast.error("Não foi possível excluir", { description: errorText(cause) }); }
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}
