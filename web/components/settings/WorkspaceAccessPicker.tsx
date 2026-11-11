"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type WorkspaceOption = { id: string; name: string; status?: string };

/**
 * Quais espaços de trabalho uma pessoa acessa. `null` = todos (inclusive os criados depois).
 * `allowAll=false` quando quem edita só acessa alguns espaços: ele só distribui os próprios.
 * `lockedAll` para o Administrador principal, que sempre acessa todos.
 */
export function WorkspaceAccessPicker({ value, onChange, workspaces, disabled, allowAll = true, lockedAll }: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  workspaces: readonly WorkspaceOption[];
  disabled?: boolean;
  allowAll?: boolean;
  lockedAll?: boolean;
}) {
  if (lockedAll) return <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Administrador principal: sempre acessa todos os espaços de trabalho.</p>;
  const all = value === null;
  const options = workspaces.filter((workspace) => workspace.status !== "archived");
  const toggle = (id: string, checked: boolean) => {
    const current = value ?? [];
    onChange(checked ? [...current, id] : current.filter((item) => item !== id));
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Espaços de trabalho">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <button type="button" role="radio" aria-checked={all} disabled={disabled || !allowAll}
                onClick={() => onChange(null)}
                className={cn("w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60", all ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                <span className="block text-sm font-medium text-foreground">Todos os espaços</span>
                <span className="block text-xs text-muted-foreground">Inclui os espaços criados depois.</span>
              </button>
            </span>
          </TooltipTrigger>
          {!allowAll ? <TooltipContent>Você só acessa alguns espaços, então só pode liberar esses.</TooltipContent> : null}
        </Tooltip>
        <button type="button" role="radio" aria-checked={!all} disabled={disabled}
          onClick={() => { if (all) onChange(options.length === 1 ? [options[0].id] : []); }}
          className={cn("rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60", !all ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
          <span className="block text-sm font-medium text-foreground">Só os espaços escolhidos</span>
          <span className="block text-xs text-muted-foreground">A pessoa não vê os outros espaços.</span>
        </button>
      </div>
      {!all ? (
        <div className="rounded-lg border border-border/60 p-2">
          {options.length === 0 ? <p className="px-1 py-1 text-sm text-muted-foreground">Nenhum espaço de trabalho disponível.</p> : null}
          <ul className="space-y-0.5">
            {options.map((workspace) => (
              <li key={workspace.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted">
                  <Checkbox checked={value?.includes(workspace.id) ?? false} disabled={disabled} onCheckedChange={(checked) => toggle(workspace.id, checked === true)} />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  {workspace.status === "inactive" ? <span className="text-xs text-muted-foreground">Inativo</span> : null}
                </label>
              </li>
            ))}
          </ul>
          {value?.length === 0 ? <p className="px-2 pt-1 text-xs text-warning">Escolha ao menos um espaço.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
