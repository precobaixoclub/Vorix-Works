"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ChannelIcon } from "@/components/ChannelIcon";
import { Input, Label } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { updateWorkspace } from "@/features/workspace/api";
import { formatDateTime } from "@/lib/format";

const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Rio_Branco", "UTC"];
const LANGUAGES = [{ value: "pt-BR", label: "Português (Brasil)" }, { value: "en-US", label: "English" }];
const ASPECT_RATIOS = [{ value: "1:1", label: "Quadrado 1:1" }, { value: "4:5", label: "Vertical 4:5" }, { value: "9:16", label: "Stories/Reels 9:16" }, { value: "16:9", label: "Paisagem 16:9" }];

export default function SettingsPage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const { state } = useAuth();
  const [name, setName] = useState(workspace.name);
  const [kind, setKind] = useState(workspace.kind ?? "");
  const [timezone, setTimezone] = useState(workspace.settings.timezone ?? "America/Sao_Paulo");
  const [language, setLanguage] = useState(workspace.settings.language ?? "pt-BR");
  const [defaultAspectRatio, setDefaultAspectRatio] = useState(workspace.settings.defaultAspectRatio ?? "1:1");
  const [busy, setBusy] = useState(false);

  const marketingIntegrations = useMemo(
    () => workspace.integrations.filter((integration) => ["instagram", "facebook", "tiktok", "youtube", "meta"].some((key) => integration.channel.toLowerCase().includes(key))),
    [workspace.integrations],
  );

  async function save() {
    setBusy(true);
    try {
      await updateWorkspace(workspace.id, {
        name: name.trim(),
        kind: kind.trim() || undefined,
        settings: { ...workspace.settings, timezone, language, defaultAspectRatio },
      });
      toast.success("Configurações salvas.");
      router.refresh();
    } catch (error) {
      toast.error("Não foi possível salvar", { description: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell active="general" title="Configurações" description="Tudo exatamente onde você espera: workspace, equipe, integrações, produtos, automações e cobrança.">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)]">
        <Card>
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-foreground">Geral</p>
              <p className="mt-1 text-xs text-muted-foreground">Informações reais do workspace usadas pelo produto.</p>
            </div>
            <StatusBadge status={workspace.status} />
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="workspace-name">Nome do workspace</Label>
                <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
              </div>
              <div>
                <Label htmlFor="workspace-kind">Descrição curta</Label>
                <Input id="workspace-kind" value={kind} onChange={(event) => setKind(event.target.value)} placeholder="Ex.: Agência, Clínica, Imobiliária" maxLength={80} />
              </div>
              <div>
                <Label htmlFor="workspace-timezone">Fuso horário</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger id="workspace-timezone"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEZONES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="workspace-language">Idioma</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="workspace-language"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANGUAGES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="workspace-aspect">Formato padrão</Label>
                <Select value={defaultAspectRatio} onValueChange={setDefaultAspectRatio}>
                  <SelectTrigger id="workspace-aspect"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASPECT_RATIOS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={save} loading={busy} disabled={!name.trim() || busy}>Salvar alterações</Button>
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><p className="text-sm font-semibold text-foreground">Operação</p></CardHeader>
            <CardBody className="grid gap-3 text-sm">
              <Info label="Criado em" value={formatDateTime(workspace.createdAt)} />
              <Info label="Atualizado em" value={formatDateTime(workspace.updatedAt)} />
              <Info label="Membros" value={String(workspace.members.length)} />
              <Info label="Conta atual" value={state.status === "authenticated" ? state.user.email : "—"} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Integrações de marketing</p>
                <p className="mt-1 text-xs text-muted-foreground">WhatsApp fica em Conversas/Canais para evitar ambiguidade.</p>
              </div>
            </CardHeader>
            <CardBody className="space-y-2">
              {marketingIntegrations.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma integração de marketing conectada.</p> : null}
              {marketingIntegrations.map((integration) => (
                <div key={integration.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                  <ChannelIcon channel={integration.channel} label={integration.displayName ?? integration.channel} showLabel className="min-w-0 text-foreground" />
                  <StatusBadge status={integrationStatus(integration.status)} />
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </SettingsShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
    </div>
  );
}

function integrationStatus(status: string) {
  if (status === "connected") return "connected";
  if (status === "pending") return "requires_repair";
  if (status === "disconnected") return "disconnected";
  return status;
}
