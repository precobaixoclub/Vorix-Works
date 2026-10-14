"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Visão de SUPORTE: contas de gravação de todos os tenants (customer_managed) e o pool interno
 * preparado (vorix_managed). Nunca traz sessão, cookie ou referência a segredo. */
type RecorderBot = {
  id: string;
  label: string;
  googleEmail: string;
  ownershipType: "customer_managed" | "vorix_managed";
  tenantId?: string;
  workspaceId?: string;
  workspaceName?: string;
  status: "active" | "busy" | "reauth_required" | "invalid_session" | "disabled" | "error";
  health: "healthy" | "needs_reconnect" | "pending_test" | "never_connected" | "disabled" | "error";
  connected: boolean;
  currentMeetingId?: string;
  currentMeetingTitle?: string;
  lastUsedAt?: string;
  lastHealthCheckAt?: string;
  lastError?: string;
};

const OWNERSHIP_LABEL: Record<RecorderBot["ownershipType"], string> = { customer_managed: "Do cliente", vorix_managed: "Pool Vorix (preparado)" };

const STATUS: Record<RecorderBot["status"], { label: string; tone: string }> = {
  active: { label: "Ativo", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  busy: { label: "Gravando", tone: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" },
  reauth_required: { label: "Precisa reconectar", tone: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" },
  invalid_session: { label: "Sessão inválida", tone: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" },
  disabled: { label: "Desativado", tone: "bg-muted text-muted-foreground" },
  error: { label: "Erro", tone: "bg-destructive/10 text-destructive" },
};

const BASE = "/v1/admin/meetings/recorder-bots";
const message = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : "Tente novamente.");

/**
 * Suporte da plataforma: todas as contas de gravação. As contas dos CLIENTES são conectadas por eles
 * mesmos (Meetings → Configurações → Contas de gravação); aqui o suporte só enxerga dono, tenant,
 * workspace, saúde e uso, e pode testar/desativar. O cadastro manual com arquivo de sessão é um
 * fallback interno do pool `vorix_managed` (preparado, sem uso comercial).
 */
export default function AdminMeetingsBotsPage() {
  const { data, error, mutate } = useSWR("admin-recorder-bots", () => apiClient.get<{ bots: RecorderBot[] }>(BASE), {
    refreshInterval: (current) => (current?.bots.some((bot) => bot.health === "pending_test" || bot.status === "busy") ? 5000 : 0),
  });
  const [creating, setCreating] = useState(false);
  const [sessionFor, setSessionFor] = useState<RecorderBot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(botId: string, path: string, success: string) {
    setBusy(botId);
    try {
      await apiClient.post(`${BASE}/${encodeURIComponent(botId)}/${path}`, {});
      toast.success(success);
      await mutate();
    } catch (cause) {
      toast.error("Não foi possível concluir", { description: message(cause) });
    } finally {
      setBusy(null);
    }
  }

  const bots = data?.bots ?? [];
  return (
    <main className="space-y-6 p-4 sm:p-8">
      <PageHeader title="Contas de gravação (suporte)" description="Contas Google de gravação de todos os clientes, com dono, workspace, saúde e uso." actions={<Button variant="secondary" onClick={() => setCreating(true)}>Cadastrar no pool interno</Button>} />
      <Card className="p-4 text-sm text-muted-foreground">
        Os clientes conectam as próprias contas em Meetings → Configurações → Contas de gravação, fazendo login direto no Google. O suporte não precisa (nem deve) pedir senha ou arquivo de sessão a ninguém.
      </Card>
      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Dono</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sessão</TableHead>
              <TableHead>Último teste</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead>Reunião atual</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bots.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{data ? "Nenhuma conta de gravação." : "Carregando…"}</TableCell></TableRow>
            ) : (
              bots.map((bot) => (
                <TableRow key={bot.id} data-testid="recorder-bot-row">
                  <TableCell>
                    <p className="font-medium text-foreground">{bot.label}</p>
                    <p className="text-xs text-muted-foreground">{bot.googleEmail}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">{OWNERSHIP_LABEL[bot.ownershipType]}</p>
                    {bot.tenantId ? <p>Tenant {bot.tenantId}</p> : null}
                    {bot.workspaceId ? <p>{bot.workspaceName ?? bot.workspaceId}</p> : null}
                  </TableCell>
                  <TableCell>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[bot.status].tone)}>{STATUS[bot.status].label}</span>
                    {bot.lastError ? <p className="mt-1 max-w-[220px] truncate text-xs text-destructive" title={bot.lastError}>{bot.lastError}</p> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{bot.connected ? "Cifrada" : "Não conectada"}{bot.health === "pending_test" ? " · teste na fila" : ""}</TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">{bot.lastHealthCheckAt ? formatDateTime(bot.lastHealthCheckAt) : "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">{bot.lastUsedAt ? formatDateTime(bot.lastUsedAt) : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{bot.currentMeetingTitle ?? bot.currentMeetingId ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {bot.ownershipType === "vorix_managed" ? <Button variant="secondary" disabled={bot.status === "busy"} onClick={() => setSessionFor(bot)}>Enviar sessão</Button> : null}
                      <Button variant="secondary" disabled={busy === bot.id || bot.status === "busy" || !bot.connected} onClick={() => act(bot.id, "health-check", "Teste de sessão pedido ao recorder.")}>Testar sessão</Button>
                      <Button variant="secondary" disabled={busy === bot.id || bot.status === "busy" || bot.status === "disabled"} onClick={() => act(bot.id, "disable", "Bot desativado.")}>Desativar</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {creating ? <CreateBotDialog onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await mutate(); }} /> : null}
      {sessionFor ? <SessionDialog bot={sessionFor} onClose={() => setSessionFor(null)} onSaved={async () => { setSessionFor(null); await mutate(); }} /> : null}
    </main>
  );
}

function CreateBotDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [id, setId] = useState("bot-01");
  const [label, setLabel] = useState("BOT 01");
  const [googleEmail, setGoogleEmail] = useState("");
  const [displayName, setDisplayName] = useState("Vorix Recorder");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await apiClient.post(BASE, { id, label, googleEmail, displayName });
      toast.success("Bot cadastrado — envie a sessão Google para ativá-lo.");
      onSaved();
    } catch (cause) {
      toast.error("Não foi possível cadastrar", { description: message(cause) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Cadastrar bot de gravação" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="bot-id">Identificador</Label><Input id="bot-id" value={id} onChange={(e) => setId(e.target.value)} /></div>
        <div><Label htmlFor="bot-label">Nome interno</Label><Input id="bot-label" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="bot-email">E-mail da conta Google dedicada</Label><Input id="bot-email" type="email" value={googleEmail} onChange={(e) => setGoogleEmail(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="bot-display">Nome visível na reunião</Label><Input id="bot-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Nenhuma senha é pedida aqui. Use sempre uma conta criada só para gravação — nunca a conta pessoal de um cliente.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={submit} loading={busy} disabled={busy || !id.trim() || !label.trim() || !googleEmail.trim()}>Cadastrar</Button>
      </div>
    </Modal>
  );
}

function SessionDialog({ bot, onClose, onSaved }: { bot: RecorderBot; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const storageState = JSON.parse(await file.text()) as unknown;
      await apiClient.put(`${BASE}/${encodeURIComponent(bot.id)}/session`, { storageState });
      toast.success("Sessão enviada e cifrada. Agora teste a sessão.");
      onSaved();
    } catch (cause) {
      toast.error("Sessão inválida", { description: message(cause) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Sessão Google — ${bot.label}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">Envie o arquivo gerado pelo <code>capture-bot-session.mjs</code>. Ele é cifrado no servidor e o bot volta para “Desativado” até o teste de sessão passar. Apague o arquivo local depois.</p>
      <input type="file" accept="application/json,.json" className="mt-3 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Arquivo de sessão" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={submit} loading={busy} disabled={busy || !file}>Enviar sessão</Button>
      </div>
    </Modal>
  );
}
