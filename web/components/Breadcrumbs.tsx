"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

/**
 * Breadcrumb do painel — é por existir esta camada que NENHUMA tela de workspace tem botão
 * "Voltar". Exceções: rotas públicas (login/signup/pricing) e telas full-screen fora do shell.
 * Adaptado do pacote original (`assets/shell/Breadcrumbs.tsx`, `Link`/`useLocation` do
 * react-router) pro roteamento por arquivo do Next.js (`next/link`/`usePathname`).
 */

export type RouteLabelMap = Record<string, string>;

type Crumb = { label: string; href?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function buildCrumbs(pathname: string, homeHref: string, routeLabels: RouteLabelMap): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let currentPath = "";

  parts.forEach((part, i) => {
    currentPath += `/${part}`;
    if (UUID_RE.test(part) || (homeHref !== "/" && homeHref.startsWith(currentPath))) return;

    const label = routeLabels[currentPath] ?? part.charAt(0).toUpperCase() + part.slice(1);
    const isLast = i === parts.length - 1;
    crumbs.push({ label, href: isLast ? undefined : currentPath });
  });

  return crumbs;
}

export function Breadcrumbs({ routeLabels = {}, homeHref }: { routeLabels?: RouteLabelMap; homeHref: string }) {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname, homeHref, routeLabels);

  if (crumbs.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
      <Link href={homeHref} className="transition-colors hover:text-foreground" aria-label="Início">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, index) => (
        <Fragment key={`${crumb.label}-${index}`}>
          <ChevronRight className="h-3 w-3 shrink-0" />
          {crumb.href ? (
            <Link href={crumb.href} className="max-w-32 truncate transition-colors hover:text-foreground">
              {crumb.label}
            </Link>
          ) : (
            <span className="max-w-48 truncate font-medium text-foreground">{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
