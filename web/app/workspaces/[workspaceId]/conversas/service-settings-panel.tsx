"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Clock, MessageSquareHeart, Plus, Tags, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { canManageTenant } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { updateInboxServiceSettings } from "@/features/inbox/api";
import { useInboxServiceSettings, useInboxTags } from "@/features/inbox/hooks";
import { useTeams } from "@/features/identity/hooks";
import type { InboxConversation, InboxServiceSettings, ServiceWeekday, TriageOption } from "@/features/inbox/types";

const WEEKDAYS: readonly { key: ServiceWeekday; label: string }[] = [
  { key: "mon", label: "Segunda" }, { key: "tue", label: "Terça" }, { key: "wed", label: "Quarta" }, { key: "thu", label: "Quinta" },
  { key: "fri", label: "Sexta" }, { key: "sat", label: "Sábado" }, { key: "sun", label: "Domingo" },
];

const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Rio_Branco", "America/Noronha"];

export function csatLabel(conversation: Pick<InboxConversation, "csatStatus" | "csatScore">): string {
  if (conversation.csatStatus === "answered" && conversation.csatScore) return `${"★".repeat(conversation.csatScore)}${"☆".repeat(5 - conversation.csatScore)} · ${conversation.csatScore}/5`;
  if (conversation.csatStatus === "awaiting") return "Aguardando resposta";
  return "Não respondeu";
}

/** Aba "Regras" de Conversas: horário + ausência, motivos de encerramento e pesquisa de satisfação. */
export function ServiceSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const { state } = useAuth();
  const canEdit = canManageTenant(state.status === "authenticated" ? state.role : undefined);
  const { data, error, isLoading, mutate } = useInboxServiceSettings(workspaceId);
  const [draft, setDraft] = useState<InboxServiceSettings | undefined>();
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  if (isLoading || (!draft && !error)) {
    return <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }
  if (error || !draft) return <ErrorState error={error} onRetry={() => mutate()} />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const set = <K extends keyof InboxServiceSettings>(key: K, value: InboxServiceSettings[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const setDay = (day: ServiceWeekday, intervals: { start: string; end: string }[]) => set("businessHours", { ...draft.businessHours, [day]: intervals });

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const { updatedAt: _updatedAt, ...changes } = draft;
      const saved = await updateInboxServiceSettings(workspaceId, changes);
      await mutate(saved, { revalidate: false });
      setDraft(saved);
      toast.success("Regras de atendimento salvas.");
    } catch (cause) {
      toast.error("Não foi possível salvar.", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setSaving(false);
    }
  }

  function addReason() {
    const reason = newReason.trim();
    if (!reason || !draft || draft.closingReasons.includes(reason)) return;
    set("closingReasons", [...draft.closingReasons, reason]);
    setNewReason("");
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-20">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Regras de atendimento</h2>
        <p className="text-sm text-muted-foreground">Valem para todas as conversas de WhatsApp deste workspace.{canEdit ? "" : " Só administradores podem alterar."}</p>
      </div>

      <TriageSection workspaceId={workspaceId} draft={draft} canEdit={canEdit} set={set} />

      <Section icon={Clock} title="Horário de atendimento" description="Fora deste horário, o cliente recebe a mensagem de ausência (no máximo uma vez a cada 12 horas por conversa).">
        <div className="space-y-2">
          {WEEKDAYS.map(({ key, label }) => {
            const intervals = draft.businessHours[key] ?? [];
            const open = intervals.length > 0;
            return (
              <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 px-3 py-2">
                <label className="flex w-32 items-center gap-2 text-sm font-medium text-foreground">
                  <Switch checked={open} disabled={!canEdit} onCheckedChange={(checked) => setDay(key, checked ? [{ start: "08:00", end: "18:00" }] : [])} aria-label={`Atender na ${label}`} />
                  {label}
                </label>
                {open ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {intervals.map((interval, index) => (
                      <div key={index} className="flex items-center gap-1.5 text-sm">
                        <Input type="time" className="h-8 w-[104px]" value={interval.start} disabled={!canEdit} aria-label={`${label}: início`}
                          onChange={(event) => setDay(key, intervals.map((item, i) => (i === index ? { ...item, start: event.target.value } : item)))} />
                        <span className="text-muted-foreground">às</span>
                        <Input type="time" className="h-8 w-[104px]" value={interval.end} disabled={!canEdit} aria-label={`${label}: fim`}
                          onChange={(event) => setDay(key, intervals.map((item, i) => (i === index ? { ...item, end: event.target.value } : item)))} />
                        {intervals.length > 1 && canEdit ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDay(key, intervals.filter((_, i) => i !== index))} aria-label="Remover intervalo"><X className="h-3.5 w-3.5" /></Button>
                        ) : null}
                      </div>
                    ))}
                    {canEdit && intervals.length < 4 ? (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDay(key, [...intervals, { start: "13:00", end: "18:00" }])}>
                        <Plus className="h-3.5 w-3.5" /> Intervalo
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Fechado</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="service-timezone">Fuso horário</Label>
            <select id="service-timezone" disabled={!canEdit} value={draft.timezone} onChange={(event) => set("timezone", event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:bg-muted/50">
              {(TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES]).map((zone) => <option key={zone} value={zone}>{zone.replace("America/", "").replace("_", " ")}</option>)}
            </select>
          </div>
        </div>
        <ToggleRow label="Enviar mensagem de ausência fora do horário" checked={draft.awayEnabled} disabled={!canEdit} onChange={(value) => set("awayEnabled", value)} />
        <Textarea rows={3} value={draft.awayMessage} disabled={!canEdit || !draft.awayEnabled} onChange={(event) => set("awayMessage", event.target.value)} aria-label="Mensagem de ausência" />
      </Section>

      <Section icon={Tags} title="Motivos de encerramento" description="Ao finalizar, o atendente escolhe o motivo. Em Resultados, você vê por que os clientes chamam.">
        <div className="flex flex-wrap gap-1.5">
          {draft.closingReasons.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum motivo cadastrado: finalizar não pede motivo.</p> : null}
          {draft.closingReasons.map((reason) => (
            <span key={reason} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1 text-sm text-foreground">
              {reason}
              {canEdit ? (
                <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => set("closingReasons", draft.closingReasons.filter((item) => item !== reason))} aria-label={`Remover ${reason}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <Input placeholder="Novo motivo (ex.: Orçamento enviado)" maxLength={80} value={newReason} onChange={(event) => setNewReason(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addReason(); } }} />
            <Button variant="secondary" onClick={addReason} disabled={!newReason.trim()}>Adicionar</Button>
          </div>
        ) : null}
        <ToggleRow label="Motivo obrigatório ao finalizar" checked={draft.requireClosingReason} disabled={!canEdit || draft.closingReasons.length === 0} onChange={(value) => set("requireClosingReason", value)} />
      </Section>

      <Section icon={MessageSquareHeart} title="Pesquisa de satisfação" description="Ao finalizar, o cliente recebe a pergunta e responde com uma nota de 1 a 5. A nota aparece na conversa e em Resultados.">
        <ToggleRow label="Enviar pesquisa ao finalizar o atendimento" checked={draft.csatEnabled} disabled={!canEdit} onChange={(value) => set("csatEnabled", value)} />
        <div className="space-y-1.5">
          <Label htmlFor="csat-message">Pergunta</Label>
          <Textarea id="csat-message" rows={3} value={draft.csatMessage} disabled={!canEdit || !draft.csatEnabled} onChange={(event) => set("csatMessage", event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="csat-thanks">Agradecimento após a nota</Label>
          <Input id="csat-thanks" value={draft.csatThanksMessage} disabled={!canEdit || !draft.csatEnabled} onChange={(event) => set("csatThanksMessage", event.target.value)} />
        </div>
      </Section>

      {canEdit ? (
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 py-3 backdrop-blur">
          <Button variant="secondary" onClick={() => setDraft(data)} disabled={!dirty || saving}>Descartar</Button>
          <Button onClick={() => void save()} loading={saving} disabled={!dirty || saving}>Salvar regras</Button>
        </div>
      ) : null}
    </div>
  );
}

/** Texto exatamente como o cliente vai receber (espelha `triageMenuText` do backend). */
function triagePreview(greeting: string, options: readonly TriageOption[]): string {
  return `${greeting}\n\n${options.map((option, index) => `${index + 1} - ${option.label || "…"}`).join("\n")}\n\nResponda com o número da opção.`;
}

function TriageSection({ workspaceId, draft, canEdit, set }: {
  workspaceId: string;
  draft: InboxServiceSettings;
  canEdit: boolean;
  set: <K extends keyof InboxServiceSettings>(key: K, value: InboxServiceSettings[K]) => void;
}) {
  const { data: teams } = useTeams(workspaceId);
  const { data: tagsData } = useInboxTags(workspaceId);
  const tags = tagsData?.tags ?? [];
  const options = draft.triageOptions;
  const setOptions = (next: TriageOption[]) => {
    set("triageOptions", next);
    if (!next.length) set("triageEnabled", false);
  };
  const update = (index: number, patch: Partial<TriageOption>) => setOptions(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    setOptions(next);
  };
  const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:bg-muted/50";

  return (
    <Section icon={Bot} title="Menu de triagem (chatbot)" description="Na primeira mensagem de um cliente sem atendente, o Vorix envia o menu. A opção escolhida leva a conversa para a equipe certa (e o rodízio da equipe escolhe o atendente). Se o cliente não escolher em 2 tentativas, a conversa segue para o atendimento normal.">
      <ToggleRow label="Enviar menu de triagem para novos clientes" checked={draft.triageEnabled} disabled={!canEdit || options.length === 0} onChange={(value) => set("triageEnabled", value)} />
      {options.length === 0 ? <p className="text-xs text-muted-foreground">Cadastre pelo menos uma opção para ligar o menu.</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="triage-greeting">Mensagem de abertura</Label>
        <Textarea id="triage-greeting" rows={2} value={draft.triageGreeting} disabled={!canEdit} onChange={(event) => set("triageGreeting", event.target.value)} />
      </div>
      <div className="space-y-2">
        {options.map((option, index) => (
          <div key={option.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold tabular-nums text-primary dark:text-primary-glow">{index + 1}</span>
              <Input className="h-8" placeholder="Nome da opção (ex.: Vendas)" maxLength={40} value={option.label} disabled={!canEdit} onChange={(event) => update(index, { label: event.target.value })} aria-label={`Opção ${index + 1}: nome`} />
              {canEdit ? (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Subir opção"><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === options.length - 1} onClick={() => move(index, 1)} aria-label="Descer opção"><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOptions(options.filter((_, i) => i !== index))} aria-label={`Remover opção ${index + 1}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Encaminhar para a equipe
                <select className={selectClass} value={option.teamId ?? ""} disabled={!canEdit} onChange={(event) => update(index, { teamId: event.target.value || undefined })}>
                  <option value="">Atendimento geral (regra do canal)</option>
                  {(teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Aplicar etiqueta
                <select className={selectClass} value={option.tagId ?? ""} disabled={!canEdit} onChange={(event) => update(index, { tagId: event.target.value || undefined })}>
                  <option value="">Nenhuma</option>
                  {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
              </label>
            </div>
            <Input className="h-8" placeholder={`Resposta ao escolher (padrão: "Certo! Já vamos te atender sobre …")`} value={option.reply ?? ""} disabled={!canEdit} onChange={(event) => update(index, { reply: event.target.value || undefined })} aria-label={`Opção ${index + 1}: resposta`} />
          </div>
        ))}
        {canEdit && options.length < 9 ? (
          <Button variant="secondary" size="sm" onClick={() => setOptions([...options, { id: `opt-${Date.now().toString(36)}`, label: "" }])}>
            <Plus className="h-4 w-4" /> Adicionar opção
          </Button>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="triage-fallback">Mensagem quando o cliente não escolhe</Label>
        <Input id="triage-fallback" value={draft.triageFallbackMessage} disabled={!canEdit} onChange={(event) => set("triageFallbackMessage", event.target.value)} />
      </div>
      {options.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Como o cliente vai receber</p>
          <p className="max-w-sm whitespace-pre-wrap rounded-lg rounded-tl-none bg-muted px-3 py-2 text-sm text-foreground">{triagePreview(draft.triageGreeting, options)}</p>
        </div>
      ) : null}
    </Section>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: typeof Clock; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:text-primary-glow"><Icon className="h-4 w-4" /></span>
        <div><h3 className="text-base font-medium text-foreground">{title}</h3><p className="text-sm text-muted-foreground">{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={cn("flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground", disabled && "opacity-70")}>
      {label}
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

/** Finalizar com motivo. Motivo opcional quando o workspace não exige. */
export function CloseConversationModal({ reasons, required, csatEnabled, busy, onCancel, onConfirm }: {
  reasons: readonly string[];
  required: boolean;
  csatEnabled: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void | Promise<void>;
}) {
  const [reason, setReason] = useState<string | undefined>();
  return (
    <Modal title="Finalizar atendimento" onClose={() => { if (!busy) onCancel(); }}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Motivo do encerramento{required ? "" : " (opcional)"}</p>
          <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Motivo do encerramento">
            {reasons.map((item) => (
              <button key={item} type="button" role="radio" aria-checked={reason === item} onClick={() => setReason(reason === item ? undefined : item)}
                className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", reason === item ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border hover:bg-muted")}>
                {item}
              </button>
            ))}
          </div>
        </div>
        {csatEnabled ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">O cliente vai receber a pesquisa de satisfação (nota de 1 a 5).</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void onConfirm(reason)} loading={busy} disabled={busy || (required && !reason)}>Finalizar</Button>
        </div>
      </div>
    </Modal>
  );
}
