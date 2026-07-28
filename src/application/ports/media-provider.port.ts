/**
 * MEDIA INTELLIGENCE ENGINE — porta abstrata para bancos de mídia externos (Pexels/Pixabay/
 * Unsplash/outros). `PexelsMediaProvider` (`src/infrastructure/media-providers/`) é a primeira
 * implementação concreta desta porta — nada fora de `infrastructure/media-providers` conhece
 * Pexels por nome; `VisualAssetResolver`/`MediaCatalogPort` só conhecem esta porta genérica.
 * Nunca fazer scraping, nunca contornar autenticação, nunca inventar licença.
 */

export type MediaProviderOrientation = "landscape" | "portrait" | "square";

/**
 * Consulta estruturada (seção 3 da sprint REAL FOOTAGE ACQUISITION) — todo campo é opcional exceto
 * `text` (a consulta em si); os demais refinam ranqueamento/filtragem quando o provider suportar.
 */
export type MediaProviderSearchQuery = {
  text: string;
  type?: "photo" | "video";
  theme?: string;
  action?: string;
  people?: string[];
  emotion?: string;
  scenario?: string;
  framing?: string;
  orientation?: MediaProviderOrientation;
  minDurationSeconds?: number;
  shotId?: string;
  narrativeFunction?: string;
  creativeDnaKeywords?: string[];
  minWidth?: number;
  minHeight?: number;
  limit?: number;
  /**
   * INTENT-BASED FOOTAGE ACQUISITION — quando presentes, orientam a validação visual pós-download
   * e a rejeição automática em `acquireAssetFromHit` (só rejeita por tela/dispositivo quando o
   * Shot realmente precisa disso; nunca aplicado a Shots que não pedem dispositivo nenhum).
   */
  device?: "phone" | "tablet" | "notebook" | "desktop" | "none";
  screenVisibleRequired?: boolean;
};

export type MediaProviderLicense = { name: string; url?: string; allowsCommercialUse: boolean; requiresAttribution: boolean };

/** Todo download real de um provider externo precisa registrar exatamente estes campos — nunca inventados. */
export type MediaProviderDownloadRecord = {
  provider: string;
  externalId: string;
  author?: string;
  originPageUrl: string;
  license: MediaProviderLicense;
  downloadedAt: string;
  queryUsed: string;
  originalFileUrl: string;
  downloadedFilePath: string;
  campaign?: string;
  sceneOrder?: number;
  shotId?: string;
};

export type MediaProviderSearchHit = {
  /** Id do recurso NO PROVIDER (nunca gerado por nós) — usado por `getById` para re-buscar um link de download fresco. */
  externalId: string;
  previewUrl: string;
  downloadUrl: string;
  author?: string;
  originPageUrl: string;
  license: MediaProviderLicense;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export interface MediaProviderPort {
  readonly providerId: string;
  /** `false` quando não há credenciais/configuração — o caller deve pular este provider silenciosamente (ou explicar a configuração necessária), nunca falhar a busca inteira por isso. */
  isConfigured(): boolean;
  search(query: MediaProviderSearchQuery): Promise<MediaProviderSearchHit[]>;
  /** Rebusca um resultado específico pelo id externo, com um link de download fresco — usado por `--media-acquire <resultadoId>`. `undefined` quando o id não existe mais no provider. */
  getById(externalId: string): Promise<MediaProviderSearchHit | undefined>;
}
