/**
 * Encontra links em texto livre (mensagens, notas, descrições, campos) para torná-los clicáveis.
 * Só gera endereços seguros: http(s), "www." (vira https) e e-mail (mailto). Nada de
 * `javascript:`/`data:` — o texto vem de clientes e de integrações.
 */
export type TextPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

// URL com esquema, "www." ou e-mail. A pontuação final ("." "," ")" etc.) é tratada abaixo.
const PATTERN = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[^\s<>"']+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
const TRAILING = /[.,;:!?'"”’»]+$/;

function trimTrailing(raw: string): string {
  let value = raw.replace(TRAILING, "");
  // Parêntese/colchete de fechamento sobrando (ex.: "(veja https://x.com)") não faz parte do link.
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1).replace(TRAILING, "");
  }
  return value;
}

export function hrefFor(text: string): string | undefined {
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^www\./i.test(text)) return hrefFor(`https://${text}`);
  if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(text)) return `mailto:${text}`;
  return undefined;
}

export function splitLinks(input: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of input.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    const text = trimTrailing(match[0]);
    const href = text ? hrefFor(text) : undefined;
    if (!href) continue;
    if (start > last) parts.push({ kind: "text", text: input.slice(last, start) });
    parts.push({ kind: "link", text, href });
    last = start + text.length;
  }
  if (last < input.length) parts.push({ kind: "text", text: input.slice(last) });
  return parts;
}

export function hasLink(input: string | null | undefined): boolean {
  return !!input && splitLinks(input).some((part) => part.kind === "link");
}
