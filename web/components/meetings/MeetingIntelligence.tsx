"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, Link2, MessageCircle, Printer, Scissors, Send, Sparkles, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/features/meetings/presentation";
import {
  addComment, askAllMeetings, askMeeting, createClip, createCrmTask, createShare, deleteClip, deleteComment, downloadMeetingMarkdown, generateFollowUp,
  linkCrm, purgeMeeting, renameSpeaker, revokeShare, searchCrm, sendFollowUpWhatsApp, setMeetingTemplate, useWhatsAppChannels,
  type CrmContact, type CrmDeal, type MeetingInsights, type MeetingQuestion, type SummaryTemplateKey,
} from "@/features/meetings/intelligence";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const errorText = (cause: unknown) => (cause instanceof ApiError || cause instanceof Error ? cause.message : undefined);
const brl = (cents: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
const copy = async (text: string, label = "Copiado") => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
  }
};

// ── Pergunte à reunião ───────────────────────────────────────────────────────────────────────

export function AskMeetingPanel({ workspaceId, meetingId, initial, aiAvailable, onSeek, meetingTitles }: {
  workspaceId: string;
  /** Sem `meetingId` = pergunta sobre TODAS as reuniões que a pessoa pode ver. */
  meetingId?: string;
  initial: MeetingQuestion[];
  aiAvailable: boolean;
  onSeek?: (ms: number) => void;
  meetingTitles?: Record<string, string>;
}) {
  const [questions, setQuestions] = useState<MeetingQuestion[]>(initial);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  useEffect(() => { setQuestions(initial); }, [initial]);
  const suggestions = meetingId
    ? ["Quais foram os próximos passos combinados?", "O cliente falou de orçamento ou prazo?", "Quais objeções apareceram?"]
    : ["O que os clientes falaram sobre preço este mês?", "Quais concorrentes foram citados?", "Quais tarefas ficaram comigo?"];

  async function submit(text = question) {
    const value = text.trim();
    if (value.length < 3) return;
    setAsking(true);
    try {
      const answer = meetingId ? await askMeeting(workspaceId, meetingId, value) : await askAllMeetings(workspaceId, value);
      setQuestions((current) => [answer, ...current]);
      setQuestion("");
    } catch (cause) {
      toast.error("Não foi possível responder", { description: errorText(cause) });
    } finally {
      setAsking(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300"><Sparkles className="h-4 w-4" /></span>
        <div>
          <h3 className="text-base font-medium text-foreground">{meetingId ? "Pergunte à reunião" : "Pergunte às suas reuniões"}</h3>
          <p className="text-sm text-muted-foreground">A IA responde só com o que foi dito e mostra de onde tirou cada informação. Cada pergunta usa 1 crédito de IA.</p>
        </div>
      </div>
      {!aiAvailable ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">A inteligência artificial não está disponível neste ambiente.</p> : null}
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Input placeholder={meetingId ? "Ex.: qual prazo o cliente pediu?" : "Ex.: o que falaram sobre preço?"} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} disabled={!aiAvailable || asking} aria-label="Pergunta" />
        <Button type="submit" loading={asking} disabled={!aiAvailable || asking || question.trim().length < 3}><Send className="h-4 w-4" /> Perguntar</Button>
      </form>
      {questions.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" disabled={!aiAvailable || asking} onClick={() => void submit(suggestion)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50">{suggestion}</button>
          ))}
        </div>
      ) : null}
      <ul className="space-y-3">
        {questions.map((item) => (
          <li key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <p className="text-sm font-medium text-foreground">{item.question}</p>
            <p className={cn("whitespace-pre-line text-sm", item.answer.found ? "text-foreground/90" : "text-muted-foreground")}>{item.answer.answer}</p>
            {item.answer.citations.length ? (
              <ul className="space-y-1">
                {item.answer.citations.map((citation, index) => {
                  const sameMeeting = meetingId && citation.meetingId === meetingId;
                  const label = <><span className="tabular-nums text-primary dark:text-primary-glow">{formatTimestamp(citation.sourceTimestampMs)}</span> “{citation.evidence}”{!meetingId && meetingTitles?.[citation.meetingId] ? <span className="text-muted-foreground"> · {meetingTitles[citation.meetingId]}</span> : null}</>;
                  return (
                    <li key={index} className="text-xs text-muted-foreground">
                      {sameMeeting && onSeek ? (
                        <button type="button" className="text-left hover:text-foreground" onClick={() => onSeek(citation.sourceTimestampMs)}>{label}</button>
                      ) : (
                        <Link className="hover:text-foreground" href={`/workspaces/${workspaceId}/meetings/central/${citation.meetingId}`}>{label}</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Modelo de resumo ─────────────────────────────────────────────────────────────────────────

export function SummaryTemplateControl({ workspaceId, meetingId, insights, canAnalyze, transcriptReady, onChanged }: { workspaceId: string; meetingId: string; insights: MeetingInsights; canAnalyze: boolean; transcriptReady: boolean; onChanged: () => Promise<unknown> }) {
  const [value, setValue] = useState<SummaryTemplateKey>(insights.summaryTemplate);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(insights.summaryTemplate); }, [insights.summaryTemplate]);
  const dirty = value !== insights.summaryTemplate;
  async function apply() {
    setBusy(true);
    try {
      const result = await setMeetingTemplate(workspaceId, meetingId, value, canAnalyze && transcriptReady);
      toast.success(result.reanalysisQueued ? "Modelo aplicado — gerando o novo resumo" : "Modelo salvo", { description: result.reanalysisQueued ? "A nova análise usa 1 crédito de IA e aparece em instantes." : undefined });
      await onChanged();
    } catch (cause) {
      toast.error("Não foi possível trocar o modelo", { description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }
  const current = insights.templates.find((template) => template.key === value);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
      <label className="min-w-[200px] flex-1 space-y-1 text-xs text-muted-foreground">
        Modelo de resumo
        <select value={value} onChange={(event) => setValue(event.target.value as SummaryTemplateKey)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20">
          {insights.templates.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
        </select>
        {current ? <span className="block text-[11px]">{current.description}</span> : null}
      </label>
      <Button size="sm" variant={dirty ? "primary" : "secondary"} onClick={() => void apply()} loading={busy} disabled={busy || !dirty}>{transcriptReady && canAnalyze ? "Aplicar e gerar resumo" : "Salvar modelo"}</Button>
    </div>
  );
}

export function TemplateSections({ sections }: { sections?: { title: string; content: string }[] }) {
  if (!sections?.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sections.map((section) => (
        <div key={section.title} className="rounded-lg border border-border/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
          <p className={cn("mt-1 whitespace-pre-line text-sm", section.content.startsWith("Não mencionado") ? "text-muted-foreground" : "text-foreground")}>{section.content}</p>
        </div>
      ))}
    </div>
  );
}

// ── Falantes e participação ──────────────────────────────────────────────────────────────────

const minutes = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);

export function SpeakersPanel({ workspaceId, meetingId, insights, participantNames, onChanged, onSeek, canEdit = true }: { workspaceId: string; meetingId: string; insights: MeetingInsights; participantNames: string[]; onChanged: () => Promise<unknown>; onSeek: (ms: number) => void; canEdit?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const { talk } = insights;
  async function save(key: string) {
    try {
      await renameSpeaker(workspaceId, meetingId, key, name.trim());
      setEditing(null);
      toast.success(name.trim() ? "Nome salvo" : "Nome removido", { description: "Use Reanalisar IA para o resumo usar os novos nomes." });
      await onChanged();
    } catch (cause) {
      toast.error("Não foi possível salvar o nome", { description: errorText(cause) });
    }
  }
  if (!talk.hasSpeakers) {
    return (
      <Card className="space-y-2 p-5">
        <h3 className="text-base font-medium text-foreground">Quem falou</h3>
        <p className="text-sm text-muted-foreground">Esta transcrição não separou os falantes. A separação de falantes precisa estar ligada no servidor de transcrição; as próximas reuniões já chegam com "Falante 1", "Falante 2"… para você dar nome.</p>
        {talk.questions ? <p className="text-sm text-muted-foreground">Perguntas feitas na reunião: <strong className="text-foreground">{talk.questions}</strong></p> : null}
      </Card>
    );
  }
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-medium text-foreground">Quem falou e quanto</h3>
        <p className="text-sm text-muted-foreground">Dê nome aos falantes: a transcrição, o resumo e o link compartilhado passam a usar o nome certo.</p>
      </div>
      <ul className="space-y-3">
        {talk.speakers.map((speaker) => (
          <li key={speaker.speaker} className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {editing === speaker.speaker ? (
                <form className="flex flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(speaker.speaker); }}>
                  <Input className="h-8 max-w-xs" value={name} list={`participants-${meetingId}`} onChange={(event) => setName(event.target.value)} autoFocus maxLength={80} aria-label="Nome do falante" />
                  <datalist id={`participants-${meetingId}`}>{participantNames.map((participant) => <option key={participant} value={participant} />)}</datalist>
                  <Button size="sm" type="submit"><Check className="h-3.5 w-3.5" /> Salvar</Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancelar</Button>
                </form>
              ) : !canEdit ? (
                <span className="flex items-center gap-2 text-sm font-medium text-foreground"><UserRound className="h-4 w-4 text-muted-foreground" /> {speaker.displayName}</span>
              ) : (
                <button type="button" className="flex items-center gap-2 text-sm font-medium text-foreground hover:underline" onClick={() => { setEditing(speaker.speaker); setName(insights.speakers.find((item) => item.key === speaker.speaker)?.renamed ? speaker.displayName : ""); }}>
                  <UserRound className="h-4 w-4 text-muted-foreground" /> {speaker.displayName} <span className="text-xs font-normal text-muted-foreground">(editar nome)</span>
                </button>
              )}
              <span className="text-xs tabular-nums text-muted-foreground">{Math.round(speaker.share * 100)}% · {minutes(speaker.talkMs)} · {speaker.questions} {speaker.questions === 1 ? "pergunta" : "perguntas"} · {speaker.wordsPerMinute} palavras/min</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary dark:bg-primary-glow" style={{ width: `${Math.max(2, speaker.share * 100)}%` }} /></div>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <Stat label="Trocas de quem fala" value={String(talk.speakerSwitches)} />
        <Stat label="Perguntas feitas" value={String(talk.questions)} />
        {talk.longestMonologue ? (
          <button type="button" onClick={() => onSeek(talk.longestMonologue!.startMs)} className="rounded-lg border border-border/60 p-3 text-left hover:bg-muted/40">
            <p className="text-xs text-muted-foreground">Maior monólogo</p>
            <p className="font-medium text-foreground">{talk.longestMonologue.displayName} · {minutes(talk.longestMonologue.durationMs)}</p>
          </button>
        ) : null}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium tabular-nums text-foreground">{value}</p></div>;
}

export function KeywordHitsPanel({ workspaceId, insights, onSeek }: { workspaceId: string; insights: MeetingInsights; onSeek: (ms: number) => void }) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium text-foreground">Palavras monitoradas</h3>
        <Link href={`/workspaces/${workspaceId}/meetings/settings`} className="text-xs text-primary hover:underline dark:text-primary-glow">Configurar palavras</Link>
      </div>
      {insights.keywordHits.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma palavra monitorada apareceu nesta reunião (ex.: concorrentes, preço, cancelamento).</p> : null}
      {insights.keywordHits.map((hit) => (
        <div key={hit.trackerId} className="space-y-1">
          <p className="text-sm font-medium text-foreground">{hit.label} <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">{hit.count}×</span></p>
          <ul className="space-y-0.5">
            {hit.occurrences.slice(0, 5).map((occurrence, index) => (
              <li key={index}><button type="button" onClick={() => onSeek(occurrence.startMs)} className="text-left text-xs text-muted-foreground hover:text-foreground"><span className="tabular-nums text-primary dark:text-primary-glow">{formatTimestamp(occurrence.startMs)}</span> {occurrence.excerpt}</button></li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

// ── Follow-up ────────────────────────────────────────────────────────────────────────────────

export function FollowUpPanel({ workspaceId, meetingId, insights, hasAnalysis, canAct, onChanged }: { workspaceId: string; meetingId: string; insights: MeetingInsights; hasAnalysis: boolean; canAct: boolean; onChanged: () => Promise<unknown> }) {
  const [recipientName, setRecipientName] = useState(insights.crm.contact?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const draft = insights.followUp;
  async function generate() {
    setBusy(true);
    try {
      await generateFollowUp(workspaceId, meetingId, { ...(recipientName.trim() ? { recipientName: recipientName.trim() } : {}) });
      toast.success("Follow-up gerado");
      await onChanged();
    } catch (cause) {
      toast.error("Não foi possível gerar o follow-up", { description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-medium text-foreground">Follow-up da reunião</h3>
        <p className="text-sm text-muted-foreground">A IA escreve o e-mail e a mensagem de WhatsApp a partir do resumo, das decisões e dos próximos passos. Revise antes de enviar. Usa 1 crédito de IA.</p>
      </div>
      {!hasAnalysis ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">O follow-up fica disponível depois do resumo por IA.</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label htmlFor="follow-up-recipient">Para quem (opcional)</Label>
          <Input id="follow-up-recipient" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Nome do cliente" maxLength={80} />
        </div>
        <Button variant="ai" onClick={() => void generate()} loading={busy} disabled={busy || !hasAnalysis || !canAct || !insights.aiAvailable}><Sparkles className="h-4 w-4" /> {draft ? "Gerar de novo" : "Gerar follow-up"}</Button>
      </div>
      {draft ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">E-mail</p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void copy(`${draft.emailSubject}\n\n${draft.emailBody}`, "E-mail copiado")}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
                <Button size="sm" variant="ghost" asChild><a href={`mailto:?subject=${encodeURIComponent(draft.emailSubject)}&body=${encodeURIComponent(draft.emailBody)}`}>Abrir no e-mail</a></Button>
              </div>
            </div>
            <p className="text-sm font-medium text-foreground">{draft.emailSubject}</p>
            <p className="whitespace-pre-line text-sm text-foreground/90">{draft.emailBody}</p>
          </div>
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">WhatsApp</p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void copy(draft.whatsappMessage, "Mensagem copiada")}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
                {insights.whatsAppAvailable ? <Button size="sm" onClick={() => setSendOpen(true)} disabled={!canAct}><MessageCircle className="h-3.5 w-3.5" /> Enviar pelo Conversas</Button> : null}
              </div>
            </div>
            <p className="whitespace-pre-line text-sm text-foreground/90">{draft.whatsappMessage}</p>
          </div>
        </div>
      ) : null}
      {sendOpen && draft ? <SendWhatsAppDialog workspaceId={workspaceId} meetingId={meetingId} message={draft.whatsappMessage} contact={insights.crm.contact} onClose={() => setSendOpen(false)} /> : null}
    </Card>
  );
}

function SendWhatsAppDialog({ workspaceId, meetingId, message: initialMessage, contact, onClose }: { workspaceId: string; meetingId: string; message: string; contact?: CrmContact; onClose: () => void }) {
  const { data } = useWhatsAppChannels(workspaceId, true);
  const channels = data?.channels ?? [];
  const [connectionId, setConnectionId] = useState("");
  const [phone, setPhone] = useState(contact?.whatsappPhone ?? "");
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!connectionId && channels[0]) setConnectionId(channels[0].id); }, [channels, connectionId]);
  async function send() {
    setBusy(true);
    try {
      const result = await sendFollowUpWhatsApp(workspaceId, meetingId, { connectionId, message, ...(phone.trim() ? { phone: phone.trim() } : contact ? { contactId: contact.id } : {}) });
      toast.success("Mensagem enviada", { action: { label: "Abrir conversa", onClick: () => { window.location.href = `/workspaces/${workspaceId}/conversas?conversation=${result.conversationId}`; } } });
      onClose();
    } catch (cause) {
      toast.error("Não foi possível enviar", { description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Enviar follow-up pelo WhatsApp" onClose={() => { if (!busy) onClose(); }} maxWidthClass="sm:max-w-lg">
      <div className="space-y-3">
        {channels.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum número de WhatsApp conectado no Conversas.</p> : (
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Enviar pelo número</span>
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.label}</option>)}
            </select>
          </label>
        )}
        <div className="space-y-1">
          <Label htmlFor="follow-up-phone">WhatsApp do destinatário</Label>
          <Input id="follow-up-phone" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(11) 91234-5678" />
          {contact ? <p className="text-[11px] text-muted-foreground">Contato vinculado: {contact.name}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="follow-up-message">Mensagem</Label>
          <Textarea id="follow-up-message" rows={6} value={message} onChange={(event) => setMessage(event.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void send()} loading={busy} disabled={busy || !connectionId || !message.trim() || (!phone.trim() && !contact)}>Enviar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── CRM ──────────────────────────────────────────────────────────────────────────────────────

export function CrmPanel({ workspaceId, meetingId, insights, canAct, onChanged }: { workspaceId: string; meetingId: string; insights: MeetingInsights; canAct: boolean; onChanged: () => Promise<unknown> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CrmContact[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [busy, setBusy] = useState(false);
  const contact = insights.crm.contact;
  useEffect(() => {
    if (!contact) { setDeals([]); return; }
    void searchCrm(workspaceId, { contactId: contact.id }).then((result) => setDeals(result.deals)).catch(() => setDeals([]));
  }, [workspaceId, contact]);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const handle = setTimeout(() => { void searchCrm(workspaceId, { q: query.trim() }).then((result) => setResults(result.contacts)).catch(() => setResults([])); }, 300);
    return () => clearTimeout(handle);
  }, [workspaceId, query]);
  async function link(input: { contactId?: string | null; dealId?: string | null }) {
    setBusy(true);
    try {
      await linkCrm(workspaceId, meetingId, input);
      setQuery("");
      await onChanged();
    } catch (cause) {
      toast.error("Não foi possível vincular", { description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }
  if (!insights.crm.available) return <Card className="p-5"><p className="text-sm text-muted-foreground">O CRM não está disponível para esta conta.</p></Card>;
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-medium text-foreground">Vínculo com o CRM</h3>
        <p className="text-sm text-muted-foreground">Ligue a reunião ao contato e à oportunidade: as tarefas criadas daqui já entram no lugar certo.</p>
      </div>
      {contact ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{contact.name}</p><p className="truncate text-xs text-muted-foreground">{[contact.company, contact.whatsappPhone].filter(Boolean).join(" · ") || "Contato do CRM"}</p></div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" asChild><Link href={`/workspaces/${workspaceId}/contacts?contactId=${contact.id}`}>Abrir contato</Link></Button>
              {canAct ? <Button size="sm" variant="ghost" onClick={() => void link({ contactId: null, dealId: null })} disabled={busy}>Desvincular</Button> : null}
            </div>
          </div>
          <label className="block space-y-1 text-xs text-muted-foreground">
            Oportunidade
            <select value={insights.crm.deal?.id ?? ""} disabled={!canAct || busy} onChange={(event) => void link({ dealId: event.target.value || null })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground">
              <option value="">Nenhuma</option>
              {deals.map((deal) => <option key={deal.id} value={deal.id}>{deal.title} · {brl(deal.valueCents, deal.currency)}{deal.won ? " · ganha" : deal.lost ? " · perdida" : ""}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          {insights.crm.suggestions.length ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Sugestões pelos participantes</p>
              <div className="flex flex-wrap gap-2">
                {insights.crm.suggestions.map((suggestion) => <Button key={suggestion.id} size="sm" variant="secondary" disabled={!canAct || busy} onClick={() => void link({ contactId: suggestion.id })}>{suggestion.name}{suggestion.company ? ` · ${suggestion.company}` : ""}</Button>)}
              </div>
            </div>
          ) : null}
          <Input placeholder="Buscar contato no CRM…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={!canAct} />
          {results.length ? (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-border/60">
              {results.map((result) => (
                <li key={result.id}><button type="button" onClick={() => void link({ contactId: result.id })} className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"><span className="truncate font-medium text-foreground">{result.name}</span><span className="truncate text-xs text-muted-foreground">{result.company}</span></button></li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Card>
  );
}

export function CreateCrmTaskButton({ workspaceId, meetingId, itemId, taskId, onCreated }: { workspaceId: string; meetingId: string; itemId: string; taskId?: string; onCreated: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  if (taskId) return <Button size="sm" variant="ghost" asChild><Link href={`/workspaces/${workspaceId}/tasks`}><Check className="h-3.5 w-3.5" /> Tarefa no CRM</Link></Button>;
  return (
    <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await createCrmTask(workspaceId, meetingId, itemId, {});
        toast.success("Tarefa criada no CRM");
        await onCreated();
      } catch (cause) {
        toast.error("Não foi possível criar a tarefa", { description: errorText(cause) });
      } finally {
        setBusy(false);
      }
    }}>Criar tarefa no CRM</Button>
  );
}

// ── Compartilhar e exportar ──────────────────────────────────────────────────────────────────

export function SharePanel({ workspaceId, meetingId, insights, hasRecording, canAct, onChanged }: { workspaceId: string; meetingId: string; insights: MeetingInsights; hasRecording: boolean; canAct: boolean; onChanged: () => Promise<unknown> }) {
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [includeRecording, setIncludeRecording] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  async function create() {
    setBusy(true);
    try {
      const { url } = await createShare(workspaceId, meetingId, { includeTranscript, includeRecording: includeRecording && hasRecording, expiresInDays });
      setLastUrl(url);
      await copy(url, "Link criado e copiado");
      await onChanged();
    } catch (cause) {
      toast.error("Não foi possível criar o link", { description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }
  const active = insights.shares.filter((share) => !share.revokedAt && (!share.expiresAt || Date.parse(share.expiresAt) > Date.now()));
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-base font-medium text-foreground">Compartilhar por link</h3>
          <p className="text-sm text-muted-foreground">Quem receber o link vê o resumo sem precisar de conta no Vorix. Você escolhe o que vai junto e pode desativar quando quiser.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">Transcrição <Switch checked={includeTranscript} onCheckedChange={setIncludeTranscript} /></label>
          <label className={cn("flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm", !hasRecording && "opacity-60")}>Gravação <Switch checked={includeRecording && hasRecording} disabled={!hasRecording} onCheckedChange={setIncludeRecording} /></label>
          <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">Validade
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className="h-7 rounded-md border border-input bg-background px-1 text-sm">
              {[[1, "1 dia"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [0, "Sem validade"]].map(([days, label]) => <option key={days} value={days}>{label}</option>)}
            </select>
          </label>
        </div>
        <Button onClick={() => void create()} loading={busy} disabled={busy || !canAct}><Link2 className="h-4 w-4" /> Criar link</Button>
        {lastUrl ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2 text-sm">
            <code className="min-w-0 flex-1 truncate text-xs">{lastUrl}</code>
            <Button size="sm" variant="ghost" onClick={() => void copy(lastUrl)}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
          </div>
        ) : null}
        {active.length ? (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {active.map((share) => (
              <li key={share.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{[share.includeTranscript ? "Com transcrição" : "Só resumo", share.includeRecording ? "com gravação" : ""].filter(Boolean).join(" · ")} · {share.expiresAt ? `até ${new Date(share.expiresAt).toLocaleDateString("pt-BR")}` : "sem validade"} · {share.viewCount} {share.viewCount === 1 ? "visualização" : "visualizações"}</span>
                {canAct ? <Button size="sm" variant="ghost" onClick={() => setRevoking(share.id)}>Desativar</Button> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="text-base font-medium text-foreground">Exportar</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void downloadMeetingMarkdown(workspaceId, meetingId, true).catch((cause) => toast.error("Não foi possível exportar", { description: errorText(cause) }))}><Download className="h-4 w-4" /> Markdown (com transcrição)</Button>
          <Button variant="secondary" onClick={() => void downloadMeetingMarkdown(workspaceId, meetingId, false).catch((cause) => toast.error("Não foi possível exportar", { description: errorText(cause) }))}><Download className="h-4 w-4" /> Markdown (só resumo)</Button>
          <Button variant="secondary" asChild><a href={`/workspaces/${workspaceId}/meetings/central/${meetingId}/imprimir`} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /> PDF / imprimir</a></Button>
        </div>
      </Card>
      <ConfirmDialog
        open={!!revoking}
        title="Desativar este link?"
        description="Quem tiver o link deixa de conseguir abrir a reunião na hora. Você pode criar outro depois."
        confirmLabel="Desativar"
        variant="danger"
        onConfirm={async () => {
          if (!revoking) return;
          try { await revokeShare(workspaceId, meetingId, revoking); await onChanged(); toast.success("Link desativado"); } catch (cause) { toast.error("Não foi possível desativar", { description: errorText(cause) }); }
          setRevoking(null);
        }}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

// ── Trechos e comentários ────────────────────────────────────────────────────────────────────

export function ClipsAndCommentsPanel({ workspaceId, meetingId, insights, currentTimeMs, onSeek, onChanged, memberName, myUserId, canManageAll = false }: { workspaceId: string; meetingId: string; insights: MeetingInsights; currentTimeMs: () => number; onSeek: (ms: number) => void; onChanged: () => Promise<unknown>; memberName: (userId: string) => string; myUserId?: string; canManageAll?: boolean }) {
  const canDelete = (authorId: string) => canManageAll || authorId === myUserId;
  const [clipTitle, setClipTitle] = useState("");
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [atCurrent, setAtCurrent] = useState(true);
  async function addClip() {
    const end = currentTimeMs();
    if (clipStart === null) { setClipStart(end); return; }
    if (end <= clipStart) { toast.error("Avance o player até o fim do trecho."); return; }
    try {
      await createClip(workspaceId, meetingId, { startMs: clipStart, endMs: end, title: clipTitle.trim() || `Trecho em ${formatTimestamp(clipStart)}` });
      setClipStart(null);
      setClipTitle("");
      toast.success("Trecho salvo");
      await onChanged();
    } catch (cause) { toast.error("Não foi possível salvar o trecho", { description: errorText(cause) }); }
  }
  async function addCommentNow() {
    if (!comment.trim()) return;
    try {
      await addComment(workspaceId, meetingId, { text: comment.trim(), ...(atCurrent ? { atMs: Math.floor(currentTimeMs()) } : {}) });
      setComment("");
      await onChanged();
    } catch (cause) { toast.error("Não foi possível comentar", { description: errorText(cause) }); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h3 className="flex items-center gap-2 text-base font-medium text-foreground"><Scissors className="h-4 w-4" /> Trechos marcados</h3>
        <p className="text-sm text-muted-foreground">Marque os momentos importantes (ex.: "cliente falou de preço") para voltar neles em um clique.</p>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-[160px] flex-1" placeholder="Nome do trecho" value={clipTitle} onChange={(event) => setClipTitle(event.target.value)} maxLength={120} />
          <Button variant={clipStart === null ? "secondary" : "primary"} onClick={() => void addClip()}>{clipStart === null ? "Marcar início (posição do player)" : `Marcar fim (início ${formatTimestamp(clipStart)})`}</Button>
          {clipStart !== null ? <Button variant="ghost" onClick={() => setClipStart(null)}>Cancelar</Button> : null}
        </div>
        <ul className="space-y-1">
          {insights.clips.length === 0 ? <li className="text-sm text-muted-foreground">Nenhum trecho marcado.</li> : null}
          {insights.clips.map((clip) => (
            <li key={clip.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
              <button type="button" onClick={() => onSeek(clip.startMs)} className="min-w-0 text-left text-sm"><span className="tabular-nums text-primary dark:text-primary-glow">{formatTimestamp(clip.startMs)}–{formatTimestamp(clip.endMs)}</span> <span className="text-foreground">{clip.title}</span></button>
              {canDelete(clip.createdBy) ? <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Excluir trecho ${clip.title}`} onClick={async () => { try { await deleteClip(workspaceId, meetingId, clip.id); await onChanged(); } catch (cause) { toast.error("Não foi possível excluir", { description: errorText(cause) }); } }}><Trash2 className="h-3.5 w-3.5" /></Button> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="flex items-center gap-2 text-base font-medium text-foreground"><MessageCircle className="h-4 w-4" /> Comentários da equipe</h3>
        <Textarea rows={2} placeholder="Comente sobre a reunião…" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={atCurrent} onCheckedChange={setAtCurrent} /> Marcar no momento atual do player</label>
          <Button size="sm" onClick={() => void addCommentNow()} disabled={!comment.trim()}>Comentar</Button>
        </div>
        <ul className="space-y-2">
          {insights.comments.map((item) => (
            <li key={item.id} className="rounded-lg border border-border/60 p-2.5 text-sm">
              <div className="mb-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{memberName(item.userId)} · {new Date(item.createdAt).toLocaleString("pt-BR")}{item.atMs !== undefined ? <> · <button type="button" className="tabular-nums text-primary hover:underline dark:text-primary-glow" onClick={() => onSeek(item.atMs!)}>{formatTimestamp(item.atMs)}</button></> : null}</span>
                {canDelete(item.userId) ? <button type="button" aria-label="Excluir comentário" className="hover:text-foreground" onClick={async () => { try { await deleteComment(workspaceId, meetingId, item.id); await onChanged(); } catch (cause) { toast.error("Não foi possível excluir", { description: errorText(cause) }); } }}><Trash2 className="h-3.5 w-3.5" /></button> : null}
              </div>
              <p className="whitespace-pre-line text-foreground">{item.text}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ── Exclusão definitiva (LGPD) ───────────────────────────────────────────────────────────────

export function PurgeMeetingDialog({ workspaceId, meetingId, title, onClose, onPurged }: { workspaceId: string; meetingId: string; title: string; onClose: () => void; onPurged: () => void }) {
  const [confirmTitle, setConfirmTitle] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Excluir definitivamente (LGPD)" onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Apaga para sempre a gravação, a transcrição, o resumo, os comentários e os links desta reunião. Use quando alguém pedir a exclusão dos próprios dados. <strong className="text-foreground">Não pode ser desfeito.</strong></p>
        <div className="space-y-1">
          <Label htmlFor="purge-confirm">Digite o título da reunião para confirmar</Label>
          <Input id="purge-confirm" value={confirmTitle} onChange={(event) => setConfirmTitle(event.target.value)} placeholder={title} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger" loading={busy} disabled={busy || confirmTitle.trim() !== title.trim()} onClick={async () => {
            setBusy(true);
            try { await purgeMeeting(workspaceId, meetingId, confirmTitle); toast.success("Reunião excluída definitivamente"); onPurged(); } catch (cause) { toast.error("Não foi possível excluir", { description: errorText(cause) }); setBusy(false); }
          }}>Excluir para sempre</Button>
        </div>
      </div>
    </Modal>
  );
}
