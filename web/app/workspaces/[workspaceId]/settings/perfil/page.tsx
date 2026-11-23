"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMyAccess } from "@/features/auth/access";
import { ROLE_LABEL, ROLE_SUMMARY, TOOL_LABEL } from "@/features/settings/people";
import { useSolutions } from "@/features/solutions/hooks";

/**
 * Minha conta (Fase 10): o que é da PESSOA, não da empresa — dados de acesso, papel nesta conta,
 * ferramentas liberadas e a aparência. Só mostra o que a Vorix já guarda; alterar nome e e-mail
 * continua sendo feito por quem administra os usuários (não há API de autoedição).
 */
export default function MyProfilePage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const { can } = useMyAccess();
  const { available } = useSolutions();
  const user = state.status === "authenticated" ? state.user : undefined;
  const role = state.status === "authenticated" ? state.role : undefined;
  const canManageMembers = can("tenant_member:manage");
  const base = `/workspaces/${workspace.id}`;

  return (
    <SettingsShell active="profile" title="Meu perfil" description="Seus dados de acesso e preferências pessoais. Valem para você em todos os espaços de trabalho.">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card data-testid="profile-identity">
          <CardHeader><p className="text-sm font-semibold text-foreground">Dados de acesso</p></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Nome" value={user?.name ?? "—"} />
            <Row label="E-mail de acesso" value={user?.email ?? "—"} />
            <Row label="Papel nesta conta" value={role ? ROLE_LABEL[role] : "—"} />
            {role ? <p className="text-xs text-muted-foreground">{ROLE_SUMMARY[role]}</p> : null}
            <p className="pt-2 text-xs text-muted-foreground">
              {canManageMembers
                ? <>Para alterar nome, e-mail ou foto, use <Link className="font-medium text-primary hover:underline dark:text-primary-glow" href={`${base}/settings/users`}>Usuários e permissões</Link>.</>
                : "Para alterar nome, e-mail ou foto, peça a quem administra os usuários da conta."}
            </p>
          </CardBody>
        </Card>

        <Card data-testid="profile-tools">
          <CardHeader><p className="text-sm font-semibold text-foreground">Ferramentas deste espaço</p></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p className="text-muted-foreground">No espaço <span className="font-medium text-foreground">{workspace.name}</span> você usa:</p>
            <ul className="flex flex-wrap gap-2">
              {available.map((key) => <li key={key} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">{TOOL_LABEL[key]}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">O que cada pessoa pode fazer em cada ferramenta segue o papel e as permissões definidos em Usuários e permissões.</p>
          </CardBody>
        </Card>

        <Card data-testid="profile-appearance">
          <CardHeader><p className="text-sm font-semibold text-foreground">Aparência</p></CardHeader>
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Tema claro ou escuro (fica salvo neste navegador).</span>
            <ThemeToggle />
          </CardBody>
        </Card>

        <Card data-testid="profile-security">
          <CardHeader><p className="text-sm font-semibold text-foreground">Senha e notificações</p></CardHeader>
          <CardBody className="space-y-2 text-sm text-muted-foreground">
            <p>A troca de senha pela própria tela ainda não está disponível. Se precisar, peça a quem administra a conta.</p>
            <p>As notificações aparecem no sino do topo da tela; ainda não há preferências por tipo de aviso.</p>
          </CardBody>
        </Card>
      </div>
    </SettingsShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/35 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all font-medium text-foreground">{value}</span>
    </div>
  );
}
