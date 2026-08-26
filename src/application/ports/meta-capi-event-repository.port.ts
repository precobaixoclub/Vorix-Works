/** Log de auditoria de envios à Conversions API — módulo Meta Ads Manager, Fase 4. Ver
 * `db/migrations/0075_meta_capi_events.sql`. Append-only por design: `record()` é a única
 * operação de escrita, não existe update. NUNCA guarda o hash de PII em si — só quais campos de
 * `user_data` foram enviados (`userDataFields`, ex.: `["em","ph"]`). */

export type MetaCapiEventRecord = {
  id: string;
  tenantId: string;
  workspaceId: string;
  /** id INTERNO (`meta_pixels.id`). */
  metaPixelId: string;
  pixelId: string;
  eventName: string;
  eventTime: string;
  eventId?: string;
  actionSource: string;
  userDataFields: readonly string[];
  customData?: unknown;
  testEventCode?: string;
  status: "sent" | "failed";
  eventsReceived?: number;
  fbtraceId?: string;
  errorMessage?: string;
  createdAt: string;
};

export type RecordMetaCapiEventInput = Omit<MetaCapiEventRecord, "id" | "createdAt">;

export type MetaCapiEventRepositoryPort = {
  record(input: RecordMetaCapiEventInput): Promise<MetaCapiEventRecord>;
  listByPixel(input: { tenantId: string; workspaceId: string; metaPixelId: string; limit?: number }): Promise<MetaCapiEventRecord[]>;
};
