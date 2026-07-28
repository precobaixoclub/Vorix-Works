/**
 * Asset Library — Sprint 02 (Fase 4), fundação de domínio. O objetivo explícito desta sprint NÃO
 * é upload: nenhum campo aqui aponta para um arquivo real ainda (`storageRef` existe só como
 * formato preparado, nunca preenchido) — isso depende de um adapter de storage real
 * (`ArtifactHostingPort` já existe mas só tem `LocalFakeArtifactHosting` por trás; um provider de
 * verdade é escopo de sprint futura). O que existe aqui é só a ORGANIZAÇÃO: que tipos de ativo um
 * Workspace pode ter e como eles se agrupam.
 *
 * Deliberadamente um domínio NOVO e separado do Media Catalog (`media-catalog.port.ts`) e da
 * Campaign Workspace (`campaign-workspace-repository.port.ts`) já existentes — aqueles continuam
 * intocados (cobrem mídia de campanha/vídeo já resolvida pelo motor de conteúdo); este cobre a
 * biblioteca de marca do Workspace (logo, brand book, fontes, mockups, referências), um escopo
 * mais amplo que "mídia de campanha". Reconciliar os três é uma decisão explicitamente adiada —
 * ver "Decisões tomadas" no relatório da Sprint 02.
 */

export const ASSET_KINDS = [
  "logo",
  "photo",
  "video",
  "product",
  "mockup",
  "visual_identity",
  "font",
  "brand_book",
  "reference",
  "document",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ["active", "archived"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Uma Asset Library por Workspace (1:1) — o contêiner; os ativos em si são `AssetRecord`. */
export type AssetLibrary = {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * `storageRef` é opcional e nunca preenchido nesta sprint — nenhum adapter de storage real existe
 * ainda por trás. O registro de metadados (o quê, que tipo, quando) já é útil por si só para
 * organizar a biblioteca antes mesmo de qualquer upload funcionar.
 */
export type AssetStorageRef = {
  provider: string;
  uri: string;
};

export type AssetRecord = {
  id: string;
  libraryId: string;
  kind: AssetKind;
  name: string;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  tags: string[];
  storageRef?: AssetStorageRef;
};
