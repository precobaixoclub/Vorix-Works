import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`min-w-0 rounded-xl border border-border bg-surface-raised ${className}`} {...props} />;
}

export function CardHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5 sm:py-4 ${className}`} {...props} />;
}

export function CardBody({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-3 py-3 sm:px-5 sm:py-4 ${className}`} {...props} />;
}
