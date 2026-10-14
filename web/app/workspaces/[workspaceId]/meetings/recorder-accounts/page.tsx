"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { StatsGrid } from "@/components/StatsGrid";
import { RemoteLoginViewer } from "@/components/meetings/RemoteLoginViewer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelRecorderProvisioning, connectRecorderAccount, disableRecorderAccount, reconnectRecorderAccount, removeRecorderAccount, testRecorderAccount } from "@/features/meetings/api";
import { useRecorderAccounts } from "@/features/meetings/hooks";
import { RECORDER_HEALTH_LABEL, type ProvisioningStart, type RecorderAccount, type RecordingCapacity } from "@/features/meetings/types";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const HEALTH_TONE: Record<RecorderAccount["health"], string> = {
  healthy: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  needs_reconnect: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  pending_test: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  never_connected: "bg-muted text-muted-foreground",
  disabled: "bg-muted text-muted-foreground",
  error: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};

function errorMessage(error: unknown): string | undefined {
  return error instanceof ApiError || error instanceof Error ? error.message : undefined;
}

/**
 * Meetings → Configurações → Contas de gravação. Cada cliente conecta as PRÓPRIAS contas Google de
 * gravação, sem terminal, script ou suporte: o login é feito por ele, direto no Google, num
 * navegador temporário transmitido para esta tela.
 */
export default function RecorderAccountsPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const canManage = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");
  const { data, error, isLoading, mutate } = useRecorderAccounts(workspace.id, canManage);
  const [connecting, setConnecting] = useState<{ mode: "new" } | { mode: "reconnect"; account: RecorderAccount } | null>(null);
  const [removing, setRemoving] = useState<RecorderAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(account: RecorderAccount, action: () => Promise<unknown>, success: string) {
    setBusyId(account.id);
    try {
      await action();
      toast.success(success);
      await mutate();
    } catch (cause) {
      toast.error("Não foi possível concluir", { description: errorMessage(cause) });
    } finally {
      setBusyId(null);
    }
  }

  if (!canManage) {
    return (
      <main className="mx-auto max-w-[1280px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
        <PageHeader title="Contas de gravação" description="Contas Google usadas pelo Vorix para gravar as reuniões." />
        <EmptyState title="Acesso restrito" description="Somente administradores do workspace conectam e gerenciam contas de gravação." />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1280px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Contas de gravação"
        description="Contas Google que o Vorix usa para entrar e gravar as reuniões. A escolha da conta em cada reunião é automática."
        actions={<Button onClick={() => setConnecting({ mode: "new" })} disabled={data?.selfServiceAvailable === false}><Plus className="h-4 w-4" aria-hidden="true" />Conectar conta</Button>}
      />

      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      {isLoading && !data ? (
        <div className="flex justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : null}

      {data ? (
        <>
          <CapacityCards capacity={data.capacity} />
          <CapacityAlert capacity={data.capacity} />
          <Card className="space-y-2 p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Como funciona</p>
            <p>
              Você possui {data.capacity.healthyAccounts} conta(s) de gravação saudáveis. Sua capacidade efetiva continua limitada
              pelo seu plano e pela disponibilidade dessas contas. Cada conta pode gravar uma reunião por vez; contas extras ficam como reserva.
            </p>
            <p>
              Use contas Google <strong className="font-medium text-foreground">dedicadas à gravação</strong> (ex.: gravador01@suaempresa.com). A conta com que uma pessoa
              entra em uma reunião nunca grava essa mesma reunião — o Vorix escolhe outra conta automaticamente.
            </p>
          </Card>

          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta</TableHead>
                  <TableHead>Saúde</TableHead>
                  <TableHead>Último teste</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead>Agora</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma conta de gravação conectada ainda. Use “Conectar conta”.</TableCell>
                  </TableRow>
                ) : (
                  data.accounts.map((account) => {
                    const busy = account.status === "busy";
                    return (
                      <TableRow key={account.id} data-testid="recorder-account-row">
                        <TableCell className="max-w-[280px]">
                          <p className="truncate font-medium text-foreground">{account.label}</p>
                          <p className="truncate text-xs text-muted-foreground">{account.googleEmail}</p>
                          {account.isKnownHumanAccount ? <p className="text-xs text-amber-700 dark:text-amber-300">Esta conta aparece na sua agenda ou em reuniões anteriores. Confirme qual conta você usará para participar.</p> : account.personalAccountWarning ? <p className="text-xs text-muted-foreground">Parece uma conta pessoal — prefira uma conta dedicada.</p> : null}
                        </TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", HEALTH_TONE[account.health])}>{RECORDER_HEALTH_LABEL[account.health]}</span>
                          {account.health === "needs_reconnect" ? <p className="mt-1 text-xs text-muted-foreground">Reconecte esta conta para continuar utilizando-a nas gravações.</p> : null}
                          {account.lastError && account.health !== "healthy" && account.health !== "needs_reconnect" ? <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground" title={account.lastError}>{account.lastError}</p> : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{account.lastHealthCheckAt ? formatDateTime(account.lastHealthCheckAt) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{account.lastUsedAt ? formatDateTime(account.lastUsedAt) : "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {busy ? (
                            account.currentMeetingId ? <Link className="underline" href={`/workspaces/${workspace.id}/meetings/central/${account.currentMeetingId}`}>Gravando: {account.currentMeetingTitle ?? "reunião"}</Link> : "Gravando"
                          ) : "Livre"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button size="sm" variant="secondary" disabled={busy || !account.connected || busyId === account.id} title={busy ? "A conta está gravando agora" : !account.connected ? "Conecte a conta antes de testar" : undefined} onClick={() => run(account, () => testRecorderAccount(account.id), "Teste solicitado")}>Testar</Button>
                            <Button size="sm" variant="secondary" disabled={busy || busyId === account.id} title={busy ? "A conta está gravando agora" : undefined} onClick={() => setConnecting({ mode: "reconnect", account })}>Reconectar</Button>
                            <Button size="sm" variant="secondary" disabled={busy || account.status === "disabled" || busyId === account.id} title={busy ? "A conta está gravando agora" : undefined} onClick={() => run(account, () => disableRecorderAccount(account.id), "Conta desativada")}>Desativar</Button>
                            <Button size="sm" variant="secondary" disabled={busy || busyId === account.id} title={busy ? "A conta está gravando agora" : undefined} onClick={() => setRemoving(account)}>Remover</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      ) : null}

      {connecting ? (
        <ConnectRecorderAccountDialog
          workspaceId={workspace.id}
          reconnect={connecting.mode === "reconnect" ? connecting.account : undefined}
          onClose={() => { setConnecting(null); void mutate(); }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remover a conta “${removing?.label ?? ""}”?`}
        description={`A sessão de ${removing?.googleEmail ?? "esta conta"} é apagada do Vorix e a conta deixa de gravar reuniões. Para usá-la de novo, será preciso conectá-la outra vez.`}
        confirmLabel="Remover conta"
        variant="danger"
        busy={busyId === removing?.id}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await run(removing, () => removeRecorderAccount(removing.id), "Conta removida");
          setRemoving(null);
        }}
      />
    </main>
  );
}

function CapacityCards({ capacity }: { capacity: RecordingCapacity }) {
  const items = [
    { label: "Gravações simultâneas do plano", value: capacity.planCapacity },
    { label: "Contas conectadas", value: capacity.connectedAccounts },
    { label: "Capacidade com contas saudáveis", value: capacity.tenantHealthyCapacity, hint: "menor valor entre o plano e as contas saudáveis" },
    { label: "Contas disponíveis no plano", value: capacity.tenantAvailableCapacity, hint: `${capacity.availableNow} gravação(ões) podem começar agora` },
  ];
  return (
    <StatsGrid>
      {items.map((item) => (
        <Card key={item.label} className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{item.value}</p>
          {item.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p> : null}
        </Card>
      ))}
    </StatsGrid>
  );
}

function CapacityAlert({ capacity }: { capacity: RecordingCapacity }) {
  let text: string | undefined;
  if (capacity.connectedAccounts === 0) text = "Nenhuma conta de gravação conectada: o Vorix ainda não consegue gravar reuniões. Conecte uma conta Google de gravação.";
  else if (capacity.healthyAccounts === 0 && capacity.invalidAccounts > 0) text = "Suas contas de gravação precisam ser reconectadas — nenhuma reunião pode ser gravada até lá.";
  else if (capacity.missingAccountsForPlan > 0) text = `Seu plano permite ${capacity.planLimit} gravações simultâneas, mas só ${capacity.healthyAccounts} conta(s) estão prontas. Conecte mais ${capacity.missingAccountsForPlan} conta(s) para usar todo o limite.`;
  if (!text) return null;
  return (
    <Card className="flex items-start gap-2 border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{text}</p>
    </Card>
  );
}

/** Conectar/Reconectar: dados da conta → navegador temporário de login (o cliente entra no Google). */
function ConnectRecorderAccountDialog({ workspaceId, reconnect, onClose }: { workspaceId: string; reconnect?: RecorderAccount; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<ProvisioningStart | null>(null);
  const [finished, setFinished] = useState<{ status: string; message?: string } | null>(null);

  async function start() {
    setBusy(true);
    try {
      const result = reconnect ? await reconnectRecorderAccount(workspaceId, reconnect.id) : await connectRecorderAccount(workspaceId, { label, googleEmail: email });
      for (const warning of result.warnings) toast.warning("Atenção", { description: warning });
      setStarted(result);
    } catch (cause) {
      toast.error("Não foi possível iniciar a conexão", { description: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    // Fechar antes de terminar cancela a sessão e destrói o navegador temporário.
    if (started && !finished) await cancelRecorderProvisioning(started.session.id).catch(() => undefined);
    onClose();
  }

  if (!started && !reconnect) {
    return (
      <Modal title="Conectar conta de gravação" onClose={onClose}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="recorder-label">Nome da conta</Label>
            <Input id="recorder-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="Ex.: Gravador Comercial 01" autoFocus />
          </div>
          <div>
            <Label htmlFor="recorder-email">Conta Google de gravação</Label>
            <Input id="recorder-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="gravador01@suaempresa.com" />
            <p className="mt-1 text-xs text-muted-foreground">Recomendamos uma conta dedicada, que ninguém use para participar das reuniões.</p>
          </div>
          <p className="text-xs text-muted-foreground">No próximo passo você entra nessa conta direto na página do Google. O Vorix não pede nem guarda sua senha.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={start} loading={busy} disabled={busy || !label.trim() || !email.trim()}>Continuar</Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (!started && reconnect) {
    return (
      <Modal title={`Reconectar “${reconnect.label}”`} onClose={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Você vai entrar de novo em <strong className="font-medium text-foreground">{reconnect.googleEmail}</strong> direto na página do Google. A sessão será substituída depois que a nova conexão for validada.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={start} loading={busy} disabled={busy}>Abrir login do Google</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Entrar em ${started!.account.googleEmail}`} onClose={() => void close()} maxWidthClass="sm:max-w-4xl">
      <div className="space-y-3">
        <RemoteLoginViewer viewerToken={started!.viewerToken} streamPath={started!.streamPath} onFinished={(result) => setFinished(result)} />
        <div className="flex justify-end gap-2">
          {finished?.status === "completed" ? <Button onClick={onClose}>Concluir</Button> : <Button variant="secondary" onClick={() => void close()}>{finished ? "Fechar" : "Cancelar"}</Button>}
        </div>
      </div>
    </Modal>
  );
}
