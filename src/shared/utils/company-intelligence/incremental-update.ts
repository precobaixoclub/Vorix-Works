import { createHash } from "node:crypto";
import type { DiscoveredPage } from "../../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Aprendizado contínuo (seção 13): compara uma nova coleta com a anterior por hash de conteúdo
 * por página, para decidir o que precisa ser reprocessado — nunca reconstrói a base inteira à
 * toa. `contentHash` é gravado em cada `DiscoveredPage` (ver `company-intelligence.model.ts`) e
 * é o único sinal usado: sem timestamp/ETag, porque nem todo site expõe isso de forma confiável.
 */

export type PageChangeSet = {
  newPaths: string[];
  changedPaths: string[];
  unchangedPaths: string[];
  removedPaths: string[];
};

export function hashPageContent(html: string): string {
  return createHash("sha256").update(html).digest("hex").slice(0, 16);
}

export function diffDiscoveredPages(previous: DiscoveredPage[], next: DiscoveredPage[]): PageChangeSet {
  const previousByPath = new Map(previous.map((page) => [page.path, page]));
  const nextByPath = new Map(next.map((page) => [page.path, page]));

  const newPaths: string[] = [];
  const changedPaths: string[] = [];
  const unchangedPaths: string[] = [];

  for (const [path, page] of nextByPath) {
    const previousPage = previousByPath.get(path);
    if (!previousPage) {
      newPaths.push(path);
    } else if (previousPage.contentHash && page.contentHash && previousPage.contentHash !== page.contentHash) {
      changedPaths.push(path);
    } else if (!previousPage.contentHash || !page.contentHash) {
      changedPaths.push(path);
    } else {
      unchangedPaths.push(path);
    }
  }

  const removedPaths = previous.filter((page) => !nextByPath.has(page.path)).map((page) => page.path);

  return { newPaths, changedPaths, unchangedPaths, removedPaths };
}

export function pagesNeedingRecollection(changeSet: PageChangeSet): string[] {
  return [...changeSet.newPaths, ...changeSet.changedPaths];
}
