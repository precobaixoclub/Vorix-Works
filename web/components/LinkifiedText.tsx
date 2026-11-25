import { Fragment } from "react";
import { ExternalLink } from "lucide-react";
import { splitLinks } from "@/lib/linkify";
import { cn } from "@/lib/utils";

/**
 * Texto livre com links clicáveis (http/https, www. e e-mail). Abre em nova aba, sem repassar a
 * página de origem. O clique no link não aciona o clique do elemento em volta (bolha, cartão).
 */
export function LinkifiedText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  return (
    <>
      {splitLinks(text).map((part, index) => part.kind === "text" ? (
        <Fragment key={index}>{part.text}</Fragment>
      ) : (
        <a
          key={index}
          href={part.href}
          target={part.href.startsWith("mailto:") ? undefined : "_blank"}
          rel="noopener noreferrer nofollow"
          onClick={(event) => event.stopPropagation()}
          className={cn("break-all underline underline-offset-2 hover:opacity-80", className)}
        >
          {part.text}
        </a>
      ))}
    </>
  );
}

/**
 * Para campos em edição (input/textarea), onde o texto não pode ter link: lista, logo abaixo do
 * campo, os links encontrados no valor — clicáveis.
 */
export function LinksPreview({ text, className }: { text: string | null | undefined; className?: string }) {
  const seen = new Set<string>();
  const links = splitLinks(text ?? "").flatMap((part) => part.kind === "link" && !seen.has(part.href) && seen.add(part.href) ? [part] : []).slice(0, 5);
  if (!links.length) return null;
  return (
    <p className={cn("mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs", className)}>
      {links.map((link) => (
        <a key={link.href} href={link.href} target={link.href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 text-primary underline underline-offset-2 hover:opacity-80 dark:text-primary-glow">
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{link.text}</span>
        </a>
      ))}
    </p>
  );
}
