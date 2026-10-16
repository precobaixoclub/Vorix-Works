"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Pencil, Search, Trash2, UserRound, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input, Label, Select, SelectItem } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { createInboxQuickReply, deleteInboxQuickReply, searchInboxContacts, startInboxConversation, updateInboxQuickReply } from "@/features/inbox/api";
import { useInboxConnections, useInboxQuickReplies } from "@/features/inbox/hooks";
import type { InboxConversation, InboxQuickReply } from "@/features/inbox/types";

// ── Nova conversa ───────────────────────────────────────────────────────────────────────────────

type SavedContact = { id: string; name?: string; phoneNormalized: string };

/**
 * "Nova conversa": escolhe o número de WhatsApp conectado, o destinatário (contato salvo ou número
 * novo) e a primeira mensagem. Se já existir conversa com a pessoa, o servidor reaproveita a mesma.
 */
export function NewConversationModal({
  workspaceId,
  initialPhone,
  initialName,
  onClose,
  onStarted,
}: {
  workspaceId: string;
  initialPhone?: string;
  initialName?: string;
  onClose: () => void;
  onStarted: (conversationId: string) => void | Promise<void>;
}) {
  const { data: connectionsData, isLoading: loadingConnections } = useInboxConnections(workspaceId);
  // Só WhatsApp: no Instagram a pessoa precisa mandar a primeira mensagem (regra da Meta).
  const whatsapp = useMemo(() => (connectionsData?.connections ?? []).filter((connection) => (connection.provider ?? "wuzapi") === "wuzapi"), [connectionsData]);
  const connected = whatsapp.filter((connection) => connection.status === "connected");
  const [connectionId, setConnectionId] = useState("");
  useEffect(() => {
    if (!connectionId && connected[0]) setConnectionId(connected[0].id);
  }, [connected, connectionId]);

  const [mode, setMode] = useState<"saved" | "new">(initialPhone || initialName ? "new" : "saved");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [name, setName] = useState(initialName ?? "");
  const [contact, setContact] = useState<SavedContact | undefined>();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const phoneDigits = phone.replace(/\D/g, "");
  const recipientReady = mode === "saved" ? !!contact : phoneDigits.length >= 10 && phoneDigits.length <= 15;
  const canSubmit = !!connectionId && recipientReady && !!body.trim() && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await startInboxConversation(workspaceId, {
        connectionId,
        body: body.trim(),
        ...(mode === "saved" && contact ? { contactId: contact.id } : { phone: phoneDigits, name: name.trim() || undefined }),
      });
      toast.success(result.wasExisting ? "Mensagem enviada na conversa existente." : "Conversa iniciada.");
      await onStarted(result.conversationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a conversa.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nova conversa" onClose={() => { if (!submitting) onClose(); }} maxWidthClass="sm:max-w-lg">
      <div className="space-y-4">
        {loadingConnections ? (
          <p className="text-sm text-muted-foreground">Carregando canais…</p>
        ) : connected.length === 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
            Nenhum número de WhatsApp conectado agora. Conecte um número na aba <strong>Canais</strong> para iniciar conversas.
          </div>
        ) : connected.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="new-conversation-connection">Enviar pelo número</Label>
            <Select id="new-conversation-connection" value={connectionId} onValueChange={setConnectionId}>
              {connected.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>{connection.displayName}{connection.phoneNumber ? ` · ${connection.phoneNumber}` : ""}</SelectItem>
              ))}
            </Select>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Enviando por <strong className="text-foreground">{connected[0].displayName}{connected[0].phoneNumber ? ` · ${connected[0].phoneNumber}` : ""}</strong></p>
        )}

        <div className="space-y-2">
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm" role="tablist" aria-label="Destinatário">
            {([["saved", "Contato salvo"], ["new", "Novo número"]] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}
                className={cn("rounded-md px-3 py-1.5 font-medium transition-colors", mode === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>
          {mode === "saved" ? (
            <SavedContactPicker workspaceId={workspaceId} selected={contact} onSelect={setContact} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-conversation-phone">Telefone com DDD</Label>
                <Input id="new-conversation-phone" inputMode="tel" autoComplete="tel" placeholder="(11) 91234-5678" value={phone} onChange={(event) => setPhone(event.target.value)} autoFocus />
                <p className="text-[11px] text-muted-foreground">Outros países: inclua o código, ex. +1 415…</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-conversation-name">Nome (opcional)</Label>
                <Input id="new-conversation-name" placeholder="Nome do contato" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-conversation-body">Primeira mensagem</Label>
          <Textarea id="new-conversation-body" rows={4} placeholder="Olá! Tudo bem?" value={body} onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void handleSubmit(); }} />
        </div>

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={() => void handleSubmit()} loading={submitting} disabled={!canSubmit}>Iniciar conversa</Button>
        </div>
      </div>
    </Modal>
  );
}

function SavedContactPicker({ workspaceId, selected, onSelect }: { workspaceId: string; selected?: SavedContact; onSelect: (contact: SavedContact | undefined) => void }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    searchInboxContacts(workspaceId, debouncedSearch)
      .then((result) => { if (!cancelled) setContacts(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível buscar os contatos."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, debouncedSearch]);

  if (selected) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-2 text-sm">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-primary-glow"><UserRound className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{selected.name || selected.phoneNormalized}</span><span className="block truncate text-xs text-muted-foreground">{selected.phoneNormalized}</span></span>
        <Button variant="ghost" size="sm" onClick={() => onSelect(undefined)}>Trocar</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus placeholder="Buscar por nome ou telefone…" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 p-1">
        {loading ? (
          <p className="px-2 py-5 text-center text-sm text-muted-foreground">Buscando…</p>
        ) : error ? (
          <p className="px-2 py-5 text-center text-sm text-destructive">{error}</p>
        ) : contacts.length === 0 ? (
          <p className="px-2 py-5 text-center text-sm text-muted-foreground">{search.trim() ? "Nenhum contato encontrado. Use \"Novo número\"." : "Nenhum contato salvo ainda. Use \"Novo número\"."}</p>
        ) : (
          contacts.map((item) => (
            <button key={item.id} type="button" onClick={() => onSelect(item)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserRound className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{item.name || item.phoneNormalized}</span>{item.name ? <span className="block truncate text-xs text-muted-foreground">{item.phoneNormalized}</span> : null}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Respostas rápidas ───────────────────────────────────────────────────────────────────────────

/** Atalho sendo digitado no composer: o rascunho inteiro é "/algo" (sem espaço). */
export function quickReplyQuery(draft: string): string | undefined {
  const match = /^\/([\p{L}\p{N}_-]*)$/u.exec(draft);
  return match ? match[1].toLowerCase() : undefined;
}

export function filterQuickReplies(items: readonly InboxQuickReply[], query: string): InboxQuickReply[] {
  const term = query.toLowerCase();
  const byShortcut = items.filter((item) => item.shortcut.startsWith(term));
  const byBody = items.filter((item) => !item.shortcut.startsWith(term) && (item.shortcut.includes(term) || item.body.toLowerCase().includes(term)));
  return [...byShortcut, ...byBody].slice(0, 8);
}

/** Sugestões acima do composer enquanto a pessoa digita "/atalho". ↑/↓ navega, Enter/Tab escolhe. */
export function useQuickReplySuggestions(workspaceId: string, draft: string, onPick: (body: string) => void) {
  const { data } = useInboxQuickReplies(workspaceId);
  const items = data ?? [];
  const query = quickReplyQuery(draft);
  const [dismissedFor, setDismissedFor] = useState<string | undefined>();
  const [active, setActive] = useState(0);
  const matches = query === undefined || dismissedFor === draft ? [] : filterQuickReplies(items, query);
  useEffect(() => { setActive(0); }, [query]);

  /** Devolve `true` quando consumiu a tecla (o composer não deve enviar). */
  function handleKeyDown(event: React.KeyboardEvent): boolean {
    if (!matches.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      return true;
    }
    // Teclado de composição (acentos, japonês…) ou Shift+Enter: nunca escolhe uma sugestão.
    if (event.nativeEvent.isComposing || event.shiftKey) return false;
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      onPick(matches[active]?.body ?? "");
      return true;
    }
    if (event.key === "Escape") {
      // Fecha só as sugestões (nunca o painel/drawer em volta).
      event.preventDefault();
      event.stopPropagation();
      setDismissedFor(draft);
      return true;
    }
    return false;
  }

  const menu = matches.length ? (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" role="listbox" aria-label="Respostas rápidas">
      <p className="border-b border-border/60 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Respostas rápidas · ↑↓ para navegar, Enter para usar</p>
      {matches.map((item, index) => (
        <button key={item.id} type="button" role="option" aria-selected={index === active} onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(item.body)}
          className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-sm", index === active ? "bg-primary/10" : "hover:bg-muted")}>
          <span className="shrink-0 font-mono text-xs font-semibold text-primary dark:text-primary-glow">/{item.shortcut}</span>
          <span className="line-clamp-2 min-w-0 flex-1 text-muted-foreground">{item.body}</span>
        </button>
      ))}
    </div>
  ) : null;
  return { menu, handleKeyDown, hasQuickReplies: items.length > 0 };
}

export function QuickRepliesButton({ disabled, onOpen }: { disabled?: boolean; onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onOpen} aria-label="Respostas rápidas">
            <Zap className="h-4 w-4" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Respostas rápidas (ou digite / no campo)</TooltipContent>
    </Tooltip>
  );
}

/** Escolher e gerenciar respostas rápidas. `onPick` insere no composer. */
export function QuickRepliesModal({ workspaceId, onClose, onPick }: { workspaceId: string; onClose: () => void; onPick?: (body: string) => void }) {
  const { data, isLoading, mutate } = useInboxQuickReplies(workspaceId);
  const items = data ?? [];
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<InboxQuickReply | "new" | undefined>();
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<InboxQuickReply | undefined>();
  const [deletingBusy, setDeletingBusy] = useState(false);
  const filtered = search.trim() ? filterQuickReplies(items, search.trim().replace(/^\//, "")) : items;

  function startEdit(item: InboxQuickReply | "new") {
    setEditing(item);
    setShortcut(item === "new" ? "" : item.shortcut);
    setBody(item === "new" ? "" : item.body);
    setError(undefined);
  }

  async function save() {
    if (!editing || !shortcut.trim() || !body.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      if (editing === "new") await createInboxQuickReply(workspaceId, { shortcut, body });
      else await updateInboxQuickReply(workspaceId, editing.id, { shortcut, body });
      await mutate();
      setEditing(undefined);
      toast.success("Resposta rápida salva.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await deleteInboxQuickReply(workspaceId, deleting.id);
      await mutate();
      setDeleting(undefined);
    } catch (cause) {
      toast.error("Não foi possível excluir.", { description: cause instanceof Error ? cause.message : undefined });
    } finally {
      setDeletingBusy(false);
    }
  }

  return (
    <Modal title="Respostas rápidas" onClose={onClose} maxWidthClass="sm:max-w-xl">
      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="quick-reply-shortcut">Atalho</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">/</span>
              <Input id="quick-reply-shortcut" className="pl-6 font-mono" placeholder="bom-dia" value={shortcut} onChange={(event) => setShortcut(event.target.value)} autoFocus />
            </div>
            <p className="text-[11px] text-muted-foreground">No campo de mensagem, digite /{shortcut.trim().replace(/^\//, "").toLowerCase().replace(/\s+/g, "-") || "atalho"} para usar.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-reply-body">Mensagem</Label>
            <Textarea id="quick-reply-body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Olá! Obrigado pelo contato…" />
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(undefined)} disabled={saving}>Voltar</Button>
            <Button onClick={() => void save()} loading={saving} disabled={saving || !shortcut.trim() || !body.trim()}>Salvar</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar resposta…" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Button onClick={() => startEdit("new")}>Nova resposta</Button>
          </div>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{items.length ? "Nenhuma resposta encontrada." : "Crie mensagens prontas para as perguntas mais comuns e use digitando / no campo de mensagem."}</p>
            ) : (
              filtered.map((item) => (
                <div key={item.id} className="group flex items-start gap-2 rounded-lg border border-border/60 p-2.5">
                  <button type="button" className="min-w-0 flex-1 text-left disabled:cursor-default" disabled={!onPick} onClick={() => onPick?.(item.body)}>
                    <span className="font-mono text-xs font-semibold text-primary dark:text-primary-glow">/{item.shortcut}</span>
                    <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap text-sm text-foreground">{item.body}</span>
                  </button>
                  <div className="flex shrink-0 gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(item)} aria-label={`Editar /${item.shortcut}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleting(item)} aria-label={`Excluir /${item.shortcut}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))
            )}
          </div>
          {onPick && filtered.length ? <p className="text-[11px] text-muted-foreground">Clique numa resposta para colocá-la no campo de mensagem.</p> : null}
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Excluir resposta rápida"
        description={deleting ? `A resposta /${deleting.shortcut} será excluída para toda a equipe.` : ""}
        confirmLabel="Excluir"
        variant="danger"
        busy={deletingBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(undefined)}
      />
    </Modal>
  );
}

// ── Alertas de mensagem nova ────────────────────────────────────────────────────────────────────

const ALERTS_STORAGE_KEY = "vorix.inbox.alerts";

function readAlertsPreference(): boolean {
  try { return localStorage.getItem(ALERTS_STORAGE_KEY) !== "off"; } catch { return true; }
}

function playChime() {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    for (const [frequency, start] of [[880, 0], [1320, 0.12]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + start);
      oscillator.stop(context.currentTime + start + 0.3);
    }
    setTimeout(() => void context.close().catch(() => undefined), 800);
  } catch {
    // Som é cortesia: navegador sem áudio/autoplay bloqueado nunca quebra a Inbox.
  }
}

/**
 * Som + notificação do navegador quando chega mensagem de cliente — só para conversas que a pessoa
 * NÃO está olhando agora (outra conversa ou aba em segundo plano). Também mostra o total de não
 * lidas no título da aba. A primeira carga nunca alerta (só o que chega depois).
 */
export function useInboundAlerts(conversations: readonly InboxConversation[], selectedConversationId: string | undefined, displayName: (conversation: InboxConversation) => string) {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { setEnabled(readAlertsPreference()); }, []);
  const seen = useRef<Map<string, string> | undefined>(undefined);

  useEffect(() => {
    if (!conversations.length && !seen.current) return;
    const previous = seen.current;
    const next = new Map<string, string>();
    for (const conversation of conversations) next.set(conversation.id, conversation.lastMessageAt ?? "");
    seen.current = next;
    if (!previous || !enabled) return;
    const fresh = conversations.filter((conversation) => {
      const before = previous.get(conversation.id);
      const changed = conversation.lastMessageAt && conversation.lastMessageAt !== before && (!before || conversation.lastMessageAt > before);
      const fromCustomer = conversation.lastMessagePreview?.direction === "inbound";
      const watching = conversation.id === selectedConversationId && document.visibilityState === "visible";
      return changed && fromCustomer && !watching;
    });
    if (!fresh.length) return;
    playChime();
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
      const first = fresh[0];
      try {
        const notification = new Notification(fresh.length > 1 ? `${fresh.length} conversas com mensagens novas` : displayName(first), {
          body: fresh.length > 1 ? "Abra o Vorix para responder." : first.lastMessagePreview?.body?.slice(0, 120) || "Nova mensagem",
          tag: `vorix-inbox-${first.id}`,
        });
        notification.onclick = () => { window.focus(); notification.close(); };
      } catch {
        // Alguns navegadores móveis só aceitam notificação via service worker — som já avisou.
      }
    }
  }, [conversations, enabled, selectedConversationId, displayName]);

  // Contador de não lidas no título da aba.
  const unread = conversations.reduce((sum, conversation) => sum + (conversation.unreadCount > 0 ? 1 : 0), 0);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
    return () => { document.title = document.title.replace(/^\(\d+\)\s*/, ""); };
  }, [unread]);

  async function toggle() {
    const nextValue = !enabled;
    if (nextValue && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => undefined);
    }
    try { localStorage.setItem(ALERTS_STORAGE_KEY, nextValue ? "on" : "off"); } catch { /* preferência só desta sessão */ }
    setEnabled(nextValue);
    if (nextValue) playChime();
  }
  return { enabled, toggle };
}

export function InboundAlertsToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle} aria-pressed={enabled} aria-label={enabled ? "Desativar alertas de mensagem nova" : "Ativar alertas de mensagem nova"}>
          {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{enabled ? "Alertas de mensagem nova ligados" : "Alertas de mensagem nova desligados"}</TooltipContent>
    </Tooltip>
  );
}
