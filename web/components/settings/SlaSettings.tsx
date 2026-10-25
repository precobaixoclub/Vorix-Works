"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { Input } from "@/components/Field";
import { saveSlaPolicy, useSlaPolicies, type SlaPolicy } from "@/features/dashboard/api";
import { useTeams } from "@/features/identity/hooks";
import { useMyAccess } from "@/features/auth/access";

const minutes = (seconds: number | undefined) => (seconds ? String(Math.round(seconds / 60)) : "");

/**
 * SLA de atendimento (prazo operacional — não é CSAT): primeira resposta e resolução, para a
 * empresa e com exceções por equipe. A primeira resposta é medida POR RESPONSÁVEL: quem recebe uma
 * transferência tem o próprio prazo, contado a partir de quando recebeu.
 */
export function SlaSettings({ workspaceId }: { workspaceId: string }) {
  const { data: policies, mutate } = useSlaPolicies(workspaceId);
  const { data: teams } = useTeams(workspaceId);
  const { can, managedTeamIds } = useMyAccess();
  const canEditCompany = can("inbox:manage_service");
  const editableTeam = (teamId: string) => canEditCompany || (can("inbox:configure_kanban") && managedTeamIds.includes(teamId));
  const find = (scopeType: SlaPolicy["scopeType"], scopeId?: string) => policies?.find((policy) => policy.scopeType === scopeType && (policy.scopeId ?? undefined) === scopeId);

  return (
    <Card>
      <CardBody className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Gauge className="h-4 w-4 text-primary dark:text-primary-glow" /> SLA de atendimento</p>
        <p className="text-sm text-muted-foreground">Prazo em minutos para a primeira resposta (de cada responsável, contado de quando recebeu o atendimento) e para a resolução (da abertura à finalização). Em branco = sem prazo. A equipe sobrepõe a empresa.</p>
        <SlaRow label="Empresa (padrão)" policy={find("workspace")} disabled={!canEditCompany} onSave={(input) => saveSlaPolicy(workspaceId, { scopeType: "workspace", ...input })} onSaved={() => mutate()} />
        {(teams ?? []).map((team) => (
          <SlaRow key={team.id} label={`Equipe ${team.name}`} policy={find("team", team.id)} disabled={!editableTeam(team.id)} onSave={(input) => saveSlaPolicy(workspaceId, { scopeType: "team", scopeId: team.id, ...input })} onSaved={() => mutate()} />
        ))}
      </CardBody>
    </Card>
  );
}

function SlaRow({ label, policy, disabled, onSave, onSaved }: {
  label: string;
  policy?: SlaPolicy;
  disabled: boolean;
  onSave: (input: { firstResponseMinutes: number | null; resolutionMinutes: number | null }) => Promise<unknown>;
  onSaved: () => unknown;
}) {
  const [first, setFirst] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFirst(minutes(policy?.firstResponseSeconds)); setResolution(minutes(policy?.resolutionSeconds)); }, [policy]);
  const dirty = first !== minutes(policy?.firstResponseSeconds) || resolution !== minutes(policy?.resolutionSeconds);
  const parse = (value: string) => (value.trim() ? Math.max(1, Math.round(Number(value))) : null);
  async function save() {
    setBusy(true);
    try {
      await onSave({ firstResponseMinutes: parse(first), resolutionMinutes: parse(resolution) });
      await onSaved();
      toast.success("SLA salvo.");
    } catch (cause) {
      toast.error("Não foi possível salvar o SLA.", { description: cause instanceof Error ? cause.message : undefined });
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 px-3 py-2">
      <span className="min-w-40 flex-1 text-sm text-foreground">{label}</span>
      <label className="space-y-1 text-xs text-muted-foreground">1ª resposta (min)<Input type="number" min={1} className="h-8 w-28" value={first} disabled={disabled} onChange={(event) => setFirst(event.target.value)} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">Resolução (min)<Input type="number" min={1} className="h-8 w-28" value={resolution} disabled={disabled} onChange={(event) => setResolution(event.target.value)} /></label>
      <Button size="sm" variant="secondary" onClick={() => void save()} disabled={disabled || busy || !dirty} loading={busy}>Salvar</Button>
    </div>
  );
}
