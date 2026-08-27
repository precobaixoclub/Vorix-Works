import Link from "next/link";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import type { Workspace } from "../types";

export function WorkspaceCard({ workspace, onEdit }: { workspace: Workspace; onEdit?: () => void }) {
  const logoUrl = workspace.settings.logoUrl?.trim();
  const initial = workspace.name.slice(0, 1).toUpperCase();

  return (
    <Card className="h-full overflow-hidden transition-colors hover:border-primary/60">
      <CardBody className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/workspaces/${workspace.id}`} className="min-w-0" aria-label={`Abrir ${workspace.name}`}>
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-sunken">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-full w-full object-contain p-1.5" />
              ) : (
                <span className="text-xl font-semibold text-primary">{initial}</span>
              )}
            </div>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={workspace.status} />
            {onEdit ? (
              <Button type="button" variant="ghost" className="min-h-8 px-2 py-1 text-xs" onClick={onEdit}>
                Editar
              </Button>
            ) : null}
          </div>
        </div>
        <Link href={`/workspaces/${workspace.id}`} className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <p className="break-words text-base font-semibold text-ink">{workspace.name}</p>
            {workspace.kind ? <p className="text-xs text-ink-muted">{workspace.kind}</p> : null}
          </div>
          <p className="mt-auto text-xs text-ink-faint">Criado em {formatDate(workspace.createdAt)}</p>
          <span className="mt-1 inline-flex min-h-9 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            Acessar espaço
          </span>
        </Link>
      </CardBody>
    </Card>
  );
}
