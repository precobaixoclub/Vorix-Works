"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { Input, Label } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/format";
import {
  APPROVAL_STATUS_LABEL,
  getWhatsappApprovals,
  saveWhatsappApprovalRule,
  saveWhatsappApprovalSettings,
  sendWhatsappApprovalTest,
  type ApprovalRejectPolicy,
  type ApprovalTimeoutPolicy,
  type WhatsappApprovalsOverview,
} from "@/features/whatsapp-approvals/api";

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Tente novamente.");
const NONE = "__none__";

/**
 * Configurações › Aprovações por WhatsApp. O número é da CONTA (pode estar conectado em qualquer espaço
 * de trabalho — inclusive num que é o único com Conversas); cada marca decide se exige aprovação, quem
 * aprova e o que acontece se ninguém responder até o horário.
 */
export default function WhatsappApprovalsPage() {
  const { data, error, isLoading, mutate } = useSWR("whatsapp-approvals", getWhatsappApprovals, { refreshInterval: 20_000 });
  return (
    <SettingsShell active="approvals" title="Aprovações por WhatsApp" description="Receba cada publicação no seu WhatsApp e responda 1 para aprovar ou 2 para reprovar.">
      {isLoading ? <Skeleton className="h-[420px] w-full rounded-xl" /> : error || !data ? (
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar as aprovações: {errorText(error)}</p>
      ) : (
        <div className="space-y-4">
          <AccountNumber data={data} onSaved={() => mutate()} />
          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Marcas</p>
                <p className="mt-1 text-xs text-muted-foreground">Com a aprovação ligada, toda publicação nova da marca fica aguardando sua resposta antes de ir ao ar — inclusive as do piloto automático.</p>
              </div>
            </CardHeader>
            <CardBody className="divide-y divide-border p-0">
              {data.workspaces.map((workspace) => <BrandRule key={workspace.id} data={data} workspace={workspace} onSaved={() => mutate()} />)}
            </CardBody>
          </Card>
          <Recent data={data} />
        </div>
      )}
    </SettingsShell>
  );
}

function AccountNumber({ data, onSaved }: { data: WhatsappApprovalsOverview; onSaved: () => void }) {
  const [connectionId, setConnectionId] = useState(data.settings.connectionId ?? data.connections[0]?.id ?? "");
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [busy, setBusy] = useState(false);
  const dirty = enabled !== data.settings.enabled || (connectionId || undefined) !== data.settings.connectionId;

  async function save() {
    setBusy(true);
    try {
      await saveWhatsappApprovalSettings({ enabled, connectionId: connectionId || null });
      toast.success(enabled ? "Número de aprovações salvo." : "Aprovações por WhatsApp desligadas.");
      onSaved();
    } catch (error) {
      toast.error("Não foi possível salvar", { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <p className="text-sm font-semibold text-foreground">Número que envia os pedidos</p>
          <p className="mt-1 text-xs text-muted-foreground">Um número só para a conta inteira. As respostas de aprovação não aparecem nas Conversas.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!data.canManage || !data.connections.length} aria-label="Ligar aprovações por WhatsApp" />
      </CardHeader>
      <CardBody className="space-y-3">
        {data.connections.length ? (
          <div className="max-w-md">
            <Label htmlFor="approval-connection">WhatsApp conectado</Label>
            <Select value={connectionId} onValueChange={setConnectionId} disabled={!data.canManage}>
              <SelectTrigger id="approval-connection"><SelectValue placeholder="Escolha o número" /></SelectTrigger>
              <SelectContent>
                {data.connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {[connection.displayName ?? connection.phoneNumber ?? "WhatsApp", connection.workspaceName ? `(${connection.workspaceName})` : "", connection.status === "connected" ? "" : "— desconectado"].filter(Boolean).join(" ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum WhatsApp conectado nesta conta. Conecte um número em Conversas › Canais de atendimento de qualquer espaço de trabalho.</p>
        )}
        {data.canManage ? (
          <div className="flex justify-end"><Button onClick={save} loading={busy} disabled={!dirty || busy || (enabled && !connectionId)}>Salvar número</Button></div>
        ) : <p className="text-xs text-muted-foreground">Só o dono ou um administrador da conta altera esta configuração.</p>}
      </CardBody>
    </Card>
  );
}

function BrandRule({ data, workspace, onSaved }: { data: WhatsappApprovalsOverview; workspace: WhatsappApprovalsOverview["workspaces"][number]; onSaved: () => void }) {
  const rule = workspace.rule;
  const [enabled, setEnabled] = useState(rule.enabled);
  const [approverUserId, setApproverUserId] = useState(rule.approverUserId ?? (data.approvers.length === 1 ? data.approvers[0].userId : ""));
  const [approverPhone, setApproverPhone] = useState(rule.approverPhone ?? "");
  const [onTimeout, setOnTimeout] = useState<ApprovalTimeoutPolicy>(rule.onTimeout);
  const [onReject, setOnReject] = useState<ApprovalRejectPolicy>(rule.onReject ?? "redo");
  const [busy, setBusy] = useState<"save" | "test" | undefined>();
  useEffect(() => { setEnabled(rule.enabled); setApproverPhone(rule.approverPhone ?? ""); setOnTimeout(rule.onTimeout); setOnReject(rule.onReject ?? "redo"); if (rule.approverUserId) setApproverUserId(rule.approverUserId); }, [rule.enabled, rule.approverPhone, rule.onTimeout, rule.onReject, rule.approverUserId]);
  const dirty = enabled !== rule.enabled || approverUserId !== (rule.approverUserId ?? "") || approverPhone.replace(/\D/g, "") !== (rule.approverPhone ?? "").replace(/\D/g, "") || onTimeout !== rule.onTimeout || onReject !== (rule.onReject ?? "redo");
  const accountReady = data.settings.enabled && Boolean(data.settings.connectionId);

  async function save() {
    setBusy("save");
    try {
      await saveWhatsappApprovalRule(workspace.id, { enabled, approverUserId: approverUserId || null, approverPhone: approverPhone.trim() || null, onTimeout, onReject });
      toast.success(enabled ? `${workspace.name}: publicações novas vão pedir aprovação pelo WhatsApp.` : `${workspace.name}: aprovação pelo WhatsApp desligada.`);
      onSaved();
    } catch (error) {
      toast.error("Não foi possível salvar", { description: errorText(error) });
    } finally {
      setBusy(undefined);
    }
  }

  async function test() {
    setBusy("test");
    try {
      await sendWhatsappApprovalTest(workspace.id);
      toast.success("Mensagem de teste enviada. Confira o WhatsApp do aprovador.");
    } catch (error) {
      toast.error("Não foi possível enviar o teste", { description: errorText(error) });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="space-y-3 p-4" data-testid={`approval-rule-${workspace.id}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{workspace.name}</p>
          <p className="text-xs text-muted-foreground">{rule.enabled ? `Exige aprovação desde ${formatDateTime(rule.enabledAt)}` : "Publica sem pedir aprovação pelo WhatsApp"}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!data.canManage} aria-label={`Exigir aprovação para ${workspace.name}`} />
      </div>
      {enabled || rule.enabled ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <Label htmlFor={`approver-${workspace.id}`}>Quem aprova</Label>
            <Select value={approverUserId || NONE} onValueChange={(value) => setApproverUserId(value === NONE ? "" : value)} disabled={!data.canManage}>
              <SelectTrigger id={`approver-${workspace.id}`}><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Escolha</SelectItem>
                {data.approvers.map((approver) => <SelectItem key={approver.userId} value={approver.userId}>{approver.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`approver-phone-${workspace.id}`}>WhatsApp de quem aprova</Label>
            <Input id={`approver-phone-${workspace.id}`} value={approverPhone} onChange={(event) => setApproverPhone(event.target.value)} placeholder="(11) 98888-7777" inputMode="tel" maxLength={40} disabled={!data.canManage} />
          </div>
          <div>
            <Label htmlFor={`timeout-${workspace.id}`}>Sem resposta até o horário</Label>
            <Select value={onTimeout} onValueChange={(value) => setOnTimeout(value as ApprovalTimeoutPolicy)} disabled={!data.canManage}>
              <SelectTrigger id={`timeout-${workspace.id}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Não publica (mais seguro)</SelectItem>
                <SelectItem value="publish">Publica mesmo assim</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`reject-${workspace.id}`}>Reprovada com motivo</Label>
            <Select value={onReject} onValueChange={(value) => setOnReject(value as ApprovalRejectPolicy)} disabled={!data.canManage}>
              <SelectTrigger id={`reject-${workspace.id}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="redo">Refaz a arte e reenvia (até 2 vezes)</SelectItem>
                <SelectItem value="return">Devolve a ideia ao Bolsão</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
      {data.canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          {rule.approverPhone ? <Button variant="secondary" onClick={test} loading={busy === "test"} disabled={Boolean(busy) || !accountReady} title={accountReady ? undefined : "Ligue e salve o número da conta primeiro"}>Enviar teste</Button> : null}
          <Button onClick={save} loading={busy === "save"} disabled={!dirty || Boolean(busy)}>Salvar</Button>
        </div>
      ) : null}
    </div>
  );
}

function Recent({ data }: { data: WhatsappApprovalsOverview }) {
  if (!data.recent.length) return null;
  const names = new Map(data.workspaces.map((workspace) => [workspace.id, workspace.name]));
  return (
    <Card>
      <CardHeader><p className="text-sm font-semibold text-foreground">Pedidos recentes</p></CardHeader>
      <CardBody className="divide-y divide-border p-0">
        {data.recent.map((request) => (
          <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{names.get(request.workspaceId) ?? "Marca"} · código {request.code}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(request.sentAt ?? request.createdAt)}
                {request.decision ? ` · ${request.decision === "approve" ? "aprovado" : "reprovado"}` : ""}
                {request.reason ? ` · “${request.reason}”` : ""}
                {request.detail && request.status === "failed" ? ` · ${request.detail}` : ""}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{APPROVAL_STATUS_LABEL[request.status]}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
