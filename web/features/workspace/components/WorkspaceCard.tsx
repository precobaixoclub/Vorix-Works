import Link from "next/link";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import type { Workspace } from "../types";

export function WorkspaceCard({ workspace, onEdit }: { workspace: Workspace; onEdit?: () => void }) {
  return (
    <Card className="h-full transition-shadow hover:shadow-sm">
      <CardBody className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/workspaces/${workspace.id}`} className="min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
              {workspace.name.slice(0, 1).toUpperCase()}
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
        <Link href={`/workspaces/${workspace.id}`} className="flex min-w-0 flex-1 flex-col">
          <div>
            <p className="break-words text-sm font-semibold text-ink">{workspace.name}</p>
            {workspace.kind ? <p className="text-xs text-ink-muted">{workspace.kind}</p> : null}
          </div>
          <p className="mt-auto text-xs text-ink-faint">Criado em {formatDate(workspace.createdAt)}</p>
        </Link>
      </CardBody>
    </Card>
  );
}
