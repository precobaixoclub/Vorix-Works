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

/**
 * Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — classificação
 * SEMÂNTICA de um material, deliberadamente separada de `AssetKind` (que continua existindo e
 * sendo usado para a categoria bruta de mídia/validação de upload, ex.: `findLogoAssetUrl` em
 * `container.ts` já filtra por `kind: "logo"`). `materialType` é aditivo e opcional — nenhum
 * asset existente é forçado a ter um, e nenhum código legado que só olha `kind` precisa mudar.
 * É este campo (não `kind`) que o motor GPT usa para entender o PAPEL real de cada material
 * (logo principal vs. secundária, screenshot do site vs. do app, etc.) — granularidade que
 * `AssetKind` nunca teve.
 */
export const ASSET_MATERIAL_TYPES = [
  "logo_principal",
  "logo_secundaria",
  "screenshot_site",
  "screenshot_app",
  "produto",
  "foto_institucional",
  "referencia_visual",
  "selo",
  "icone",
  "fundo",
  "campanha",
  "outro",
] as const;
export type AssetMaterialType = (typeof ASSET_MATERIAL_TYPES)[number];

/**
 * Prioridade de uso — como o motor GPT deve tratar este material ao montar `brandMaterials` do
 * `creative_context` (ver `select-brand-materials.ts`). `required` nunca é omitido pela seleção
 * automática, mesmo que pareça irrelevante ao pedido atual (ex.: logo obrigatória); `on_request`
 * nunca é incluído automaticamente, só quando o pedido atual referencia o material explicitamente.
 */
export const ASSET_USAGE_PRIORITIES = ["required", "preferred", "automatic", "on_request"] as const;
export type AssetUsagePriority = (typeof ASSET_USAGE_PRIORITIES)[number];

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
 *
 * CORREÇÃO OBRIGATÓRIA (Sprint 03, #4): `storageRef` NUNCA pode conter segredo — nada de API
 * keys, access/refresh tokens, credenciais ou URLs assinadas temporárias (elas expiram e vazam
 * em backups/logs). Só referência DURÁVEL: provedor, bucket/container, caminho do objeto e
 * metadados técnicos não sensíveis. Resolver a URL de acesso de verdade (assinada, com TTL) é
 * responsabilidade do adapter de storage real no momento do uso, nunca um dado persistido aqui.
 */
export type AssetStorageRef = {
  provider: string;
  bucket?: string;
  objectKey: string;
  metadata?: Record<string, string>;
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
  /** Classificação semântica rica (ver `AssetMaterialType`) — aditiva, nunca obrigatória. */
  materialType?: AssetMaterialType;
  /** "Observação para IA" — explica COMO/QUANDO o motor GPT deve usar este material. Ex.: "Use
   * este screenshot real dentro de notebook ou smartphone quando o objetivo for demonstrar o
   * funcionamento do site." Texto livre, nunca interpretado como regra rígida (isso é
   * `usageRule`). */
  aiInstructions?: string;
  /** Regra de uso — restrição/instrução mais categórica que `aiInstructions`. Ex.: "nunca
   * redesenhar, não alterar proporção e não mudar cores." Também texto livre (nenhuma tentativa
   * de parsear regras estruturadas nesta versão), mas semanticamente distinto: `aiInstructions`
   * orienta QUANDO usar, `usageRule` restringe COMO usar. */
  usageRule?: string;
  /** Prioridade de uso na seleção automática (ver `AssetUsagePriority`). Ausente = tratado como
   * "automatic" pela seleção (nunca "required"/"on_request" por omissão — nunca inventa uma
   * obrigatoriedade que o usuário não marcou explicitamente). */
  usagePriority?: AssetUsagePriority;
};
