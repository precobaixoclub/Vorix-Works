/**
 * PRODUCT COMPOSITING ENGINE — catálogo específico para telas reais do produto (screenshots,
 * gravações de tela, mockups aprovados, UI exportada). Separado do catálogo de mídia geral
 * (`media-catalog.port.ts`) porque uma "tela de produto" tem campos próprios (funcionalidade,
 * dispositivo-alvo, versão do produto) que não fazem sentido para filmagem/foto solta. Nenhuma
 * Skill importa este arquivo diretamente — só via `ProductCompositingPort`/CLI.
 */

import type { MediaAssetLicense } from "./media-catalog.port.js";

export const PRODUCT_SCREEN_SOURCE_TYPES = ["screenshot", "screen_recording", "mockup", "exported_ui"] as const;
export type ProductScreenSourceType = (typeof PRODUCT_SCREEN_SOURCE_TYPES)[number];

export const PRODUCT_SCREEN_DEVICE_TARGETS = ["phone", "tablet", "notebook", "desktop"] as const;
export type ProductScreenDeviceTarget = (typeof PRODUCT_SCREEN_DEVICE_TARGETS)[number];

export const PRODUCT_SCREEN_APPROVAL_STATUSES = ["needs_review", "approved", "rejected"] as const;
export type ProductScreenApprovalStatus = (typeof PRODUCT_SCREEN_APPROVAL_STATUSES)[number];

/** Retângulo (em pixels, no espaço da própria imagem/vídeo de origem) contendo só o conteúdo real de interface — nunca inclui moldura de dispositivo nem texto de marketing ao redor, quando a fonte for um mockup de campanha. */
export type ProductScreenContentCropRect = { x: number; y: number; width: number; height: number };

export type ProductScreenRecord = {
  screenId: string;
  clientId: string;
  product: string;
  functionality: string;
  sourcePath: string;
  sourceType: ProductScreenSourceType;
  deviceTarget: ProductScreenDeviceTarget;
  orientation: "portrait" | "landscape";
  resolution: { width: number; height: number };
  aspectRatio: string;
  capturedAt?: string;
  /** Nunca "production"/"live_site" quando não existe ambiente real publicado — este projeto é uma simulação, então a maioria das fontes é `local_project_asset` (mockup aprovado gerado localmente). Nunca inventar um ambiente que não existe. */
  sourceEnvironment: "live_site" | "staging" | "local_project_asset";
  approvalStatus: ProductScreenApprovalStatus;
  tags: string[];
  hash: string;
  version: string;
  license?: MediaAssetLicense;
  contentCropRect?: ProductScreenContentCropRect;
  notes?: string[];
  indexedAt: string;
};

export type ProductScreenScanResult = {
  scanned: number;
  added: number;
  updated: number;
  unavailable: number;
  warnings: string[];
};

export type ProductScreenSelectionQuery = {
  deviceTarget?: ProductScreenDeviceTarget;
  functionality?: string;
  narrativeIntent?: string;
  requireApproved?: boolean;
};

export type ProductScreenCatalogPort = {
  scan(): Promise<ProductScreenScanResult>;
  list(filter?: { approvalStatus?: ProductScreenApprovalStatus; deviceTarget?: ProductScreenDeviceTarget }): Promise<ProductScreenRecord[]>;
  get(screenId: string): Promise<ProductScreenRecord | undefined>;
  select(query: ProductScreenSelectionQuery): Promise<ProductScreenRecord[]>;
  approve(screenId: string): Promise<ProductScreenRecord>;
  reject(screenId: string, reason?: string): Promise<ProductScreenRecord>;
  upsert(record: ProductScreenRecord): Promise<void>;
};

/**
 * Guia de correspondência funcionalidade -> Shot (seção 8), usado apenas para orientar a escolha —
 * nunca decide sozinho, nunca insere uma tela genérica "porque sobrou". Consultado pelo
 * `MediaCatalogVisualAssetProvider`/CLI quando um Shot pede produto/mockup/screenshot.
 */
export const PRODUCT_SCREEN_NARRATIVE_INTENT_MAP: Record<string, string[]> = {
  rsvp: ["convite", "confirmar presença", "confirmação de presença", "rsvp"],
  gift_list: ["presentes", "lista de presentes", "pix"],
  collaborative_album: ["memórias", "fotos", "álbum", "album colaborativo"],
  schedule: ["planejamento", "cronograma"],
  homepage: ["visão geral", "painel", "homepage", "site oficial"],
  guest_info: ["convidados", "informações do evento"],
};
