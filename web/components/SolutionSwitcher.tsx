"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SOLUTION_HOME_PATH, SOLUTION_SHORT_NAME, type SolutionKey, type SolutionSummary } from "@/lib/solutions";
import { cn } from "@/lib/utils";

/**
 * Seletor de soluções do Vorix — o cabeçalho da sidebar. Mostra a solução ativa ("Vorix
 * Conversas") e, quando a conta tem mais de uma, permite trocar.
 *
 * Só lista soluções a que a conta TEM acesso (`GET /v1/solutions`): hoje, para um cliente comum,
 * isso é só o Conversas — então o seletor vira um rótulo fixo, sem menu, sem "em breve". Uma
 * solução nova aparece aqui sozinha no dia em que a conta passar a tê-la.
 */
export function SolutionSwitcher({ workspaceBase, active, solutions, collapsed }: { workspaceBase: string; active: SolutionKey; solutions: readonly SolutionSummary[]; collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const canSwitch = solutions.length > 1;

  const label = (
    <>
      <Logo className="h-8 w-auto shrink-0" />
      {!collapsed ? (
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Vorix</p>
          <p className="truncate text-sm font-semibold text-foreground" data-testid="active-solution-name">{SOLUTION_SHORT_NAME[active]}</p>
        </div>
      ) : null}
    </>
  );

  const className = cn("mb-3 flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 text-foreground", collapsed ? "justify-center px-0" : "px-2");

  if (!canSwitch) {
    return (
      <div className={className} aria-label={`Vorix ${SOLUTION_SHORT_NAME[active]}`} data-testid="solution-switcher">
        {label}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(className, "transition-colors hover:bg-muted/70")} aria-label={`Solução ativa: Vorix ${SOLUTION_SHORT_NAME[active]}. Trocar de solução`} data-testid="solution-switcher">
          {label}
          {!collapsed ? <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5">
        <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Soluções</p>
        {solutions.map((solution) => (
          <button
            key={solution.key}
            type="button"
            onClick={() => {
              setOpen(false);
              router.push(`${workspaceBase}${SOLUTION_HOME_PATH[solution.key]}`);
            }}
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-sm transition-colors hover:bg-muted/70",
              solution.key === active ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
            data-testid={`solution-option-${solution.key}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{SOLUTION_SHORT_NAME[solution.key]}</span>
              {solution.internal ? <span className="rounded border border-border px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Interno</span> : null}
            </span>
            {solution.key === active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
