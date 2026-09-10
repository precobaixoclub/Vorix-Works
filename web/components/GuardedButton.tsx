"use client";

import { Button, type ButtonProps } from "@/components/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type GuardedButtonProps = ButtonProps & {
  allowed: boolean;
  blockedReason: string;
};

export function GuardedButton({ allowed, blockedReason, disabled, children, ...props }: GuardedButtonProps) {
  const button = (
    <Button disabled={disabled || !allowed} {...props}>
      {children}
    </Button>
  );

  if (allowed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex min-w-0">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{blockedReason}</TooltipContent>
    </Tooltip>
  );
}
