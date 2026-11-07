/** Endereço do site (/s/<slug>) e registros DNS do domínio próprio. Funções puras, testadas. */

export const RESERVED_SITE_SLUGS = ["api", "app", "www", "admin", "mail", "static"];

/** Transforma o que a pessoa digitou num endereço válido: "Loja da Ana!" → "loja-da-ana". */
export function toSiteSlug(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
}

export function siteSlugProblem(slug: string): string | undefined {
  if (slug.length < 3) return "Use pelo menos 3 letras ou números.";
  if (slug.length > 80) return "Use no máximo 80 caracteres.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Use só letras sem acento, números e hífen.";
  if (RESERVED_SITE_SLUGS.includes(slug)) return "Esse endereço é reservado. Escolha outro.";
  return undefined;
}

/** "https://www.Loja.com.br/produtos" → "www.loja.com.br". */
export function cleanHostname(input: string): string {
  return input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
}

// Sufixos de dois níveis mais comuns no Brasil e fora (o domínio registrado fica um nível acima).
const TWO_LEVEL_SUFFIXES = new Set(["com.br", "net.br", "org.br", "art.br", "blog.br", "eco.br", "edu.br", "gov.br", "ind.br", "inf.br", "app.br", "dev.br", "log.br", "med.br", "adv.br", "eng.br", "tur.br", "wiki.br", "co.uk", "org.uk", "com.ar", "com.mx", "com.pt", "com.co", "com.au"]);

export type DomainRecords = {
  /** Domínio registrado (onde ficam as configurações de DNS), ex.: loja.com.br. */
  zone: string;
  /** Endereço digitado é o próprio domínio registrado (sem www). */
  apex: boolean;
  /** Nome do TXT como os painéis pedem (relativo ao domínio) e completo. */
  txtName: string; txtFullName: string;
  /** Nome do registro que aponta o site: "@" no domínio raiz, "www" etc. no subdomínio. */
  pointName: string;
};

export function domainRecords(hostname: string): DomainRecords {
  const host = cleanHostname(hostname);
  const labels = host.split(".");
  const size = labels.length >= 3 && TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  const zone = labels.slice(-size).join(".");
  const sub = labels.slice(0, -size).join(".");
  return { zone, apex: !sub, txtName: sub ? `_vorix-site.${sub}` : "_vorix-site", txtFullName: `_vorix-site.${host}`, pointName: sub || "@" };
}

/** Destino é um IPv4 (registro A) ou um nome (CNAME). */
export function pointRecordType(target: string): "A" | "CNAME" {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(target) ? "A" : "CNAME";
}
