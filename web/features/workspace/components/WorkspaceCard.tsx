import Link from "next/link";
import { Card, CardBody } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import type { Workspace } from "../types";

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  return (
    <Link href={`/workspaces/${workspace.id}`}>
      <Card className="h-full transition-shadow hover:shadow-sm">
        <CardBody className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent">
              {workspace.name.slice(0, 1).toUpperCase()}
            </div>
            <StatusBadge status={workspace.status} />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">{workspace.name}</p>
            {workspace.kind ? <p className="text-xs text-ink-muted">{workspace.kind}</p> : null}
          </div>
          <p className="mt-auto text-xs text-ink-faint">Criado em {formatDate(workspace.createdAt)}</p>
        </CardBody>
      </Card>
    </Link>
  );
}
