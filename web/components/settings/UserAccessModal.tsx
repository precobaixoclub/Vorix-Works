"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { Switch } from "@/components/ui/switch";
import { addTeamMember, removeTeamMember, updateMemberAccess, updateTeamMember } from "@/features/identity/api";
import { useAccessCatalog, useMemberAccess, useTeams } from "@/features/identity/hooks";
import type { MemberAccess, TenantRole } from "@/features/identity/types";
import { cn } from "@/lib/utils";

/** Os três perfis principais; Visualizador continua existindo só para quem já o tem. */
const MAIN_PROFILES: { role: TenantRole; label: string; hint: string }[] = [
  { role: "owner", label: "Administrador", hint: "Acesso global: todas as equipes, usuários e configurações." },
  { role: "admin", label: "Gerente", hint: "Gestor das equipes que gerencia: vê e opera os dados delas e configura os kanbans delas." },
  { role: "editor", label: "Atendente", hint: "Vê os próprios atendimentos, oportunidades, meta e indicadores." },
];

type TeamChoice = "none" | "member" | "manager";
const message = (cause: unknown) => (cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : "Não foi possível salvar.");

/**
 * Editar o acesso de um usuário em três partes simples: Perfil (padrão inicial), Equipes (de quais
 * participa e quais gerencia) e Permissões (agrupadas, mostrando o que veio do perfil e o que foi
 * personalizado). Salvar manda o estado inteiro; o backend aplica as proteções e audita.
 */
export function UserAccessModal({ userId, name, workspaceId, isSelf, actorIsOwner, onClose, onSaved }: {
  userId: string;
  name: string;
  workspaceId: string;
  isSelf: boolean;
  actorIsOwner: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { data: access, isLoading, mutate } = useMemberAccess(userId);
  const { data: catalog } = useAccessCatalog();
  const { data: teams } = useTeams(workspaceId);
  const [role, setRole] = useState<TenantRole>("editor");
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [teamChoices, setTeamChoices] = useState<Record<string, TeamChoice>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!access) return;
    setRole(access.role);
    setEnabled(new Set(access.effectivePermissions));
    setTeamChoices(Object.fromEntries(access.teams.map((team) => [team.teamId, team.isManager ? "manager" : "member"])));
  }, [access]);

  const preset = useMemo(() => new Set(catalog?.profiles.find((profile) => profile.role === role)?.permissions ?? []), [catalog, role]);
  const readOnly = isSelf || (access?.role === "owner" && !actorIsOwner);
  const ownerLocked = access?.isAccountOwner === true;

  function chooseProfile(next: TenantRole) {
    setRole(next);
    // Trocar de perfil recarrega o padrão daquele perfil (as exceções anteriores somem).
    setEnabled(new Set(catalog?.profiles.find((profile) => profile.role === next)?.permissions ?? []));
  }

  function originOf(permission: string): "profile" | "granted" | "revoked" | "none" {
    const on = enabled.has(permission);
    if (preset.has(permission)) return on ? "profile" : "revoked";
    return on ? "granted" : "none";
  }

  async function save() {
    if (!access || readOnly) return;
    setSaving(true);
    try {
      const all = new Set([...preset, ...enabled]);
      const permissionGrants = [...all].filter((permission) => enabled.has(permission) && !preset.has(permission));
      const permissionRevokes = [...all].filter((permission) => !enabled.has(permission) && preset.has(permission));
      await updateMemberAccess(userId, { role, permissionGrants, permissionRevokes });
      await syncTeams(access);
      await mutate();
      await onSaved();
      toast.success("Acesso atualizado.");
      onClose();
    } catch (cause) {
      toast.error("Não foi possível salvar o acesso.", { description: message(cause) });
    } finally {
      setSaving(false);
    }
  }

  async function syncTeams(current: MemberAccess) {
    const before: Record<string, TeamChoice> = Object.fromEntries(current.teams.map((team) => [team.teamId, team.isManager ? "manager" : "member"]));
    for (const team of teams ?? []) {
      const was: TeamChoice = before[team.id] ?? "none";
      const next: TeamChoice = teamChoices[team.id] ?? "none";
      if (was === next) continue;
      const teamRole: TenantRole = next === "manager" ? "admin" : "editor";
      if (was === "none") await addTeamMember(team.id, workspaceId, userId, teamRole);
      else if (next === "none") await removeTeamMember(team.id, workspaceId, userId);
      else await updateTeamMember(team.id, workspaceId, userId, { role: teamRole });
    }
  }

  const customized = access ? [...new Set([...preset, ...enabled])].filter((permission) => originOf(permission) === "granted" || originOf(permission) === "revoked").length : 0;

  return (
    <Modal title={`Acesso de ${name}`} onClose={() => { if (!saving) onClose(); }}>
      {isLoading || !access || !catalog ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {isSelf ? <Notice>Você não pode alterar o próprio acesso. Peça a outro administrador.</Notice> : null}
          {ownerLocked ? <Notice><ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Administrador principal da conta: continua sempre Administrador e com a gestão de usuários e acessos.</Notice> : null}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">1. Perfil</h3>
            <p className="text-xs text-muted-foreground">O perfil carrega as permissões padrão. Depois você pode personalizar abaixo.</p>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Perfil">
              {[...MAIN_PROFILES, ...(access.role === "viewer" ? [{ role: "viewer" as TenantRole, label: "Visualizador", hint: "Perfil antigo: só leitura." }] : [])].map((profile) => (
                <button key={profile.role} type="button" role="radio" aria-checked={role === profile.role} disabled={readOnly || ownerLocked || (profile.role === "owner" && !actorIsOwner)}
                  onClick={() => chooseProfile(profile.role)}
                  className={cn("rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60", role === profile.role ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                  <span className="block text-sm font-medium text-foreground">{profile.label}</span>
                  <span className="block text-xs text-muted-foreground">{profile.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">2. Equipes</h3>
            <p className="text-xs text-muted-foreground">Participar define o que é "dados da equipe" para a pessoa. Gerenciar permite configurar o kanban e acompanhar a equipe.</p>
            {(teams ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma equipe cadastrada neste workspace.</p> : null}
            <ul className="space-y-1.5">
              {(teams ?? []).map((team) => (
                <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
                  <span className="text-sm text-foreground">{team.name}</span>
                  <select aria-label={`Vínculo com ${team.name}`} disabled={readOnly} value={teamChoices[team.id] ?? "none"}
                    onChange={(event) => setTeamChoices((current) => ({ ...current, [team.id]: event.target.value as TeamChoice }))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:bg-muted/50">
                    <option value="none">Não participa</option>
                    <option value="member">Membro</option>
                    <option value="manager">Gerente da equipe</option>
                  </select>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">3. Permissões</h3>
              {customized ? <span className="text-xs text-primary dark:text-primary-glow">{customized} personalizada(s)</span> : <span className="text-xs text-muted-foreground">Padrão do perfil</span>}
            </div>
            {catalog.categories.map((category) => (
              <div key={category.key} className="rounded-lg border border-border/60 p-3">
                <p className="text-sm font-medium text-foreground">{category.label}</p>
                <p className="mb-2 text-xs text-muted-foreground">{category.description}</p>
                <ul className="space-y-1.5">
                  {category.permissions.map((item) => {
                    const origin = originOf(item.permission);
                    return (
                      <li key={item.permission} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">
                            {item.label}
                            {item.sensitive ? <span className="ml-1.5 rounded bg-warning/15 px-1 text-[10px] font-medium uppercase text-warning">sensível</span> : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {origin === "profile" ? "Do perfil" : origin === "granted" ? "Adicionada para esta pessoa" : origin === "revoked" ? "Removida para esta pessoa" : "Não incluída no perfil"}
                            {item.description ? ` · ${item.description}` : ""}
                          </p>
                        </div>
                        <Switch checked={enabled.has(item.permission)} disabled={readOnly} aria-label={item.label}
                          onCheckedChange={(checked) => setEnabled((current) => { const next = new Set(current); if (checked) next.add(item.permission); else next.delete(item.permission); return next; })} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 py-3">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void save()} loading={saving} disabled={saving || readOnly}>Salvar acesso</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}
