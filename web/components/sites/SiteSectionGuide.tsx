"use client";

import Link from "next/link";
import { CheckCircle2, CircleDashed, ExternalLink, Eye, Info, Package, Receipt } from "lucide-react";
import { Button } from "@/components/Button";
import { useMyAccess } from "@/features/auth/access";
import { groupOfSection, publicationSummary } from "@/features/sites/editor-groups";
import type { SiteSnapshot, TenantSite } from "@/features/sites/types";
import { useSolutions } from "@/features/solutions/hooks";
import { cn } from "@/lib/utils";

/**
 * Orientação curta no topo de cada grupo do editor (Fase 8). Não edita nada do site: só explica e
 * leva ao lugar certo — Vendas para produtos/pedidos, Configurações para a marca institucional, e o
 * resumo da publicação (prévia ≠ publicação).
 */
export function SiteSectionGuide({ section, workspaceId, site, draft, publicAddress, canPublish, onPreview, onPublish, onGoTo }: {
  section: string;
  workspaceId: string;
  site: TenantSite;
  draft: SiteSnapshot;
  publicAddress: string;
  canPublish: boolean;
  onPreview: () => void;
  onPublish: () => void;
  onGoTo: (section: string) => void;
}) {
  const group = groupOfSection(section);
  const { available } = useSolutions();
  const { can } = useMyAccess();
  const base = `/workspaces/${workspaceId}`;

  if (group === "MODELO") {
    return (
      <Note testId="site-guide-model">
        <strong>Visualizar</strong> não muda nada. <strong>Personalizar</strong> aplica o modelo só ao rascunho: seus textos e imagens continuam, e a aparência de cada modelo fica guardada. <strong>Usar este modelo</strong> publica o site com ele, sempre depois de pedir sua confirmação.
      </Note>
    );
  }

  if (group === "APARÊNCIA") {
    return (
      <Note testId="site-guide-appearance">
        Estas cores, fontes e logo valem só para o site.{" "}
        {available.includes("marketing") ? <>A identidade institucional usada pela IA de Marketing fica em <Link className="font-medium text-primary hover:underline dark:text-primary-glow" href={`${base}/settings/marca`}>Configurações › Marca e identidade</Link> e não é copiada automaticamente para cá.</> : "Nada aqui altera outras ferramentas da Vorix."}
      </Note>
    );
  }

  if (group === "VENDAS") {
    // Produtos e pedidos são o MESMO catálogo/registro de Vendas (Fase 7): aqui só se configura a loja.
    const productsHref = available.includes("conversations") ? `${base}/products` : `${base}/site/products`;
    return (
      <div className="mb-4 rounded-xl border border-border/70 bg-muted/30 p-3" data-testid="site-guide-sales">
        <p className="text-xs text-muted-foreground">Aqui você configura como o site vende. O cadastro de produtos e os pedidos ficam em Vendas — o mesmo catálogo usado nas propostas e nas conversas.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {can("product:read") ? <Button asChild size="sm" variant="secondary"><Link href={productsHref}><Package className="h-3.5 w-3.5" /> Produtos</Link></Button> : null}
          {can("order:read") || can("commerce:read") ? <Button asChild size="sm" variant="secondary"><Link href={`${base}/site/pedidos`}><Receipt className="h-3.5 w-3.5" /> Pedidos</Link></Button> : null}
        </div>
      </div>
    );
  }

  if (group === "PUBLICAÇÃO E DOMÍNIO") {
    const items = publicationSummary(site, draft, publicAddress);
    return (
      <section aria-label="Situação da publicação" className="mb-4 rounded-xl border border-border/70 p-3" data-testid="site-publication-summary">
        <p className="mb-2 text-sm font-semibold text-foreground">Situação da publicação</p>
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-xs" data-item={item.key} data-ok={item.ok ? "true" : "false"}>
              {item.ok ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <CircleDashed aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
              <span className="min-w-0">
                <span className="font-medium text-foreground">{item.label}: </span>
                <span className="break-words text-muted-foreground">{item.detail}</span>
                {!item.ok && item.section && item.section !== section ? <button type="button" className="ml-1 font-medium text-primary hover:underline dark:text-primary-glow" onClick={() => onGoTo(item.section!)}>Ajustar</button> : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">A prévia mostra o rascunho. Os visitantes só veem as alterações depois de publicar.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onPreview}><Eye className="h-3.5 w-3.5" /> Ver prévia</Button>
          {site.publishedAt ? <Button asChild size="sm" variant="ghost"><a href={`/s/${site.slug}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Abrir site publicado</a></Button> : null}
          <Button size="sm" disabled={!canPublish} title={canPublish ? undefined : "Somente o dono ou um administrador pode publicar."} onClick={onPublish}>Revisar e publicar</Button>
        </div>
      </section>
    );
  }

  return null;
}

function Note({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <p className={cn("mb-4 flex gap-2 rounded-xl border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground")} data-testid={testId}>
      <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
